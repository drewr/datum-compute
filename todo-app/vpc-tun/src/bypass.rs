//! Exception routes for `client --exit=routes`.
//!
//! When the laptop routes everything into its tun, the tunnel's own packets
//! (to iroh relays, to the gateway's direct addresses, to DNS servers and the
//! discovery service) would follow and loop. This pins each of those
//! addresses to the default route that existed before the tunnel, the way
//! WireGuard pins its endpoint. Linux uses `ip`, macOS uses `route`.

use std::{
    collections::HashSet,
    net::{IpAddr, ToSocketAddrs},
    process::Command,
    sync::Mutex,
};

use anyhow::{Result, bail};
use tracing::{info, warn};

/// A default route's next hop, outside the tunnel.
#[derive(Debug, Clone)]
struct NextHop {
    via: String,
    dev: String,
}

#[derive(Debug)]
pub struct Bypass {
    v4: Option<NextHop>,
    v6: Option<NextHop>,
    added: Mutex<HashSet<IpAddr>>,
}

impl Bypass {
    /// Reads the default routes that don't use `tun`. Call before routing
    /// anything into the tunnel matters, i.e. before connecting.
    pub fn detect(tun: &str) -> Result<Self> {
        let (v4, v6) = if cfg!(target_os = "macos") {
            (macos_default("inet", tun), macos_default("inet6", tun))
        } else {
            (linux_default("-4", tun), linux_default("-6", tun))
        };
        if v4.is_none() && v6.is_none() {
            bail!("no default route outside {tun} to send the tunnel's own traffic through");
        }
        info!(?v4, ?v6, "bypass next hops");
        Ok(Self {
            v4,
            v6,
            added: Mutex::default(),
        })
    }

    /// Resolves `host` and pins every address it has.
    pub fn add_host(&self, host: &str) {
        match (host.trim_end_matches('.'), 443).to_socket_addrs() {
            Ok(addrs) => addrs.for_each(|a| self.add(a.ip())),
            Err(err) => warn!("resolving {host}: {err}"),
        }
    }

    /// Pins the nameservers from /etc/resolv.conf (generated on macOS too).
    pub fn add_nameservers(&self) {
        let Ok(conf) = std::fs::read_to_string("/etc/resolv.conf") else { return };
        for line in conf.lines() {
            if let Some(ip) = line.strip_prefix("nameserver").and_then(|r| r.trim().split('%').next()?.parse().ok()) {
                self.add(ip);
            }
        }
    }

    /// Routes `ip` around the tunnel, once. Skips addresses that never go
    /// through a default route anyway.
    pub fn add(&self, ip: IpAddr) {
        if !is_global(ip) || !self.added.lock().unwrap().insert(ip) {
            return;
        }
        let hop = match ip {
            IpAddr::V4(_) => &self.v4,
            IpAddr::V6(_) => &self.v6,
        };
        let Some(hop) = hop else { return };
        if let Err(err) = route(true, ip, hop) {
            warn!("pinning {ip}: {err:#}");
        } else {
            info!(%ip, via = %hop.via, dev = %hop.dev, "pinned outside the tunnel");
        }
    }

    /// Removes every route this added.
    pub fn clear(&self) {
        for ip in self.added.lock().unwrap().drain() {
            let hop = match ip {
                IpAddr::V4(_) => &self.v4,
                IpAddr::V6(_) => &self.v6,
            };
            if let Some(hop) = hop {
                let _ = route(false, ip, hop);
            }
        }
    }
}

fn is_global(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => !(a.is_private() || a.is_loopback() || a.is_link_local() || a.is_unspecified() || a.is_multicast()),
        IpAddr::V6(a) => {
            let seg0 = a.segments()[0];
            !(a.is_loopback() || a.is_unspecified() || a.is_multicast()
                || seg0 & 0xffc0 == 0xfe80 // link-local
                || seg0 & 0xfe00 == 0xfc00) // unique local
        }
    }
}

fn route(add: bool, ip: IpAddr, hop: &NextHop) -> Result<()> {
    let ip_s = ip.to_string();
    let status = if cfg!(target_os = "macos") {
        let family = if ip.is_ipv4() { "-inet" } else { "-inet6" };
        Command::new("route")
            .args(["-q", "-n", if add { "add" } else { "delete" }, family, "-host", &ip_s, &hop.via])
            .status()?
    } else {
        let (family, len) = if ip.is_ipv4() { ("-4", "32") } else { ("-6", "128") };
        let dst = format!("{ip_s}/{len}");
        let verb = if add { "replace" } else { "del" };
        Command::new("ip")
            .args([family, "route", verb, &dst, "via", &hop.via, "dev", &hop.dev])
            .status()?
    };
    if !status.success() {
        bail!("route command failed with {status}");
    }
    Ok(())
}

/// `ip -4|-6 route show default`: "default via X dev Y ...".
fn linux_default(family: &str, tun: &str) -> Option<NextHop> {
    let out = Command::new("ip").args([family, "route", "show", "default"]).output().ok()?;
    String::from_utf8_lossy(&out.stdout).lines().find_map(|line| {
        let w: Vec<&str> = line.split_whitespace().collect();
        let via = w.iter().position(|x| *x == "via").and_then(|i| w.get(i + 1))?;
        let dev = w.iter().position(|x| *x == "dev").and_then(|i| w.get(i + 1))?;
        (*dev != tun).then(|| NextHop { via: via.to_string(), dev: dev.to_string() })
    })
}

/// `netstat -rn -f inet|inet6`: "default  <gateway>  <flags>  <netif> ...".
fn macos_default(family: &str, tun: &str) -> Option<NextHop> {
    let out = Command::new("netstat").args(["-rn", "-f", family]).output().ok()?;
    String::from_utf8_lossy(&out.stdout).lines().find_map(|line| {
        let w: Vec<&str> = line.split_whitespace().collect();
        if w.first() != Some(&"default") || w.len() < 4 || w[3].starts_with("utun") || w[3] == tun {
            return None;
        }
        // Link-local gateways print as fe80::1%en0; route(8) takes that form.
        if w[1].starts_with("link#") {
            return None;
        }
        Some(NextHop { via: w[1].to_string(), dev: w[3].to_string() })
    })
}
