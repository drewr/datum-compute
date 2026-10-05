# Todo app on Datum Cloud, built with NixOS

A small TypeScript todo list app and its PostgreSQL database, deployed as two
Datum Cloud workloads: the app on the unikernel runtime class, the database on
general-purpose. Both images are built with Nix from the NixOS 26.05 channel.

- **todo-app**: Node.js server with a one-page UI, published at
  https://todo.draines.com (a custom hostname on the Datum-managed URL
  https://nab-glee-z96z8.datumproxy.net). It runs as a unikernel.
- **todo-db**: a NixOS system running inside the container, with systemd as
  PID 1 and `services.postgresql`. It has no URL and only a private address.

## Files

Run the commands below from this directory.

```
default.nix               # builds every image and vpc-tun (nix-build -A <name>)
app/                      # the todo app: TypeScript on Node.js
  package.json, package-lock.json (pinned by npmDepsHash in default.nix), tsconfig.json
  src/server.ts           # API and the list page
  src/about.ts            # the /about page: topology diagram
  src/theme.ts            # look shared by both pages (Datum palette, header, logo)
db/schema.sql             # todo table and sample rows, loaded at every boot
vpc-tun/                  # the gateway and laptop program (Rust, iroh)
  src/main.rs
  src/nat46.rs            # IPv4/IPv6 translation for the exit node
  src/bypass.rs           # exception routes for client --exit=routes
manifests/
  todo-app.yaml
  todo-db.yaml
  vpc-gateway.yaml        # optional: puts laptops on the VPC over iroh
  todo-db-connect.yaml    # optional: datum-connect port forward to todo-db
scripts/datum-connect-ticket.py   # builds the laptop's datum-connect ticket
```

## How traffic flows

```
browser ──HTTPS──▶ Datum proxy ──HTTP :8080──▶ todo-app ──TCP :5432──▶ todo-db
                   (todo.draines.com)          fd20:0:1::2:0:0         fd20:0:1::1:0:0
```

- The proxy and its URL come from deploying todo-app with `--http-port=8080`.
  Datum terminates TLS; the app serves plain HTTP.
- Both instances sit on the project's `default` network with private IPv6
  (ULA) addresses. Nothing on the internet can reach them except through the
  proxy, and todo-db has no proxy. No network policies are involved.
- todo-app finds the database through `PGHOST=fd20:0:1::1:0:0`. todo-db uses
  `reclaimPolicy: Retain`, so a redeployed instance gets the same address.
- The `todo-db` Secret holds the database password under two keys:
  `PGPASSWORD` (imported as env by the app) and `POSTGRES_PASSWORD` (mounted
  as a file in todo-db).

## The database image

`default.nix`'s `db` attribute evaluates a NixOS configuration and boots it
with `${toplevel}/init`. The `postgres` user, PostgreSQL itself, the `todo`
database and role all come from modules; NixOS activation writes
`/etc/passwd` at boot. A systemd unit, `todo-db-seed`, sets the `todo`
role's password from the mounted Secret and loads `db/schema.sql`, which is
safe to rerun.

Running systemd in a Datum container took five settings, each found by a
failure that didn't point at its cause:

| Without it | Setting |
|---|---|
| systemd can't start | capabilities in `manifests/todo-db.yaml` (SYS_ADMIN, CHOWN, SETUID, SETGID, ...); the general-purpose class grants them inside the instance's VM |
| systemd can't create its cgroup | `boot.postBootCommands` remounts `/sys/fs/cgroup` read-write |
| every `datumctl compute exec` fails with `NoShell` | `boot.postBootCommands` moves PID 1 into a child cgroup before systemd starts (see below) |
| every port times out | `networking.firewall.enable = false` (the default firewall drops inbound) |
| no DNS | `networking.resolvconf.enable = false`, so NixOS keeps the runtime's `/etc/resolv.conf` |

