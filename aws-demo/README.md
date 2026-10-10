# aws-demo: Datum Connect from EC2 instances around the world

This demo puts small EC2 instances in many AWS regions onto one private Datum network (a VPC),
then measures how far apart they are from each other and from Datum's relays. It runs on Datum
staging. Everything here is scripted, so you can build it, look at it and tear it down:

```
bin/setup [N]            N random regions from the pool (default 3); re-run to repair
bin/setup --add [N]     add N more random regions to the fleet; REGIONS="a b" adds those
bin/status               instances, SSM state, the gateway, each member's address
bin/netcheck [REGION]    netcheck on one instance (random if no region)
bin/visual               deploy/refresh the visual netcheck (a map of the fleet) and print its URL
bin/login REGION [cmd]   shell (or one command) on that region's instance, e.g. bin/login eu-west-2 netcheck
bin/bootstrap-iam        one-time, as an AWS admin: create the operator user and local profile
bin/teardown [--purge]   delete everything setup created (KEEP_NET=1 keeps the network, gateway and viewer)
```

You need `aws` and `datumctl` logged in, plus `jq` and, for `bin/login`, `session-manager-plugin`. `nix develop` (see `flake.nix`) provides everything except `datumctl`, which is not in nixpkgs; `bin/login` and `bin/netcheck` also fetch the plugin with nix-shell if it is missing.
The AWS account comes from `aws sts get-caller-identity` and the Datum org and project from
`datumctl whoami` (override with `ORG=` and `PROJECT=`). Run `bin/setup` again to resume or repair.

