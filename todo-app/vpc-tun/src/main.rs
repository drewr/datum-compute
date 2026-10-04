//! vpc-tun: put a laptop on a Datum Cloud VPC over iroh.
//!
//! `gateway` runs on an instance in the VPC next to a tun device. Each allowed
//! peer (an iroh endpoint ID) holds one VPC address inside the gateway
//! instance's delegated /96; the gateway routes that address into the tun and
//! answers neighbor discovery for it on the uplink, so other instances reach
//! the peer like any other host. `client` runs on the laptop and attaches a
//! local tun to the gateway.
//!
//! IPv6 packets cross as QUIC datagrams when they fit and otherwise as
//! length-prefixed frames on one bidirectional stream. The first frame the
//! gateway sends carries the peer's VPC address and the gateway's own, so the
//! client can say how to configure its tun.
//!
//! As an exit node, the laptop routes its internet traffic into its tun and
//! the gateway masquerades it out (set up outside this program, with
//! nftables). Instances have no IPv4, so the gateway translates the laptop's
//! IPv4 into IPv6 for the network's NAT64 (see nat46.rs). The client keeps
//! iroh's own traffic out of the tunnel with `--exit`: by default iroh stays on
//! IPv4 (for an IPv6-only exit), and `--exit=routes` instead pins iroh's
//! relays, peers and DNS servers to the pre-tunnel default routes (see
//! bypass.rs), which also lets IPv4 go through the tunnel.

mod bypass;
mod nat46;

