#!/bin/sh
# Probe how much of a standard Kubernetes node comes up on this instance. Every
# step logs "== <step>: OK|FAIL" and the script never exits, so the result can
# be read with `datumctl compute logs` and at http://<instance>:8080/.
# Steps run in order; a step whose prerequisite failed is skipped.
R=/www/index.txt
mkdir -p /www /var/log/k8s
: >"$R"
log()  { echo "$*" | tee -a "$R"; }
ok()   { log "== $1: OK${2:+ ($2)}"; }
bad()  { log "== $1: FAIL${2:+ ($2)}"; }
tailf() { tail -n "${2:-15}" "$1" 2>/dev/null | sed 's/^/   | /' | tee -a "$R"; }
oneline() { echo "$*" | tail -3 | tr '\n' ' '; }

# wait_for SECONDS CMD...: rerun CMD every 2s until it succeeds.
wait_for() { t=$1; shift; while [ "$t" -gt 0 ]; do "$@" >/dev/null 2>&1 && return 0; sleep 2; t=$((t - 2)); done; return 1; }

# The instance boots with loopback down and no hostname.
ip link set lo up 2>/dev/null
ip addr add 127.0.0.1/8 dev lo 2>/dev/null
ip -6 addr add ::1/128 dev lo 2>/dev/null
IP=$(ip -o -6 addr show scope global 2>/dev/null | awk '{sub(/\/.*/,"",$4); print $4; exit}')
NODE=${NODE_NAME:-k8s-$(echo "$IP" | sed 's/:/-/g; s/--*/-/g; s/-$//')}
hostname "$NODE" 2>/dev/null
echo "$NODE" >/etc/hostname
echo "$IP $NODE" >>/etc/hosts
# The network delegates a /96 to each instance (IP is its base, ending :0:0).
# Pods get addresses from the /112 at +1:0, routed on the VPC like any host.
BASE=${IP%:0:0}
PODNET=$BASE:1:0/112 PODGW=$BASE:1:1

if busybox httpd -p 8080 -h /www 2>/dev/null; then log "(report served on :8080)"; else log "(no httpd)"; fi

# The platform injects its own cluster's KUBERNETES_* variables; they would
# point in-cluster clients at the wrong API server.
for v in $(env | sed -n 's/^\(KUBERNETES_[A-Z0-9_]*\)=.*/\1/p'); do unset "$v"; done
# Every call gets a timeout: with one vCPU a busy apiserver can stall a request.
kubectl() { command kubectl --request-timeout=10s "$@"; }
# 1 vCPU and 2 GiB: cap each Go process's heap so they fit together.
export GOGC=50

# /www/stats.txt: memory, load and the biggest processes, every 5s.
( while true; do
    { date -u +%T; grep -E 'MemAvailable|MemFree|Shmem:' /proc/meminfo; cat /proc/loadavg
      ps -eo pid,rss,comm --sort=-rss 2>/dev/null | head -9; } >/www/stats.tmp 2>&1
    mv /www/stats.tmp /www/stats.txt; sleep 5
  done ) &

log "## environment"
log "kernel: $(uname -a 2>&1)"
log "cpus: $(grep -c ^processor /proc/cpuinfo 2>&1)  mem: $(grep MemTotal /proc/meminfo 2>&1)"
log "pid: $$  uid: $(id -u 2>&1)  node: $NODE  ip: $IP  pods: $PODNET"
grep -E '^Cap(Eff|Bnd)' /proc/self/status 2>&1 | sed 's/^/  /' | tee -a "$R"
log "env: $(env | grep -v -i -E 'token|secret|key|pass' | sort | tr '\n' ' ')"
if [ -r /proc/config.gz ]; then
  log "kernel config: $(zcat /proc/config.gz | grep -E '^CONFIG_(MODULES|NF_TABLES|NFT_NAT|NFT_MASQ|NFT_CT|IP_NF_IPTABLES|IP6_NF_IPTABLES|IP_NF_NAT|IP6_NF_NAT|NETFILTER_XT_MATCH_CONNTRACK|NF_CONNTRACK|NF_NAT|BRIDGE|BRIDGE_NETFILTER|VETH|VXLAN|IP_VS|BPF_SYSCALL|CGROUP_BPF|WIREGUARD)=' | tr '\n' ' ')"