About `NoShell`: systemd enables cgroup controllers on the cgroup it starts
in. cgroup v2 then allows no processes in that cgroup, and the runtime puts
exec processes in the container's root cgroup, so every exec fails. The
platform reports any such exec failure as "the container has no shell (sh)",
even when it has one.

The image also carries `ip`, `route`, `netstat`, `ping`, `ping6`, `dig` and
the `s6-dns*` tools. iputils no longer ships `ping6`, so `ping6` is a wrapper
for `ping -6`. s6-dns is a suite (`s6-dnsip6`, `s6-dnsq`, ...) with no binary
named `s6-dns`.

## Putting a laptop on the VPC

`manifests/vpc-gateway.yaml` runs `vpc-tun gateway` (default.nix's `vpc-gateway`
image) on an instance in the `default` network. A laptop running
`vpc-tun client` gets its own address in the network, and instances reach it
like any other host: todo-db can ping it, and the laptop talks to
`fd20:0:1::1:0:0:5432` and `fd20:0:1::2:0:0:8080` directly.

```
laptop tun datum0 ──iroh──▶ vpc-gateway ──▶ VPC ──▶ todo-db, todo-app
fd20:0:1::6:0:1             fd20:0:1::6:0:0          fd20:0:1::1:0:0, ::2:0:0
                            tun vpc0, forwarding,
                            proxy NDP on eth0
```

How the addressing works:

- The network delegates a /96 to each instance (the gateway holds
  `fd20:0:1::6:0:0/96`) and finds addresses inside it by neighbor discovery.
  The gateway gives each laptop an address from its own block (`+1` is
  `fd20:0:1::6:0:1`), routes that address into `vpc0`, and answers neighbor
  discovery for it on eth0. An address outside the block can't be used:
  another instance would get it.
- `reclaimPolicy: Retain` keeps the gateway's block, and so the laptops'
  addresses, across redeploys.
- Only endpoint IDs listed in `VPC_TUN_PEERS` can connect, each pinned to one
  address; the gateway drops packets from a peer that use any other source.
  PostgreSQL sees the laptop's own address, which `fc00::/7 scram-sha-256`
  already covers.
- Packets cross as QUIC datagrams. Both tuns use MTU 1280, IPv6's minimum,
  which fits iroh's 1288-byte datagrams on a relay path. A larger packet goes
  on a stream instead and arrives out of order with the rest; with MTU 1440,
  a 2 MB psql result took 12 s instead of 1.4 s.
- The gateway needs NET_ADMIN, MKNOD and SYS_ADMIN (to remount `/proc/sys`
  read-write for forwarding and proxy NDP).

Deploy the gateway once:

```sh
nix-build -A vpc-gateway -o result-gateway
skopeo copy docker-archive:result-gateway docker://ghcr.io/<you>/vpc-gateway:<tag>
nix-build -A vpc-tun          # or `cargo build --release` in vpc-tun/
result/bin/vpc-tun keygen key # prints the gateway's endpoint ID
datumctl create -f - <<EOF
apiVersion: v1
kind: Secret
metadata: { name: vpc-gateway, namespace: default }
type: Opaque
data: { key: "$(base64 -w0 key)" }
EOF
rm key
# Put each laptop's endpoint ID in VPC_TUN_PEERS (ID=+1, ID=+2, ...), then:
datumctl compute deploy -f manifests/vpc-gateway.yaml
```

The gateway's endpoint ID can be recovered from the Secret:
`datumctl get secret vpc-gateway -o jsonpath='{.data.key}' | base64 -d > k;
vpc-tun keygen k; rm k`.

On a Linux laptop. Root is needed for the tun only; the client runs as you.

```sh
vpc-tun keygen ~/.config/vpc-tun/key   # add this ID to VPC_TUN_PEERS
sudo ip tuntap add dev datum0 mode tun user "$USER"
sudo ip link set datum0 mtu 1280 up
sudo ip -6 addr add fd20:0:1::6:0:1/128 dev datum0
sudo ip -6 route add fd20:0:1::/64 dev datum0
# iroh may try a direct path to the gateway's own VPC address, which the
# route above would send back into the tunnel; QUIC then keeps losing
# datagrams. Make that one address unreachable.
sudo ip -6 route add unreachable fd20:0:1::6:0:0/128
vpc-tun client --key-file ~/.config/vpc-tun/key --tun datum0 \
  --gateway <gateway endpoint ID>
```