use std::{
    collections::HashMap,
    future::Future,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    path::{Path, PathBuf},
    pin::Pin,
    process::Command as Process,
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use bytes::Bytes;
use clap::{Parser, Subcommand, ValueEnum};
use iroh::{
    Endpoint, EndpointId, SecretKey, TransportAddr,
    dns::{BoxIter, DnsError, DnsResolver, Resolver, TxtRecordData},
    endpoint::{Connection, RecvStream, SendStream, VarInt, presets},
};
use tokio::sync::{Mutex, RwLock, mpsc};
use tracing::{debug, info, warn};
use tun_rs::{AsyncDevice, DeviceBuilder};

const ALPN: &[u8] = b"datum/vpc-tun/0";
const MAX_PACKET: usize = 65535;

/// The network's NAT64 prefix (the well-known 64:ff9b::/96).
const NAT64_PREFIX: Ipv6Addr = Ipv6Addr::new(0x64, 0xff9b, 0, 0, 0, 0, 0, 0);

/// A peer's translation address: its VPC address with the top bit of the
/// /96's host part set, so replies to translated IPv4 stay apart from the
/// peer's own IPv6 traffic.
fn clat_address(addr: Ipv6Addr) -> Ipv6Addr {
    Ipv6Addr::from(u128::from(addr) | 0x8000_0000)
}

#[derive(Parser)]
#[command(version, about)]
struct Args {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Create a 32-byte identity key at PATH unless it exists, and print its endpoint ID.
    Keygen { path: PathBuf },
    /// Route VPC addresses for the listed peers through a tun device.
    Gateway {
        #[arg(long)]
        key_file: PathBuf,
        /// An existing tun device, up.
        #[arg(long)]
        tun: String,
        /// The interface on the VPC network.
        #[arg(long, default_value = "eth0")]
        uplink: String,
        /// ENDPOINT_ID=ADDRESS: a peer allowed to connect and the VPC address it
        /// holds. ADDRESS is an IPv6 address, or +N for the uplink's address plus
        /// N (inside the instance's delegated block). Repeatable.
        #[arg(long = "peer", value_parser = parse_peer, required = true)]
        peers: Vec<(EndpointId, PeerAddr)>,
        /// Also act as an IPv4 exit: translate peers' IPv4 to IPv6 for the
        /// network's NAT64. Needs the masquerade rule from the start script.
        #[arg(long)]
        exit: bool,
    },
    /// Attach a local tun device to a gateway.
    Client {
        #[arg(long)]
        key_file: PathBuf,
        /// An existing tun device (Linux), or utunN to create (macOS).
        #[arg(long)]
        tun: String,
        /// The gateway's endpoint ID.
        #[arg(long, value_parser = parse_endpoint_id)]
        gateway: EndpointId,
        /// Use the gateway as an exit node and keep the tunnel's own traffic out
        /// of the tunnel. `ipv4` (the default) keeps iroh on IPv4, for routing
        /// only IPv6 into the tun. `routes` pins iroh's relays, the gateway's
        /// addresses and DNS servers to the pre-tunnel default routes, for
        /// routing IPv4 in too or on an IPv6-only network; it needs root.
        #[arg(long, value_enum, num_args = 0..=1, require_equals = true, default_missing_value = "ipv4")]
        exit: Option<ExitMode>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
enum ExitMode {
    Ipv4,
    Routes,
}

#[derive(Clone, Copy, Debug)]
enum PeerAddr {
    Fixed(Ipv6Addr),
    Offset(u128),
}

fn parse_endpoint_id(s: &str) -> Result<EndpointId> {
    s.parse().context("invalid endpoint ID")
}

fn parse_peer(s: &str) -> Result<(EndpointId, PeerAddr)> {
    let (id, addr) = s.split_once('=').context("expected ENDPOINT_ID=ADDRESS")?;
    let addr = match addr.strip_prefix('+') {
        Some(n) => PeerAddr::Offset(n.parse().context("invalid offset")?),
        None => PeerAddr::Fixed(addr.parse().context("invalid IPv6 address")?),
    };
    Ok((parse_endpoint_id(id)?, addr))
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();
    match Args::parse().command {
        Command::Keygen { path } => keygen(&path).await,
        Command::Gateway {
            key_file,
            tun,
            uplink,
            peers,
            exit,
        } => gateway(&key_file, &tun, &uplink, peers, exit).await,
        Command::Client {
            key_file,
            tun,
            gateway,
            exit,
        } => client(&key_file, &tun, gateway, exit).await,
    }
}

async fn keygen(path: &Path) -> Result<()> {
    let key = if path.exists() {
        read_key(path).await?
    } else {
        use std::{io::Write, os::unix::fs::OpenOptionsExt};
        let key = SecretKey::generate();
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .and_then(|mut f| f.write_all(&key.to_bytes()))
            .with_context(|| format!("writing {}", path.display()))?;
        key
    };
    println!("{}", key.public());
    Ok(())
}

async fn read_key(path: &Path) -> Result<SecretKey> {
    let bytes = tokio::fs::read(path)
        .await
        .with_context(|| format!("reading {}", path.display()))?;
    let bytes: &[u8; 32] = bytes
        .as_slice()
        .try_into()
        .context("the key file must hold exactly 32 bytes")?;
    Ok(SecretKey::from_bytes(bytes))
}

async fn bind(key_file: &Path, accept: bool, ipv4_only: bool) -> Result<Endpoint> {
    let mut builder = Endpoint::builder(presets::N0).secret_key(read_key(key_file).await?);
    if accept {
        builder = builder.alpns(vec![ALPN.to_vec()]);
    }
    if ipv4_only {
        builder = builder
            .clear_ip_transports()
            .bind_addr("0.0.0.0:0")?
            .dns_resolver(DnsResolver::custom(Ipv4Only(DnsResolver::new())));
    }
    Ok(builder.bind().await?)
}

type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send + 'static>>;

const DNS_TIMEOUT: Duration = Duration::from_secs(5);

/// Answers no AAAA queries, so iroh dials relays and peers over IPv4 only.
#[derive(Debug, Clone)]
struct Ipv4Only(DnsResolver);

impl Resolver for Ipv4Only {
    fn lookup_ipv4(&self, host: String) -> BoxFuture<Result<BoxIter<Ipv4Addr>, DnsError>> {
        let inner = self.0.clone();
        Box::pin(async move {
            let addrs: Vec<Ipv4Addr> = inner
                .lookup_ipv4(host, DNS_TIMEOUT)
                .await?
                .filter_map(|a| match a {
                    IpAddr::V4(a) => Some(a),
                    IpAddr::V6(_) => None,
                })
                .collect();
            Ok(Box::new(addrs.into_iter()) as BoxIter<Ipv4Addr>)
        })
    }

    fn lookup_ipv6(&self, _host: String) -> BoxFuture<Result<BoxIter<Ipv6Addr>, DnsError>> {
        Box::pin(async { Ok(Box::new(std::iter::empty()) as BoxIter<Ipv6Addr>) })
    }

    fn lookup_txt(&self, host: String) -> BoxFuture<Result<BoxIter<TxtRecordData>, DnsError>> {
        let inner = self.0.clone();
        Box::pin(async move {
            let records: Vec<TxtRecordData> = inner.lookup_txt(host, DNS_TIMEOUT).await?.collect();
            Ok(Box::new(records.into_iter()) as BoxIter<TxtRecordData>)
        })
    }

    fn clear_cache(&self) {
        self.0.clear_cache();
    }

    fn reset(&self) -> Box<dyn Resolver> {
        self.0.reset();
        Box::new(self.clone())
    }
}

fn open_tun(name: &str) -> Result<Arc<AsyncDevice>> {
    let dev = DeviceBuilder::new()
        .name(name)
        .inherit_enable_state()
        .build_async()
        .with_context(|| format!("opening tun {name}"))?;
    Ok(Arc::new(dev))
}

fn ipv6_field(packet: &[u8], offset: usize) -> Option<Ipv6Addr> {
    if packet.len() < 40 || packet[0] >> 4 != 6 {
        return None;
    }
    let bytes: [u8; 16] = packet[offset..offset + 16].try_into().ok()?;
    Some(bytes.into())
}

fn ipv6_src(packet: &[u8]) -> Option<Ipv6Addr> {
    ipv6_field(packet, 8)
}

fn ipv6_dst(packet: &[u8]) -> Option<Ipv6Addr> {
    ipv6_field(packet, 24)
}

/// One end of a tunnel: datagrams when they fit, the stream otherwise.
struct Link {
    conn: Connection,
    stream: Mutex<SendStream>,
}

impl Link {
    async fn send(&self, packet: &[u8]) -> Result<()> {
        let fits = self
            .conn
            .max_datagram_size()
            .is_some_and(|max| packet.len() <= max);
        if fits && self.conn.send_datagram(Bytes::copy_from_slice(packet)).is_ok() {
            return Ok(());
        }
        write_frame(&mut *self.stream.lock().await, packet).await
    }
}

async fn write_frame(stream: &mut SendStream, frame: &[u8]) -> Result<()> {
    stream.write_all(&(frame.len() as u16).to_be_bytes()).await?;
    stream.write_all(frame).await?;
    Ok(())
}

async fn read_frame(stream: &mut RecvStream) -> Result<Vec<u8>> {
    let mut len = [0u8; 2];
    stream.read_exact(&mut len).await?;
    let mut frame = vec![0u8; u16::from_be_bytes(len) as usize];
    stream.read_exact(&mut frame).await?;
    Ok(frame)
}

/// Feeds every packet arriving on `conn`, from datagrams and the stream, into `tx`.
fn spawn_readers(conn: Connection, mut stream: RecvStream, tx: mpsc::Sender<Bytes>) {
    let datagrams = tx.clone();
    tokio::spawn(async move {
        while let Ok(packet) = conn.read_datagram().await {
            if datagrams.send(packet).await.is_err() {
                break;
            }
        }
    });
    tokio::spawn(async move {
        while let Ok(frame) = read_frame(&mut stream).await {
            // Empty frames only open the stream.
            if !frame.is_empty() && tx.send(frame.into()).await.is_err() {
                break;
            }
        }
    });
}

/// The uplink's global IPv6 address, from `ip`.
fn uplink_address(uplink: &str) -> Result<Ipv6Addr> {
    let out = Process::new("ip")
        .args(["-6", "-o", "addr", "show", "dev", uplink, "scope", "global"])
        .output()
        .context("running ip")?;
    let text = String::from_utf8_lossy(&out.stdout);
    let cidr = text
        .split_whitespace()
        .skip_while(|w| *w != "inet6")
        .nth(1)
        .with_context(|| format!("{uplink} has no global IPv6 address"))?;
    let addr = cidr.split('/').next().unwrap_or(cidr);
    addr.parse().with_context(|| format!("parsing {addr}"))
}

fn run(args: &[&str]) -> Result<()> {
    let status = Process::new("ip").args(args).status().context("running ip")?;
    if !status.success() {
        bail!("ip {} failed with {status}", args.join(" "));
    }
    Ok(())
}

async fn gateway(
    key_file: &Path,
    tun: &str,
    uplink: &str,
    peers: Vec<(EndpointId, PeerAddr)>,
    exit: bool,
) -> Result<()> {
    let dev = open_tun(tun)?;
    let own = uplink_address(uplink)?;
    let mut allowed = HashMap::new();
    let mut clat_peers = HashMap::new();
    for (id, addr) in peers {
        let addr = match addr {
            PeerAddr::Fixed(addr) => addr,
            PeerAddr::Offset(n) => Ipv6Addr::from(u128::from(own) + n),
        };
        let a = addr.to_string();
        run(&["-6", "route", "replace", &format!("{a}/128"), "dev", tun])?;
        run(&["-6", "neigh", "replace", "proxy", &a, "dev", uplink])?;
        if exit {
            let clat = clat_address(addr);
            run(&["-6", "route", "replace", &format!("{clat}/128"), "dev", tun])?;
            clat_peers.insert(clat, addr);
        }
        info!(peer = %id, address = %addr, "peer allowed");
        allowed.insert(id, addr);
    }
    let allowed = Arc::new(allowed);
    let clat_peers = Arc::new(clat_peers);
    let links: Arc<RwLock<HashMap<Ipv6Addr, Arc<Link>>>> = Default::default();

    let endpoint = bind(key_file, true, false).await?;
    info!(id = %endpoint.id(), %own, "gateway listening");

    // VPC -> peers.
    {
        let (dev, links, clat_peers) = (dev.clone(), links.clone(), clat_peers.clone());
        tokio::spawn(async move {
            let mut buf = vec![0u8; MAX_PACKET];
            loop {
                let n = match dev.recv(&mut buf).await {
                    Ok(n) => n,
                    Err(err) => {
                        warn!("reading tun: {err:#}");
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        continue;
                    }
                };
                let packet = &buf[..n];
                let Some(dst) = ipv6_dst(packet) else { continue };
                // Replies to a peer's translated IPv4 go back as IPv4.
                let (peer, translated) = match clat_peers.get(&dst) {
                    Some(&peer) => match nat46::v6_to_v4(packet, NAT64_PREFIX, nat46::CLAT_V4) {
                        Some(v4) => (peer, Some(v4)),
                        None => continue,
                    },
                    None => (dst, None),
                };
                let link = links.read().await.get(&peer).cloned();
                if let Some(link) = link
                    && let Err(err) = link.send(translated.as_deref().unwrap_or(packet)).await
                {
                    debug!(%dst, "dropping packet: {err:#}");
                }
            }
        });
    }

    let serve = async {
        while let Some(incoming) = endpoint.accept().await {
            let (dev, links, allowed) = (dev.clone(), links.clone(), allowed.clone());
            tokio::spawn(async move {
                if let Err(err) = serve_peer(incoming, own, exit, dev, links, allowed).await {
                    warn!("peer connection: {err:#}");
                }
            });
        }
    };
    tokio::select! {
        _ = serve => {}
        _ = shutdown_signal() => info!("shutting down"),
    }
    endpoint.close().await;
    Ok(())
}

async fn serve_peer(
    incoming: iroh::endpoint::Incoming,
    own: Ipv6Addr,
    exit: bool,
    dev: Arc<AsyncDevice>,
    links: Arc<RwLock<HashMap<Ipv6Addr, Arc<Link>>>>,
    allowed: Arc<HashMap<EndpointId, Ipv6Addr>>,
) -> Result<()> {
    let conn = incoming.await?;
    let peer = conn.remote_id();
    let Some(&addr) = allowed.get(&peer) else {
        conn.close(VarInt::from_u32(1), b"not allowed");
        bail!("rejected {peer}: not an allowed peer");
    };
    let (mut send, recv) = conn.accept_bi().await?;
    let mut hello = addr.octets().to_vec();
    hello.extend_from_slice(&own.octets());
    write_frame(&mut send, &hello).await?;

    let link = Arc::new(Link {
        conn: conn.clone(),
        stream: Mutex::new(send),
    });
    links.write().await.insert(addr, link.clone());
    info!(%peer, %addr, "peer connected");

    let (tx, mut rx) = mpsc::channel(256);
    spawn_readers(conn.clone(), recv, tx);
    let forward = async {
        while let Some(packet) = rx.recv().await {
            // A peer may only send from its own address: its VPC address for
            // IPv6, and 192.0.0.2 for IPv4 when the gateway is an exit.
            let out = match packet.first().map(|b| b >> 4) {
                Some(6) if ipv6_src(&packet) == Some(addr) => packet.to_vec(),
                Some(4) if exit && packet.len() >= 20 && packet[12..16] == nat46::CLAT_V4.octets() => {
                    match nat46::v4_to_v6(&packet, clat_address(addr), NAT64_PREFIX) {
                        Some(v6) => v6,
                        None => continue,
                    }
                }
                _ => {
                    debug!(%peer, "dropping packet from a foreign source");
                    continue;
                }
            };
            if let Err(err) = dev.send(&out).await {
                warn!("writing tun: {err:#}");
            }
        }
    };
    tokio::select! {
        _ = forward => {}
        _ = conn.closed() => {}
    }

    let mut links = links.write().await;
    if links.get(&addr).is_some_and(|current| Arc::ptr_eq(current, &link)) {
        links.remove(&addr);
    }
    info!(%peer, "peer disconnected");
    Ok(())
}

async fn client(key_file: &Path, tun: &str, gateway: EndpointId, exit: Option<ExitMode>) -> Result<()> {
    let dev = open_tun(tun)?;
    // Pin the tunnel's own destinations before anything can loop.
    let bypass = match exit {
        Some(ExitMode::Routes) => {
            let b = Arc::new(bypass::Bypass::detect(tun)?);
            b.add_nameservers();
            use iroh::defaults::prod::*;
            for host in [NA_EAST_RELAY_HOSTNAME, NA_WEST_RELAY_HOSTNAME, EU_RELAY_HOSTNAME, AP_RELAY_HOSTNAME] {
                b.add_host(host);
            }
            b.add_host("dns.iroh.link"); // discovery: pkarr and DNS
            Some(b)
        }
        _ => None,
    };
    let endpoint = bind(key_file, false, exit == Some(ExitMode::Ipv4)).await?;
    info!(id = %endpoint.id(), "client endpoint ready");
    // The gateway's direct addresses appear as iroh learns them.
    if let Some(b) = bypass.clone() {
        let endpoint = endpoint.clone();
        tokio::spawn(async move {
            loop {
                if let Some(info) = endpoint.remote_info(gateway).await {
                    for a in info.addrs() {
                        if let TransportAddr::Ip(sa) = a.addr() {
                            b.add(sa.ip());
                        }
                    }
                }
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        });
    }
    let mut announced = false;
    let run = async {
        loop {
            if let Err(err) =
                connect_client(&endpoint, &dev, tun, gateway, exit, &mut announced).await
            {
                warn!("tunnel: {err:#}");
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    };
    tokio::select! {
        _ = run => {}
        _ = shutdown_signal() => info!("shutting down"),
    }
    endpoint.close().await;
    if let Some(b) = bypass {
        b.clear();
    }
    Ok(())
}

async fn connect_client(
    endpoint: &Endpoint,
    dev: &AsyncDevice,
    tun: &str,
    gateway: EndpointId,
    exit: Option<ExitMode>,
    announced: &mut bool,
) -> Result<()> {
    let conn = endpoint.connect(gateway, ALPN).await?;
    let (mut send, mut recv) = conn.open_bi().await?;
    write_frame(&mut send, &[]).await?; // the gateway sees the stream once it carries data

    let hello = read_frame(&mut recv).await?;
    let (Ok(mine), Ok(theirs)) = (
        <[u8; 16]>::try_from(&hello[..16.min(hello.len())]),
        <[u8; 16]>::try_from(&hello[16.min(hello.len())..]),
    ) else {
        bail!("unexpected hello from the gateway");
    };
    let (mine, theirs) = (Ipv6Addr::from(mine), Ipv6Addr::from(theirs));
    info!(
        address = %mine,
        gateway = %theirs,
        max_datagram = ?conn.max_datagram_size(),
        "connected to the gateway"
    );
    if !*announced {
        let net = Ipv6Addr::from(u128::from(theirs) & !((1u128 << 64) - 1));
        println!("VPC address for this laptop: {mine}");
        println!("If {tun} isn't configured yet (Linux):");
        println!("  sudo ip link set {tun} mtu 1280 up");
        println!("  sudo ip -6 addr add {mine}/128 dev {tun}");
        println!("  sudo ip -6 route add {net}/64 dev {tun}");
        // iroh may try a direct path to the gateway's VPC address, which the
        // route above would send back into the tunnel.
        println!("  sudo ip -6 route add unreachable {theirs}/128");
        if exit.is_some() {
            println!("To send all IPv6 through the gateway (exit node):");
            println!("  sudo ip -6 route add ::/1 dev {tun}");
            println!("  sudo ip -6 route add 8000::/1 dev {tun}");
        }
        if exit == Some(ExitMode::Routes) {
            println!("And all IPv4:");
            println!("  sudo ip -4 addr add {}/32 dev {tun}", nat46::CLAT_V4);
            println!("  sudo ip -4 route add 0.0.0.0/1 dev {tun}");
            println!("  sudo ip -4 route add 128.0.0.0/1 dev {tun}");
        }
        *announced = true;
    }

    let link = Link {
        conn: conn.clone(),
        stream: Mutex::new(send),
    };
    let (tx, mut rx) = mpsc::channel(256);
    spawn_readers(conn.clone(), recv, tx);
    let down = async {
        while let Some(packet) = rx.recv().await {
            if let Err(err) = dev.send(&packet).await {
                warn!("writing tun: {err:#}");
            }
        }
    };
    let up = async {
        let mut buf = vec![0u8; MAX_PACKET];
        loop {
            let n = dev.recv(&mut buf).await.context("reading tun")?;
            // IPv6, and IPv4 for an exit; the gateway checks sources.
            if n >= 20 && matches!(buf[0] >> 4, 4 | 6) {
                link.send(&buf[..n]).await?;
            }
        }
        #[allow(unreachable_code)]
        anyhow::Ok(())
    };
    tokio::select! {
        _ = down => bail!("connection closed"),
        res = up => res,
        err = conn.closed() => Err(err.into()),
    }
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut term = signal(SignalKind::terminate()).expect("SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}