else log "kernel config: no /proc/config.gz"; fi
log "modules dir: $(ls /lib/modules 2>&1 | tr '\n' ' ')  loaded: $(cut -d' ' -f1 /proc/modules 2>&1 | tr '\n' ' ')"
log "mounts:"; sed 's/^/  /' /proc/mounts 2>&1 | tee -a "$R"
log "routes:"; ip -6 route 2>&1 | sed 's/^/  /' | tee -a "$R"
log "resolv.conf: $(tr '\n' ' ' </etc/resolv.conf 2>&1)"

log "## kernel features"
if out=$(mount -t cgroup2 none /sys/fs/cgroup 2>&1); then
  ctl=$(cat /sys/fs/cgroup/cgroup.controllers 2>&1)
  for c in $ctl; do echo "+$c" >/sys/fs/cgroup/cgroup.subtree_control 2>/dev/null; done
  ok cgroup2 "controllers: $ctl; enabled: $(cat /sys/fs/cgroup/cgroup.subtree_control 2>&1 | tr '\n' ' ')"
else bad cgroup2 "$out"; fi
mkdir -p /mnt/o /var/lib/containerd /var/lib/kubelet
if out=$(mount -t tmpfs tmpfs /mnt/o 2>&1) && mkdir -p /mnt/o/l /mnt/o/u /mnt/o/w /mnt/o/m &&
   out=$(mount -t overlay overlay -o lowerdir=/mnt/o/l,upperdir=/mnt/o/u,workdir=/mnt/o/w /mnt/o/m 2>&1); then ok "overlay on tmpfs"
else bad "overlay on tmpfs" "$out"; fi
mount -t tmpfs tmpfs /var/lib/containerd
for t in iptables ip6tables iptables-legacy ip6tables-legacy; do
  if out=$($t -t nat -L -n 2>&1); then ok "$t"; else bad "$t" "$(oneline "$out")"; fi
done
if out=$(ip link add k8sbr0 type bridge 2>&1); then ok bridge; ip link del k8sbr0; else bad bridge "$out"; fi
if out=$(ip link add k8sv0 type veth peer name k8sv1 2>&1); then ok veth; ip link del k8sv0; else bad veth "$out"; fi
if out=$(ip link add k8sx0 type vxlan id 42 dstport 4789 dev eth0 2>&1); then ok vxlan; ip link del k8sx0; else bad vxlan "$out"; fi
# Turning on forwarding drops the default route learned from router
# advertisements, so keep accepting them and pin the route as it was.
DEFROUTE=$(ip -6 route show default | head -1 | sed 's/ proto [a-z]*//; s/ expires [0-9a-z]*//')
if out=$(sh -c 'echo 2 >/proc/sys/net/ipv6/conf/eth0/accept_ra && echo 1 >/proc/sys/net/ipv6/conf/all/forwarding && echo 1 >/proc/sys/net/ipv6/conf/eth0/proxy_ndp' 2>&1); then
  ip -6 route replace $DEFROUTE 2>/dev/null
  ok "ipv6 forwarding+proxy_ndp" "default route: $(ip -6 route show default | head -1)"
else bad "ipv6 forwarding+proxy_ndp" "$out"; fi

log "## etcd"
GOMEMLIMIT=200MiB etcd --quota-backend-bytes=268435456 --data-dir /var/lib/etcd --listen-client-urls http://127.0.0.1:2379 \
  --advertise-client-urls http://127.0.0.1:2379 --listen-peer-urls http://127.0.0.1:2380 \
  >/var/log/k8s/etcd.log 2>&1 &