**Fleet name.** Every resource, AWS and Datum, is named after the fleet: `FLEET_PREFIX` (default
`drewr-`) plus the AWS user name, lowercased, such as `drewr-demo261009`. Members are
`<fleet>-<region>`, the network is `<fleet>-net` and state lives in `state/<fleet>/`, so fleets of
different users can run side by side in one account and Datum project. The Datum gateway quota (3 on
staging) and `bin/teardown --purge` (it deletes the account's shared boundary policy) are the limits.
Set `FLEET` to override the name. The operator policy grants only names that start with
`<FLEET_PREFIX><user name>-`, so re-run `bin/bootstrap-iam` after changing the naming.

The rest of this file explains how the pieces fit together, in the order you would build them by hand.

## 1. The idea

Datum Connect lets a machine anywhere join a Datum VPC over iroh (QUIC, relayed when it cannot go
direct). A device runs a small daemon, enrols with Datum as a *connector*, and joins a *network*.
The gateway gives it an IPv6 `/128` (a hash of the project, network and device keys, so it lies outside the
network's prefix) and routes traffic to the other members
through a *gateway*, a workload running in a Datum location.

So the demo needs three things: a network and gateway in Datum, an identity per instance, and the
instances themselves.

## 2. A network and one gateway

```
Network         <fleet>-net                     IPv6 /48 allocated by Datum, mtu 1440
ConnectGateway  connect-<fleet>-net-us-east-1   class standard, peerRouting true, routes = the /48
```

`peerRouting: true` is what lets members reach each other, not just the gateway. A member only
routes to peers on the *same* gateway and gateways do not route to each other, so for the members
to see each other all of them must attach to one gateway. Traffic between two instances therefore
goes through the gateway, hub and spoke, which is what the latency numbers measure.

The fleet gets its own network rather than sharing an existing one, so its semantics stay simple.
Staging has only two Datum locations, `us-central-1` and `us-east-1`; the gateway lives in `us-east-1`.

## 3. One Datum identity per instance

Each instance gets its own service account so it can be attributed and revoked on its own:

- a `ServiceAccount` `<fleet>-<region>`;
- a `ServiceAccountKey`, whose private key is returned once and piped straight into AWS SSM
  Parameter Store as a SecureString at `/<fleet>/<region>/key`. It is never printed or
  written to disk, and never put in user-data;
- a `PolicyBinding` to the `editor` role on the project. `editor` is the only assignable role
  that inherits connect admin on staging, so it is broader than we would like (see the end).

## 4. The AWS side

Per region, in the default VPC:

- an IAM role and instance profile `<fleet>-<region>` under the permissions boundary
  `<prefix>boundary`. The role can read only its own key parameter (and decrypt via SSM)
  and talk to Systems Manager. It cannot do anything else;
- a security group with **no inbound rules**;
- a `t4g.micro` instance running Ubuntu 24.04 arm64 (the connect binaries need glibc 2.39 or later,
  so Amazon Linux 2023 does not work), with IMDSv2 required and a hop limit of 1;
- every resource tagged `project=datum-connect-test` and `fleet=<FLEET_PREFIX><AWS user name>` (default prefix `drewr-`, so `drewr-demo261009`; set `FLEET_PREFIX` to change it). Resources made before the fleet tag existed lack it.

There is no SSH. You reach an instance through SSM Session Manager (`bin/login`), using the
`AWS-StartInteractiveCommand` document.

`iam/operator.json` is the least-privilege policy the AWS operator ran under: EC2, IAM and SSM
actions limited by tag, by the operator's own fleet name (`<prefix><user>-*`, using the IAM policy variable `aws:username`), by the permissions boundary, and by a
region allow-list matching the default pool. An AWS admin sets this up once with `bin/bootstrap-iam`
(below); after that the admin profile is not needed.

### First-time AWS account setup

```
AWS_PROFILE=<admin> bin/bootstrap-iam        # --dry-run to preview, --yes to skip the prompt
export AWS_PROFILE=datum-demo-<account-id>   # the profile it writes; then bin/setup as usual
```

It creates the permissions boundary (`iam/boundary.json`), the operator policy `<prefix>operator`
(`iam/operator.json`), a fresh IAM user `demoYYMMDD` with that policy, and an access key written straight to a
local profile (`datum-demo-<account-id>`, never printed). Re-running updates a changed policy and
keeps the user and profile if the profile still works. Override with `IAM_USER`, `OPERATOR_POLICY`, `PROFILE`, `PROFILE_REGION`.
It needs IAM write access, so use an admin identity; it refuses to run as the operator user.

## 5. What runs on each instance

`bin/setup` sends three scripts to each instance over SSM Run Command, in order:

1. `files/install.sh`: packages, AWS CLI v2, and the Datum binaries (`datumctl`, the `connect` and
   `compute` plugins), each downloaded with its sha256 checked.
2. `files/patch-edge.sh`: makes every instance pick the same gateway (next section).
3. `files/bootstrap.sh`: fetches the instance's key from SSM and builds a credentials file by adding
   `project_id`, `api_endpoint` and `token_uri`; installs the network helper with the exact default
   managed policy (a narrowed one is rejected); runs the daemon as the non-root user `datum`
   under a user systemd service with lingering; enrols with `connect up --name <fleet>-<region>`
   (names must be unique, hostnames collide); runs `connect join <fleet>-net`; and finally
   deletes the key and credentials.

## 6. Making all instances use the one gateway

`connect join` asks `https://edge.datum.net/` which Datum region is nearest, then looks for a
gateway for that network at that location, creating one if none exists. That endpoint is the
production anycast, which does not know about staging's two locations, and a service account may
not create gateways. An instance in Tokyo would be sent to a location where no gateway exists.

For this test fleet `files/patch-edge.sh` byte-replaces that URL inside `datum-connectd` (same
length, original kept as `datum-connectd.orig`) with `http://127.0.0.1:8080/x`, and runs a tiny
systemd service answering `region=us-east-1`. Every instance then joins the `us-east-1` gateway.
This is a test-fleet hack, not something to do in production.

## 7. netcheck

After the joins, setup installs `/usr/local/bin/netcheck` and a list of members on every instance:

```
$ bin/login eu-west-2 netcheck
Report:
    * This machine's region: eu-west-2
    * Connector: <fleet>-eu-west-2
    * IPv4: ...            * IPv6: no
    * Edge-reported location: ...
    * VPC: <fleet>-net   address: fd20:...
    * Gateway: ...
    * Transport: ...
    * Relay latency (TLS):
        - us-central-1 = ...ms
        - us-east-1 = ...ms
    * VPC member latency:
        - fd20:...	us-east-1	92.4ms        (ip, region, ping; sorted, tab separated)
```

The relay times are TLS handshake times to the two staging iroh relays. The member latencies are
three pings to each other member. The member list is a snapshot from setup; re-run `bin/setup`
after changing the fleet.

## 8. The visual netcheck

`bin/setup` ends by deploying `bin/visual`: a Datum compute instance on the same network that draws
every member on a world map with live round-trip times. It is the [Global Mesh
demo](https://github.com/datum-labs/compute-network-demo) (AGPL-3.0, vendored in `visual/`) with three
changes: AWS regions in the city table, a `MESH_SELF_LOCATION` setting so the viewer can place itself,
and a push mode (`MESH_PUSH_TOKEN`).

- Each EC2 member runs `files/mesh-responder.py` (systemd, port 8081). It measures a round trip to
  every other member and to the viewer, and POSTs its report to the viewer every two seconds.
- Push, not pull, because the viewer can reach a member's address only by replying to it; the members
  are peer-routed `/128`s that the VPC does not route to. The viewer accepts reports with a shared
  token (`state/visual.token`), since its public URL is on the internet.
- The viewer is a `general-purpose` Workload (`<fleet>-viewer`) in `$GW_LOCATION` on `$NET`, with a
  NetworkService and an HTTPProxy for the public URL. Latencies are hub-and-spoke through the gateway,
  the same as netcheck's.
- The image is built by `visual/build.sh` (docker; pushes `ghcr.io/drewr/global-mesh-aws` using
  `gh auth token`, needs `write:packages`) and pinned by digest in `visual/IMAGE`. The package is
  private; the project needs an image pull secret (`PULL_SECRET`, default `ghcr-drewr`).
- `VISUAL=0 bin/setup` skips it. `bin/visual --delete` removes it; `bin/teardown` does too.
  Re-run `bin/visual` after the fleet changes.

## 9. Tearing down

`bin/teardown` terminates the instances and deletes, per region, the security group, instance
profile, role and SSM key; and in Datum, each connector and network binding, policy binding,
service account key and service account, then the gateway and network. `--purge` also deletes the
shared permissions boundary policy. The original network and gateway in the project are not touched.

## Things to know

- **Gateway quota.** The staging project allows only a few ConnectGateways (3). A gateway's quota
  claims (`<gateway>-quota-*` ResourceClaims) can outlive it and keep consuming quota; deleting
  them needs a staff identity (`datumctl auth switch <staff user>`, then `--project <project>`).
- **Broad binding.** The service accounts hold `editor`. Push for a narrow connect role before any
  use outside staging. Teardown removes the bindings.
- **Public IPv4.** Instances use the default VPC with a public IPv4 address for outbound internet
  only; nothing can connect in. An IPv6-only variant needs IPv6 VPCs, an egress-only internet
  gateway and an S3 mirror for the binaries (GitHub and the `ec2messages` endpoint have no IPv6).
  It is not built.
- **Latency.** Numbers seen on staging ranged from about 20 to 430 ms between instances. They are
  untuned; analysis is future work.
- **Account limits.** AWS can refuse `RunInstances` for an account (billing, verification); setup
  then stops at the launch step and can be re-run after it clears.

## Layout and settings

```
bin/        bootstrap-iam, setup, teardown, status, login, netcheck, visual
lib/        common.sh (account/org/project discovery, SSM runner)
files/      on-instance: install.sh, patch-edge.sh, bootstrap.sh, netcheck, mesh-responder.py
visual/     the viewer (Go + React) and build.sh
iam/        boundary, instance policy, trust, operator policy (templates: __ACCOUNT__, __REGION__)
state/      git-ignored: chosen regions and logs (logs/<region>.log has each instance's output)
```

Environment overrides: `NET`, `GW_LOCATION`, `INSTANCE_TYPE`, `POOL`, `REGIONS`, `ORG`, `PROJECT`,
`API_ENDPOINT`, `TOKEN_URI`, `DATUMCTL_VERSION`, `CONNECT_VERSION`, `COMPUTE_VERSION`.
