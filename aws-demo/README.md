# aws-demo: Datum Connect from EC2 instances around the world

This demo puts small EC2 instances in many AWS regions onto one private Datum network (a VPC),
then measures how far apart they are from each other and from Datum's relays. It runs on Datum
staging. Everything here is scripted, so you can build it, look at it and tear it down:

```
bin/setup [N]            N random regions from the pool (default 3); REGIONS="a b" for a list
bin/status               instances, SSM state, the gateway, each member's address
bin/netcheck [REGION]    netcheck on one instance (random if no region); fetches ssm-session-manager-plugin via nix-shell if missing
bin/login REGION [cmd]   shell (or one command) on that region's instance, e.g. bin/login eu-west-2 netcheck
bin/teardown [--purge]   delete everything setup created
```

You need `aws` and `datumctl` logged in, plus `jq` and, for `bin/login`, `session-manager-plugin` (nixpkgs: `ssm-session-manager-plugin`; `bin/netcheck` fetches it with nix-shell).
The AWS account comes from `aws sts get-caller-identity` and the Datum org and project from
`datumctl whoami` (override with `ORG=` and `PROJECT=`). Run `bin/setup` again to resume or repair.

The rest of this file explains how the pieces fit together, in the order you would build them by hand.

## 1. The idea

Datum Connect lets a machine anywhere join a Datum VPC over iroh (QUIC, relayed when it cannot go
direct). A device runs a small daemon, enrols with Datum as a *connector*, and joins a *network*.
Datum assigns it an IPv6 `/128` from the network's prefix and routes traffic to the other members
through a *gateway*, a workload running in a Datum location.

So the demo needs three things: a network and gateway in Datum, an identity per instance, and the
instances themselves.

## 2. A network and one gateway

```
Network         aws-test-net                    IPv6 /48 allocated by Datum, mtu 1440
ConnectGateway  connect-aws-test-net-us-east-1  class standard, peerRouting true, routes = the /48
```

`peerRouting: true` is what lets members reach each other, not just the gateway. A member only
routes to peers on the *same* gateway and gateways do not route to each other, so for the members
to see each other all of them must attach to one gateway. Traffic between two instances therefore
goes through the gateway, hub and spoke, which is what the latency numbers measure.

The fleet gets its own network rather than sharing an existing one, so its semantics stay simple.
Staging has only two Datum locations, `us-central-1` and `us-east-1`; the gateway lives in `us-east-1`.

## 3. One Datum identity per instance

Each instance gets its own service account so it can be attributed and revoked on its own:

- a `ServiceAccount` `aws-test-<region>-1`;
- a `ServiceAccountKey`, whose private key is returned once and piped straight into AWS SSM
  Parameter Store as a SecureString at `/datum-test/<region>-1/key`. It is never printed or
  written to disk, and never put in user-data;
- a `PolicyBinding` to the `editor` role on the project. `editor` is the only assignable role
  that inherits connect admin on staging, so it is broader than we would like (see the end).

## 4. The AWS side

Per region, in the default VPC:

- an IAM role and instance profile `datum-test-<region>-1` under the permissions boundary
  `datum-test-instance-boundary`. The role can read only its own key parameter (and decrypt via SSM)
  and talk to Systems Manager. It cannot do anything else;
- a security group with **no inbound rules**;
- a `t4g.micro` instance running Ubuntu 24.04 arm64 (the connect binaries need glibc 2.39 or later,
  so Amazon Linux 2023 does not work), with IMDSv2 required and a hop limit of 1;
- every resource tagged `project=datum-connect-test`.

There is no SSH. You reach an instance through SSM Session Manager (`bin/login`), using the
`AWS-StartInteractiveCommand` document.

`iam/operator.json` is the least-privilege policy the AWS operator ran under: EC2, IAM and SSM
actions limited by tag, by the `datum-test-*` name prefix, by the permissions boundary, and by a
region allow-list matching the default pool. An AWS admin sets this up once; the scripts do not:
create the boundary policy from `iam/boundary.json` (the operator can only read it), create the
policy from `iam/operator.json`, and attach it to an IAM user (we use `alice`). Replace `__ACCOUNT__`
with the account id first.

## 5. What runs on each instance

`bin/setup` sends three scripts to each instance over SSM Run Command, in order:

1. `files/install.sh`: packages, AWS CLI v2, and the Datum binaries (`datumctl`, the `connect` and
   `compute` plugins), each downloaded with its sha256 checked.
2. `files/patch-edge.sh`: makes every instance pick the same gateway (next section).
3. `files/bootstrap.sh`: fetches the instance's key from SSM and builds a credentials file by adding
   `project_id`, `api_endpoint` and `token_uri`; installs the network helper with the exact default
   managed policy (a narrowed one is rejected); runs the daemon as the non-root user `datum`
   under a user systemd service with lingering; enrols with `connect up --name aws-test-<region>-1`
   (names must be unique, hostnames collide); runs `connect join aws-test-net`; and finally
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
    * Connector: aws-test-eu-west-2-1
    * IPv4: ...            * IPv6: no
    * Edge-reported location: ...
    * VPC: aws-test-net   address: fd20:...
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

## 8. Tearing down

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
bin/        setup, teardown, status, login
lib/        common.sh (account/org/project discovery, SSM runner)
files/      on-instance: install.sh, patch-edge.sh, bootstrap.sh, netcheck
iam/        boundary, instance policy, trust, operator policy (templates: __ACCOUNT__, __REGION__)
state/      git-ignored: chosen regions and logs (logs/<region>.log has each instance's output)
```

Environment overrides: `NET`, `GW_LOCATION`, `INSTANCE_TYPE`, `POOL`, `REGIONS`, `ORG`, `PROJECT`,
`API_ENDPOINT`, `TOKEN_URI`, `DATUMCTL_VERSION`, `CONNECT_VERSION`, `COMPUTE_VERSION`.