The client prints these commands (Linux form) with the right addresses when
it connects.

On macOS, build with `cargo build --release` in `vpc-tun/` (default.nix is
pinned to x86_64-linux). The client creates the utun device itself, so it
runs as root; pick a free `utunN` (the low numbers are often taken):

```sh
vpc-tun keygen ~/.config/vpc-tun/key   # add this ID to VPC_TUN_PEERS
sudo vpc-tun client --key-file ~/.config/vpc-tun/key --tun utun99 \
  --gateway <gateway endpoint ID>
# Once it logs "connected to the gateway", in another terminal:
sudo ifconfig utun99 inet6 fd20:0:1::6:0:1/128 alias
sudo ifconfig utun99 mtu 1280 up
sudo route -q -n add -inet6 fd20:0:1::/64 -interface utun99
sudo route -q -n add -inet6 -host fd20:0:1::6:0:0 ::1 -reject
```

Restarting the client creates a fresh utun, so rerun the `ifconfig` lines and
the /64 route; the reject route stays until
`sudo route -n delete -inet6 -host fd20:0:1::6:0:0`. Every VPC address
except the gateway's own is reachable; `ping6 fd20:0:1::6:0:0` reports "No
route to host" because of the reject route.

Tested on macOS (pings both ways, about 65 ms) and on Linux, with the laptop in a
network namespace:
- Pings in both directions.
- `psql` to `fd20:0:1::1:0:0`.
- HTTP to todo-app.
- A 2 MB psql result, checksum-verified.
- The client running with no capabilities.

### Exit node

The gateway also works as an exit node, like Tailscale's exit nodes or a
WireGuard peer with `AllowedIPs = 0.0.0.0/0, ::/0`: the laptop sends its
internet traffic through the tunnel, and it leaves from Datum.
`VPC_TUN_EXIT=1` in `manifests/vpc-gateway.yaml` turns it on.

How the gateway does it:

- **IPv6 is masqueraded.** The platform only lets an instance's own address
  out to the internet; a second address in the gateway's block got no
  connection. An nftables rule rewrites laptop traffic leaving eth0 for
  anything outside `fc00::/7` to the gateway's address. Private destinations
  still see the laptop's own address.
- **IPv4 is translated.** Instances have no IPv4, but the network provides
  NAT64 at `64:ff9b::/96`, and its DNS servers are DNS64. The laptop sends
  IPv4 from `192.0.0.2`. The gateway rewrites each packet as IPv6 to
  `64:ff9b::<IPv4>`, from a second address per laptop (`::6:8000:1` for
  `::6:0:1`), and translates the replies back (nat46.rs). That covers TCP,
  UDP, ping, and the ICMP errors path MTU discovery needs. IPv4 fragments
  are dropped.

The client has to keep the tunnel's own traffic out of the tunnel:

- **`--exit`:** iroh stays on IPv4. Use it when only IPv6 goes into the tun;
  IPv4 then keeps going out the laptop's own connection.
- **`--exit=routes`:** for both families, or on an IPv6-only network. The
  client records the default routes from before the tunnel, then pins these
  to them with host routes (bypass.rs), removing them on exit:
  - the n0 relays
  - `dns.iroh.link`
  - the gateway's direct addresses as iroh learns them
  - the DNS servers in `/etc/resolv.conf`

  DNS servers on the local network are used directly either way. Needs root.

On macOS, for everything through the exit (untested on a Mac):

