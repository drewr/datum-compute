# Kubernetes on Datum unikernels

A 3-node Kubernetes cluster on Datum Compute's unikernel runtime class,
built from the upstream binaries (kubeadm, kube-apiserver, kubelet, etcd,
containerd, runc) with no distribution. It runs one workload: Caddy answering
"Hello, world!" at a Datum-managed HTTPS URL.

```
./deploy.sh build    build the node image and push it (records image/IMAGE)
./deploy.sh up       create or update the cluster and print its URL
./deploy.sh status   workloads, the cluster's nodes and pods, the URL
./deploy.sh down     delete everything up created (--keep-secrets keeps the CA)
```

`up` takes about 80 seconds from nothing to a working URL. It's safe to rerun:
it only redeploys a workload whose rendered manifest changed, because any
deploy replaces the instances and a replaced control plane starts an empty
cluster. It runs against project `project-xx4hh` as session
`draines@datum.net@api.staging.env.datum.net`; set `PROJECT` and
`DATUM_SESSION` to change that, and `IMAGE_REPO` and `PULL_SECRET` for the
image. It needs `datumctl`, `jq`, `openssl` and `curl`. `build` also needs a
container engine with BuildKit and push access to `IMAGE_REPO`.

## Files

```
deploy.sh
image/
  Dockerfile        # Debian trixie + upstream binaries; the kubelet is linked against glibc
  node.sh           # entrypoint: ROLE=cp or ROLE=worker
  probe.sh          # reports what an instance supports (see "What the unikernel class allows")
  IMAGE             # the image up deploys, by digest (written by build)
manifests/
  k8s-cp.yaml       # Workload: the control plane, 1 instance
  k8s-worker.yaml   # Workload: 2 workers
  k8s-http.yaml     # NetworkService + HTTPProxy: the URL, to the workers' port 80
addons/
  hello.yaml        # the Caddy Deployment; the control plane applies everything here
```

## How it fits together

```
browser ──HTTPS──▶ Datum proxy ──▶ k8s-worker-3 :80  (Caddy pod, host network)
                                  k8s-worker-4 :80
                                        │ kubelet
                                        ▼
                                  k8s-cp :6443  etcd, kube-apiserver, kube-controller-manager,
                                                kube-scheduler, kubelet (tainted NoSchedule)
```

- **Two workloads.** `k8s-cp` (1 instance) and `k8s-worker` (2 instances),
  both `class: unikernel`, `datumcloud-d1-standard-2` (1 vCPU, 2 GiB, the
  largest type offered), on the project's `default` network.
- **Credentials.** `up` creates a CA and a bootstrap token once and stores
  them in two Secrets: `k8s-ca` (CA certificate and key, control plane only) and
  `k8s-join` (CA certificate and token, every node). The control plane runs
  `kubeadm init phase certs`, `kubeconfig` and `bootstrap-token` against that
  CA, then starts each component by hand.
- **Joining.** Workers use standard TLS bootstrapping: the token gets their CSR
  approved and the kubelet keeps the certificate. They find the API server by
  `K8S_API`, the control plane's address, which `reclaimPolicy: Retain` keeps
  stable across redeploys.
- **Pod network.** The network delegates a /96 to each instance. Each node gives
  its pods the /112 at `+1:0` (worker `fd20:0:2d::3:0:0` hands out
  `fd20:0:2d::3:1:2` and up) on a bridge, enables forwarding, and answers
  neighbor discovery for those addresses on eth0. Pods are then ordinary hosts
  on the VPC: no overlay, no NAT, and outbound traffic works through the
  network's NAT64.
- **No kube-proxy, no Services.** The kernel has no IPv6 NAT, so ClusterIPs
  can't work. Caddy uses the host network, and the URL's NetworkService sends
  traffic to port 80 on each worker. The Deployment's anti-affinity puts one
  replica on each worker.
- **Add-ons.** ConfigMap `k8s-addons` holds `addons/`, mounted on the control
  plane, which applies it every 30 seconds. The mount is read at boot, so `up`
  counts the add-ons as part of the control plane's manifest: changing them
  redeploys the control plane.