if wait_for 60 etcdctl --endpoints http://127.0.0.1:2379 endpoint health; then ETCD=1; ok etcd
else bad etcd "$(etcdctl --endpoints http://127.0.0.1:2379 endpoint health 2>&1 | tail -2 | tr '\n' ' ')"; tailf /var/log/k8s/etcd.log 5; fi

log "## certificates (kubeadm init phase)"
cat >/etc/kubeadm.yaml <<EOF
apiVersion: kubeadm.k8s.io/v1beta4
kind: InitConfiguration
localAPIEndpoint: { advertiseAddress: "$IP", bindPort: 6443 }
nodeRegistration: { name: "$NODE" }
---
apiVersion: kubeadm.k8s.io/v1beta4
kind: ClusterConfiguration
kubernetesVersion: v1.37.1
controlPlaneEndpoint: "[$IP]:6443"
networking: { serviceSubnet: "fd00:10:96::/112" }
EOF
if out=$(kubeadm init phase certs all --config /etc/kubeadm.yaml 2>&1) &&
   out=$(kubeadm init phase kubeconfig all --config /etc/kubeadm.yaml 2>&1); then CERTS=1; ok certs
else bad certs "$(oneline "$out")"; fi
P=/etc/kubernetes/pki K=/etc/kubernetes
# admin.conf's group has no binding until kubeadm init creates one.
export KUBECONFIG=$K/super-admin.conf

log "## kube-apiserver"
if [ -n "${ETCD:-}" ] && [ -n "${CERTS:-}" ]; then
  GOMEMLIMIT=600MiB kube-apiserver --etcd-servers=http://127.0.0.1:2379 --advertise-address="$IP" --bind-address=:: \
    --secure-port=6443 --service-cluster-ip-range=fd00:10:96::/112 --authorization-mode=Node,RBAC \
    --client-ca-file=$P/ca.crt --tls-cert-file=$P/apiserver.crt --tls-private-key-file=$P/apiserver.key \
    --kubelet-client-certificate=$P/apiserver-kubelet-client.crt --kubelet-client-key=$P/apiserver-kubelet-client.key \
    --service-account-issuer=https://kubernetes.default.svc --service-account-key-file=$P/sa.pub \
    --service-account-signing-key-file=$P/sa.key --enable-admission-plugins=NodeRestriction \
    >/var/log/k8s/apiserver.log 2>&1 &
  if wait_for 180 kubectl get --raw /readyz; then API=1; ok kube-apiserver "$(kubectl version 2>&1 | tail -1)"
  else bad kube-apiserver; tailf /var/log/k8s/apiserver.log 25; fi
else log "   skipped"; fi

log "## kube-controller-manager and kube-scheduler"
if [ -n "${API:-}" ]; then
  GOMEMLIMIT=200MiB kube-controller-manager --kubeconfig=$K/controller-manager.conf --bind-address=:: \
    --cluster-signing-cert-file=$P/ca.crt --cluster-signing-key-file=$P/ca.key \
    --root-ca-file=$P/ca.crt --service-account-private-key-file=$P/sa.key --use-service-account-credentials \
    --service-cluster-ip-range=fd00:10:96::/112 \
    >/var/log/k8s/controller-manager.log 2>&1 &
  GOMEMLIMIT=100MiB kube-scheduler --kubeconfig=$K/scheduler.conf --bind-address=:: >/var/log/k8s/scheduler.log 2>&1 &
  if wait_for 90 kubectl get lease -n kube-system kube-controller-manager kube-scheduler; then
    ok "controller-manager+scheduler" "both hold leader leases"
  else bad "controller-manager+scheduler"; tailf /var/log/k8s/controller-manager.log; tailf /var/log/k8s/scheduler.log; fi
else log "   skipped"; fi