```sh
sudo vpc-tun client --key-file ~/.config/vpc-tun/key --tun utun99 \
  --gateway <gateway endpoint ID> --exit=routes
# Once it logs "connected to the gateway":
sudo ifconfig utun99 inet6 fd20:0:1::6:0:1/128 alias
sudo ifconfig utun99 inet 192.0.0.2/32 192.0.0.2 alias
sudo ifconfig utun99 mtu 1280 up
sudo route -q -n add -inet6 fd20:0:1::/64 -interface utun99
sudo route -q -n add -inet6 -host fd20:0:1::6:0:0 ::1 -reject
sudo route -q -n add -inet6 ::/1 -interface utun99
sudo route -q -n add -inet6 8000::/1 -interface utun99
sudo route -q -n add -inet 0.0.0.0/1 -interface utun99
sudo route -q -n add -inet 128.0.0.0/1 -interface utun99
curl -4 https://api.ipify.org; curl -6 https://api64.ipify.org   # Datum's addresses
```

For IPv6 only, use `--exit` and skip the `inet` and IPv4 route lines. The
client prints the Linux equivalents when it connects.

Tested on Linux with the laptop in a network namespace, on 4 October 2026:

| Check | `--exit`, IPv6 in tunnel | `--exit=routes`, both | `--exit=routes`, IPv6-only network |
|---|---|---|---|
| IPv4 egress | host's own (direct) | `67.14.169.129` (NAT64) | `67.14.169.129` |
| IPv6 egress | `2607:ed40:10c::1:0:1` | same | same |
| ping 1.1.1.1 | (direct; not testable here) | 3/3 | 3/3 |
| ping6 Google DNS | 3/3 | 3/3 | (pinned DNS server, bypasses the tunnel) |
| DNS over UDP, v4 and v6 | works | works | works |
| 10 MB download | v6 1.3 MB/s | v4 1.3, v6 0.9 MB/s | v4 1.3, v6 1.0 MB/s |
| todo-db sees | the laptop's address | same | same |

ICMP to the internet works since a gateway restart on 4 October; before
that the platform dropped outbound ICMP.

## Reaching the database from a laptop (port forward)

A simpler option when only PostgreSQL is needed.