- **The URL** comes from a NetworkService and an HTTPProxy applied by `up`,
  what `datumctl compute deploy --http-port` would create. A flag deploy drops
  `imagePullSecrets` ([compute#432](https://github.com/datum-cloud/compute/issues/432)),
  and the image is in a private package.

There's no exec on the unikernel class and no route from a laptop to the
cluster, so the control plane prints the nodes and pods whenever they change;
`./deploy.sh status` shows the latest copy. Add `--since` to
`datumctl compute logs k8s-cp` for the history.

## What the unikernel class allows

The unikernel class boots a Linux 6.12 kernel, not a library OS. `probe.sh`
(also in the image) checks each feature a node needs and starts each
component in turn. Run it by deploying a copy of `k8s-worker.yaml` with
`command: ["/probe.sh"]`, then read `datumctl compute logs`. Found on 16 October
2026, on us-central-1:

| Works | Doesn't |
|---|---|
| all capabilities (`CapEff` 000001ffffffffff); the platform refuses capability requests in the manifest, and grants them all anyway | nftables (`Protocol not supported`); iptables needs the legacy backend |
| every namespace type (`unshare -m -u -i -n -p -C`) | IPv6 NAT: ip6tables has no `nat` table, so no kube-proxy on an IPv6-only network |
| cgroup v2 with cpuset, cpu, io, memory, hugetlb, pids, once mounted at `/sys/fs/cgroup` | vxlan (`Unknown device type`), so no flannel or other overlay CNI |
| overlayfs on tmpfs; not on the root, which is itself an overlay | kernel modules: none present, and no `/lib/modules` |
| bridge, veth, IPv6 forwarding, proxy NDP | |
| IPv4 iptables NAT (legacy) | |

What `node.sh` has to do because of that:

| Without it | Fix in node.sh |
|---|---|
| etcd unreachable on 127.0.0.1 | bring up `lo`; the instance boots with loopback down |
| kubeadm rejects the node name `(none)` | set a hostname |
| containerd can't mount any image (`not supported as upperdir`) | tmpfs at `/var/lib/containerd` |
| DNS and image pulls fail once forwarding is on | re-add the default route; enabling forwarding drops the one learned from router advertisements |
| `kubelet: not found` on Alpine | a glibc base image; the upstream kubelet is dynamically linked |
| in-cluster clients go to `10.96.0.1` | unset the `KUBERNETES_*` variables the platform injects (they describe the platform's own cluster) |
| the cluster stalls for minutes at a time | the keepalive below |

### Instances are suspended when idle

Unikernel instances are suspended after one second without traffic. That's
kraftlet's scale-to-zero, a platform setting
(`scaleToZeroPolicy`/`scaleToZeroCooldownMS` in the unikraft provider's config),
not something a workload can turn off. Nothing runs while an instance is
suspended: not etcd, not the kubelet. A worker's kernel uptime advanced 85
seconds over 9 minutes of wall time. Long-lived kubelet connections to the API
server didn't prevent it.

So every node echoes on TCP port 7946 and keeps a connection to each peer
with a byte every half second. Workers start with the control plane as a
peer; every node adds whoever connects to it, so the control plane finds the
workers again after a restart. Each node logs `uptime Ns` every minute. With
the keepalive, uptime kept pace with the clock on all three nodes through
every run.

## Caveats

- **A control plane restart wipes the cluster.** etcd lives on the instance and
  there's no durable disk. The new control plane re-creates the bootstrap token
  and the add-ons. Each worker's kubelet keeps its certificate but doesn't
  register again on its own, so `node.sh` restarts it once its Node has been
  missing for two minutes. Measured: the cluster was whole again about 5
  minutes after `datumctl compute restart k8s-cp`, with no traffic from
  outside. The URL kept answering throughout, since the workers' Caddy
  containers kept running.
- **Any deploy replaces every instance of a workload**, even an unchanged one.
  That's why `up` skips workloads whose `k8s-demo/manifest` annotation matches.
- **One vCPU per node.** The API server took 5 to 100 seconds to become ready,
  and the control plane used about 500 MiB of its 2 GiB. Each component runs
  with a `GOMEMLIMIT`.
- **Single control plane, no CoreDNS, no Services, no metrics.** Enough for one
  host-network workload; most charts would need ClusterIP Services.
- **The keepalive is a workaround.** If the platform changes its suspension rule
  (for example, to suspend instances with idle connections, kraftlet's `idle`
  policy), it may stop working. The uptime lines show it.