log "## containerd"
mkdir -p /etc/containerd /run/containerd
containerd config default >/etc/containerd/config.toml 2>/dev/null
GOMEMLIMIT=100MiB containerd >/var/log/k8s/containerd.log 2>&1 &
if wait_for 30 ctr version; then CTRD=1; ok containerd
  if out=$(ctr images pull docker.io/library/busybox:1.37 2>&1) &&
     out=$(ctr run --rm docker.io/library/busybox:1.37 probe echo hello-from-runc 2>&1); then RUNC=1; ok "runc container" "$out"
  else bad "runc container" "$(oneline "$out")"; fi
else bad containerd; tailf /var/log/k8s/containerd.log; fi

log "## CNI: bridge, pods in $PODNET"
mkdir -p /etc/cni/net.d
cat >/etc/cni/net.d/10-pods.conflist <<EOF
{ "cniVersion": "1.0.0", "name": "pods", "plugins": [
  { "type": "bridge", "bridge": "cni0", "isGateway": true, "ipMasq": false,
    "ipam": { "type": "host-local", "ranges": [[{ "subnet": "$PODNET", "rangeStart": "$BASE:1:2", "gateway": "$PODGW" }]],
              "routes": [{ "dst": "::/0" }] } },
  { "type": "portmap", "capabilities": { "portMappings": true } } ] }
EOF
# Answer neighbor discovery on eth0 for the first pod addresses, so the VPC
# delivers their traffic to this instance.
i=2; while [ $i -le 64 ]; do ip -6 neigh add proxy "$BASE:1:$(printf %x $i)" dev eth0 2>/dev/null; i=$((i + 1)); done
log "   proxy ndp entries: $(ip -6 neigh show proxy 2>/dev/null | wc -l)"

log "## kubelet"
if [ -n "${API:-}" ] && [ -n "${CTRD:-}" ]; then
  cat >/etc/kubernetes/kubelet.yaml <<EOF
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
cgroupDriver: cgroupfs
failSwapOn: false
address: "::"
authentication: { x509: { clientCAFile: $P/ca.crt }, webhook: { enabled: false }, anonymous: { enabled: false } }
authorization: { mode: AlwaysAllow }
EOF
  GOMEMLIMIT=150MiB kubelet --kubeconfig=$K/kubelet.conf --config=/etc/kubernetes/kubelet.yaml \
    --container-runtime-endpoint=unix:///run/containerd/containerd.sock --node-ip="$IP" --hostname-override="$NODE" \
    >/var/log/k8s/kubelet.log 2>&1 &
  if wait_for 120 sh -c "kubectl --request-timeout=10s get node $NODE -o jsonpath='{.status.conditions[?(@.type==\"Ready\")].status}' | grep -qx True"; then
    NODEOK=1; ok kubelet "$(kubectl get nodes -o wide --no-headers 2>&1)"
  else bad kubelet "$(kubectl get nodes --no-headers 2>&1)"; tailf /var/log/k8s/kubelet.log 25; fi
else log "   skipped"; fi

log "## a pod"
if [ -n "${NODEOK:-}" ]; then
  kubectl run hello --image=docker.io/library/busybox:1.37 --restart=Never -- sh -c 'ip -6 addr; wget -qO- -T 5 http://[64:ff9b::101:101]/ >/dev/null && echo egress-ok; sleep 3600' >/dev/null 2>&1
  if wait_for 120 sh -c "kubectl --request-timeout=10s get pod hello -o jsonpath='{.status.phase}' | grep -qx Running"; then
    sleep 8; ok pod "$(kubectl get pod hello -o wide --no-headers 2>&1)"; kubectl logs hello 2>&1 | sed 's/^/   | /' | tee -a "$R"
    PODIP=$(kubectl get pod hello -o jsonpath='{.status.podIP}')
    if ping -c 2 -W 2 "$PODIP" >/dev/null 2>&1; then ok "node to pod ping"; else bad "node to pod ping"; fi
  else bad pod "$(kubectl describe pod hello 2>&1 | tail -8 | tr '\n' ' ')"; tailf /var/log/k8s/kubelet.log 15; fi
else log "   skipped"; fi

log "## done; logs in /var/log/k8s"
while true; do sleep 3600; done