`manifests/todo-db-connect.yaml` runs `datum-connect serve`
([datum-cloud/app](https://github.com/datum-cloud/app)'s CLI image) as an
iroh endpoint next to todo-db. It forwards tunnels to
`[fd20:0:1::1:0:0]:5432` and nothing else. On the laptop, `datum-connect
connect` listens on a local address and carries each TCP connection over iroh
to that endpoint:

```
psql ──▶ [fd20:0:1::1:0:0]:5432 on the laptop ──iroh──▶ todo-db-connect ──TCP──▶ todo-db
         (address on a local tun)                       fd20:0:1::4:0:0          fd20:0:1::1:0:0
```

This is a TCP forward for port 5432, not a VPN: datum-connect has no tun or
packet mode, so only connections to that address and port go through.
Putting the database's own address on the laptop just makes connection
strings the same everywhere. PostgreSQL sees the endpoint instance
(`fd20:0:1::4:0:0`), so the existing `fc00::/7 scram-sha-256` rule applies
and the `todo` password is still required.

`serve` doesn't check who is calling. Anyone who has the endpoint ID (and so
anyone with the ticket) can open TCP connections to PostgreSQL. Keep the
ticket private, and destroy the workload when you don't need it.

Deploy the endpoint. Its identity key lives in a Secret, so the endpoint ID,
and the ticket, survive redeploys:

```sh
head -c 32 /dev/urandom > key
datumctl create -f - <<EOF
apiVersion: v1
kind: Secret
metadata: { name: todo-db-connect, namespace: default }
type: Opaque
data: { key: "$(base64 -w0 key)" }
EOF
rm key
datumctl compute deploy -f manifests/todo-db-connect.yaml
```

Build the ticket from that Secret. `serve` logs its ID but prints no ticket,
and the target must match `--tcp-proxy` exactly, brackets included:

```sh
datumctl get secret todo-db-connect -o jsonpath='{.data.key}' | base64 -d |
  nix-shell -p 'python3.withPackages (p: [p.cryptography])' \
    --run "python3 scripts/datum-connect-ticket.py - '[fd20:0:1::1:0:0]:5432' todo-db"
```

On the laptop, put the address on a tun and connect. Root is needed for the
interface only.

```sh
# Linux. A tun with no process attached shows NO-CARRIER, but the address
# still binds.
sudo ip tuntap add dev datum0 mode tun user "$USER"
sudo ip link set datum0 up
sudo ip -6 addr add fd20:0:1::1:0:0/128 dev datum0
docker run --rm --network host ghcr.io/datum-cloud/datum-connect:v0.1.5 \
  connect --bind '[fd20:0:1::1:0:0]:5432' --ticket <ticket>

# macOS can't create a utun without a process holding it; alias the address
# on lo0 instead, and build the CLI (the desktop app has no connect command).
sudo ifconfig lo0 inet6 fd20:0:1::1:0:0 prefixlen 128 alias
cargo install --locked --git https://github.com/datum-cloud/app --tag v0.1.5 datum-connect
datum-connect connect --bind '[fd20:0:1::1:0:0]:5432' --ticket <ticket>

# Then, from anything on the laptop:
psql "host=fd20:0:1::1:0:0 user=todo dbname=todo"
```

Remove the address afterwards with `sudo ip link del datum0` (Linux) or
`sudo ifconfig lo0 inet6 fd20:0:1::1:0:0 delete` (macOS). Tested here: the
Linux path (tun in a network namespace, then `psql` reading the todos table),
and the docker form bound to 127.0.0.1. The macOS commands are untested.

## Build and deploy

```sh
nix-build -A app -o result-app
nix-build -A db -o result-db

# Push both images to ghcr. Use a two-segment path; unikernel nodes rewrite
# one-segment paths.
skopeo copy docker-archive:result-db docker://ghcr.io/<you>/todo-db:<tag>
skopeo copy docker-archive:result-app docker://ghcr.io/<you>/todo-app:<tag>

# Wrap the app image for the unikernel class and let datumctl push it to a
# public ghcr package (see "The unikernel class" below for why both matter).
# datumctl reads registry credentials from $DOCKER_CONFIG/config.json.
echo 'FROM ghcr.io/<you>/todo-app:<tag>@<digest>' > Dockerfile
datumctl compute build . --analyze --push --output ghcr.io/<you>/todo-app-uk:<tag>

# Once per project: the password Secret and a ghcr pull secret.
datumctl create -f - <<EOF
apiVersion: v1
kind: Secret
metadata: { name: todo-db, namespace: default }
type: Opaque
stringData: { POSTGRES_PASSWORD: "<password>", PGPASSWORD: "<password>" }
EOF

# A ghcr pull secret named ghcr-drewr (a token with read:packages), then:
datumctl compute deploy -f manifests/todo-db.yaml

# The URL needs one flag deploy (--http-port can't be combined with -f). Refer
# to the image by digest only.
datumctl compute deploy todo-app --image=ghcr.io/<you>/todo-app-uk@<digest> \
  --runtime-class=unikernel --http-port=8080 ...   # full flags in manifests/todo-app.yaml
# Later changes: manifest deploys keep the URL.
datumctl compute deploy -f manifests/todo-app.yaml

# Custom hostname: a CNAME to the generated URL, then attach it to the load
# balancer that --http-port created (named after the workload). Datum issues
# the certificate; draines.com is a Datum DNS zone already verified in the
# project. `datumctl compute deploy` is designed to keep custom hostnames
# on redeploy (not tested here).
datumctl dns record create draines.com todo CNAME nab-glee-z96z8.datumproxy.net.
datumctl alb hostname add todo-app todo.draines.com
# After a redeploy that changed the URL: `datumctl dns record set ...` with the
# new name, then `alb hostname add` again.
```

## Images in CI

`.github/workflows/images.yml` builds the images with Nix and pushes them to
ghcr when their inputs change on `main`: `app/` for todo-app (and its
unikernel wrap, todo-app-uk), `db/` for todo-db, `vpc-tun/` for
vpc-gateway, and `default.nix` for all three. A manual run builds all of
them. Each run lists the pushed digests in its summary; deploys stay manual,
by pinning a digest in `manifests/` and applying it.

The workflow pushes with the repository's `GITHUB_TOKEN`. Packages first
pushed from a laptop need the repository granted write access once, in each
package's settings (Manage Actions access).

## Caveats

- **A flag deploy drops `imagePullSecrets`**
  ([compute#432](https://github.com/datum-cloud/compute/issues/432)). That's
  why todo-app's image is in a public package: the flag deploy that creates
  the URL can pull it. todo-db and vpc-gateway use manifests only.
- **The runtime class can't change on an existing workload** ("field is
  immutable"). Moving classes means destroy and redeploy, which gives the
  workload a new URL; repoint the CNAME and reattach the custom hostname.
- **Data doesn't persist.** The general-purpose class has no durable disks
  yet, so a new todo-db instance starts from the seed rows.
- **A stuck instance isn't replaced.** With `OrderedReady`, an instance that
  never became ready is not rolled by a later deploy or restart
  ([compute#297](https://github.com/datum-cloud/compute/issues/297)). Destroy
  and redeploy instead, which also drops the workload's URL. This account
  can't delete a single instance. Check that a new image pulls (on a test
  workload) before rolling it out.
- **`datumctl compute exec -- cmd -h ...` fails** with "no project set":
  datumctl reads `-h` after `--` as a help flag
  ([datumctl#309](https://github.com/datum-cloud/datumctl/issues/309)). Use
  long flags such as `--host=`.
- **Exec is slow**: 4 to 14 seconds per call.
- **The URL can return 503 for a few minutes after a todo-app redeploy.** On
  4 Oct 2026 the Datum edge served its error page for about 4 minutes after a
  rollout finished, while the instance, the network service and the HTTPProxy
  all reported ready. It recovered without intervention.

## The unikernel class

todo-app runs on it. What it took, found on 4 Oct 2026:

- **Push with `datumctl compute build --push`.** It writes an image index
  whose manifest has platform `x86_64/kraftcloud`. Copying its OCI archive to
  a registry with skopeo flattened that into a bare manifest, and unikernel
  nodes then fail with `ImageUnavailable`, public registry or not. A plain
  Nix image fails the same way until it's wrapped by `datumctl compute build`.
- **Refer to the image by digest only** (`repo@sha256:...`), the form that
  pulled every time here. `repo:tag@sha256:...` was only tried with the
  flattened manifest, so whether it works on its own is unknown.
- **Private packages work with a pull secret** when datumctl pushed the image
  (verified with a test gateway image). todo-app's package is public anyway:
  the flag deploy that creates the URL can't carry the secret.
- **Capability requests are refused** ("container capability requests are not
  supported by the unikernel runtime class").
- **Traffic flows both ways on the private network.** The app reaches
  todo-db, and other instances can ping the app and connect to it on port
  8080. (An earlier test that got no answer ran against an instance built
  from the flattened image.)
- `datumctl compute exec` isn't available: the platform refuses shell
  sessions on the unikernel class.
- **vpc-gateway doesn't run on it.** A unikernel build of the gateway image
  (without its capabilities) pulled and booted, then stopped within a minute,
  before its iroh endpoint came online. No logs are available, so the exact
  failing step is unknown; its start script needs a Linux kernel's tun device,
  `/proc/sys` remount, IPv6 forwarding and proxy NDP, and the platform
  refuses the capabilities those need. Production also suspends unikernel
  instances after 1 s without traffic, which may catch a gateway that only
  dials out. Reported in
  [unikraft-provider#210](https://github.com/datum-cloud/unikraft-provider/issues/210).
  The gateway stays on general-purpose.
