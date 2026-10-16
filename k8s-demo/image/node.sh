#!/bin/sh
# A Kubernetes node on a Datum unikernel instance, from upstream binaries.
#
#   ROLE=cp      kine (SQLite), kube-apiserver, kube-controller-manager, kube-scheduler,
#                and a kubelet tainted NoSchedule. Applies every manifest in
#                /etc/k8s/addons every 30s.
#   ROLE=worker  a kubelet that joins K8S_API with a bootstrap token.
#
# Mounted Secrets: /secrets/k8s-join (ca.crt, token) on every node and
# /secrets/k8s-ca (ca.crt, ca.key) on the control plane.
#
# There is no exec on the unikernel class, so the control plane prints the
# nodes and pods whenever they change: read them with `datumctl compute logs k8s-cp`.
set -u
log() { echo "k8s-node: $*"; }
die() { log "fatal: $*"; while true; do sleep 3600; done; }
# wait_for SECONDS CMD...: rerun CMD every 2s until it succeeds.
wait_for() { t=$1; shift; while [ "$t" -gt 0 ]; do "$@" >/dev/null 2>&1 && return 0; sleep 2; t=$((t - 2)); done; return 1; }

ROLE=${ROLE:?set ROLE to cp or worker}
P=/etc/kubernetes/pki K=/etc/kubernetes L=/var/log/k8s
SERVICE_CIDR=fd00:10:96::/112
mkdir -p $P $L /var/lib/kubelet /var/lib/containerd /etc/cni/net.d /etc/containerd

# The platform injects its own cluster's KUBERNETES_* variables; in-cluster
# clients would follow them to the wrong API server.
for v in $(env | sed -n 's/^\(KUBERNETES_[A-Z0-9_]*\)=.*/\1/p'); do unset "$v"; done
# One vCPU and 2 GiB per instance: collect garbage early, cap each heap below.
export GOGC=50

# --- host setup -------------------------------------------------------------
# The instance boots with loopback down and no hostname.
ip link set lo up
ip addr add 127.0.0.1/8 dev lo 2>/dev/null
ip -6 addr add ::1/128 dev lo 2>/dev/null
IP=$(ip -o -6 addr show dev eth0 scope global | awk '{sub(/\/.*/,"",$4); print $4; exit}')
[ -n "$IP" ] || die "no global IPv6 address on eth0"
# The network delegates a /96 to each instance; IP is its base (it ends :0:0).
# Pods get the /112 at +1:0 and are routed on the VPC like any other host, so
# pod traffic between nodes needs no overlay (the kernel has no vxlan anyway).
BASE=${IP%:0:0}
[ "$BASE" != "$IP" ] || die "address $IP is not the base of a /96"
if [ "$ROLE" = cp ]; then NODE=k8s-cp; else NODE=k8s-worker-${BASE##*:}; fi
hostname "$NODE"
echo "$NODE" >/etc/hostname
echo "$IP $NODE" >>/etc/hosts
log "role $ROLE, node $NODE, address $IP, pods $BASE:1:0/112"

# Unikernel instances are suspended after 1s without traffic (kraftlet's
# scale-to-zero, a platform setting), and nothing runs while one is
# suspended: not kine, not the kubelet. So every node echoes on port 7946 and
# keeps a connection to each peer with a byte every half second. Workers start
# with the control plane as their peer; every node adds whoever connects to
# it, so the control plane finds the workers (and finds them again after a
# restart) without Kubernetes. A suspended peer takes a few seconds to wake,
# hence the long connect timeout. Each node logs its uptime every minute:
# uptime that falls behind the clock means suspensions.
touch /run/peers /run/keepalive
socat TCP6-LISTEN:7946,fork,reuseaddr SYSTEM:'echo "$SOCAT_PEERADDR" >>/run/peers; exec cat' >/dev/null 2>&1 &
keepalive() {
  while true; do
    { while echo; do sleep 0.5; done; } 2>/dev/null | socat - "TCP6:[$1]:7946,connect-timeout=60" >/dev/null 2>&1
    sleep 0.2
  done
}
( while true; do
    for a in $(tr -d '[]' </run/peers | sort -u); do
      grep -qxF "$a" /run/keepalive || { echo "$a" >>/run/keepalive; keepalive "$a" & }
    done
    sleep 2
  done ) &
( while true; do log "uptime $(cut -d' ' -f1 /proc/uptime)s"; sleep 60; done ) &

mount -t cgroup2 none /sys/fs/cgroup || die "cannot mount cgroup2"
for c in $(cat /sys/fs/cgroup/cgroup.controllers); do echo "+$c" >/sys/fs/cgroup/cgroup.subtree_control; done
# overlayfs refuses the root overlay as an upper dir; tmpfs works.
mount -t tmpfs tmpfs /var/lib/containerd

# Forwarding drops the default route learned from router advertisements, so
# keep accepting them and pin the route as it was.
DEFROUTE=$(ip -6 route show default | head -1 | sed 's/ proto [a-z]*//; s/ expires [0-9a-z]*//')
echo 2 >/proc/sys/net/ipv6/conf/eth0/accept_ra
echo 1 >/proc/sys/net/ipv6/conf/all/forwarding
echo 1 >/proc/sys/net/ipv6/conf/eth0/proxy_ndp
[ -z "$DEFROUTE" ] || ip -6 route replace $DEFROUTE
# Answer neighbor discovery on eth0 for the pod addresses host-local hands out
# first, so the VPC delivers their traffic here.
i=2; while [ $i -le 64 ]; do ip -6 neigh add proxy "$BASE:1:$(printf %x $i)" dev eth0; i=$((i + 1)); done

cat >/etc/cni/net.d/10-pods.conflist <<EOF
{ "cniVersion": "1.0.0", "name": "pods", "plugins": [
  { "type": "bridge", "bridge": "cni0", "isGateway": true, "ipMasq": false, "mtu": 1440,
    "ipam": { "type": "host-local",
              "ranges": [[{ "subnet": "$BASE:1:0/112", "rangeStart": "$BASE:1:2", "gateway": "$BASE:1:1" }]],
              "routes": [{ "dst": "::/0" }] } },
  { "type": "portmap", "capabilities": { "portMappings": true } } ] }
EOF

containerd config default >/etc/containerd/config.toml
GOMEMLIMIT=100MiB containerd >$L/containerd.log 2>&1 &
wait_for 30 ctr version || die "containerd did not start: $(tail -5 $L/containerd.log)"

[ -r /secrets/k8s-join/ca.crt ] && [ -r /secrets/k8s-join/token ] || die "Secret k8s-join is not mounted"
cp /secrets/k8s-join/ca.crt $P/ca.crt
TOKEN=$(tr -d '[:space:]' </secrets/k8s-join/token)

cat >$K/kubelet.yaml <<EOF
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
cgroupDriver: cgroupfs
failSwapOn: false
address: "::"
rotateCertificates: true
authentication: { x509: { clientCAFile: $P/ca.crt }, webhook: { enabled: false }, anonymous: { enabled: false } }
authorization: { mode: AlwaysAllow }
EOF
kubelet() {
  GOMEMLIMIT=150MiB command kubelet --config=$K/kubelet.yaml --node-ip="$IP" --hostname-override="$NODE" \
    --container-runtime-endpoint=unix:///run/containerd/containerd.sock "$@" >>$L/kubelet.log 2>&1 &
}

# --- worker ------------------------------------------------------------------
if [ "$ROLE" = worker ]; then
  API=${K8S_API:?set K8S_API to the control plane address}
  echo "$API" >>/run/peers
  # Wait until the control plane has created the bootstrap token: /api needs an
  # authenticated user, so it answers 401 until then. A kubelet that starts
  # earlier has its CSR refused and runs on as system:anonymous.
  log "waiting for [$API]:6443 to accept the bootstrap token"
  wait_for 1800 curl -fsk --max-time 3 -o /dev/null -H "Authorization: Bearer $TOKEN" "https://[$API]:6443/api" ||
    die "[$API]:6443 never accepted the bootstrap token"
  cat >$K/bootstrap-kubelet.conf <<EOF
apiVersion: v1
kind: Config
clusters: [{ name: k8s, cluster: { server: "https://[$API]:6443", certificate-authority: $P/ca.crt } }]
users: [{ name: bootstrap, user: { token: "$TOKEN" } }]
contexts: [{ name: k8s, context: { cluster: k8s, user: bootstrap } }]
current-context: k8s
EOF
  # TLS bootstrapping: the token gets a CSR approved, the kubelet keeps the cert.
  start_kubelet() { kubelet --bootstrap-kubeconfig=$K/bootstrap-kubelet.conf --kubeconfig=$K/kubelet.conf; log "kubelet started"; }
  start_kubelet
  # Report the first kubelet failures; the node's state shows on the control plane.
  tail -F $L/kubelet.log 2>/dev/null | grep --line-buffered -E '^E[0-9]{4}' 2>/dev/null | head -20 | sed 's/^/k8s-node: kubelet: /' &

  # A restarted control plane is an empty cluster (its SQLite file lives on its
  # instance). The kubelet keeps its certificate but doesn't register again,
  # so restart it when its Node has been missing for two minutes, or when it
  # still has no certificate after two minutes.
  missing=0
  while true; do
    sleep 15
    if ! pgrep -x kubelet >/dev/null; then log "kubelet exited; restarting it"; start_kubelet; missing=0; continue; fi
    # The kubelet writes kubelet.conf before its CSR is approved, so look for
    # the certificate itself.
    if [ -s /var/lib/kubelet/pki/kubelet-client-current.pem ]; then
      case $(command kubectl --kubeconfig=$K/kubelet.conf --request-timeout=5s get node "$NODE" 2>&1) in
        NAME*) missing=0 ;;
        *"connection refused"*|*imeout*|*"no route"*) ;;   # the control plane is restarting
        *) missing=$((missing + 1)) ;;                      # NotFound, Unauthorized, ...
      esac
    else missing=$((missing + 1)); fi
    if [ $missing -ge 8 ]; then
      log "node not registered for two minutes; restarting the kubelet"
      pkill -x kubelet; sleep 3; start_kubelet; missing=0
    fi
  done
fi

# --- control plane -------------------------------------------------------------
[ "$ROLE" = cp ] || die "unknown ROLE $ROLE"
[ -r /secrets/k8s-ca/ca.key ] || die "Secret k8s-ca is not mounted"
cp /secrets/k8s-ca/ca.crt $P/ca.crt
cp /secrets/k8s-ca/ca.key $P/ca.key
export KUBECONFIG=$K/super-admin.conf
kubectl() { command kubectl --request-timeout=10s "$@"; }

cat >$K/kubeadm.yaml <<EOF
apiVersion: kubeadm.k8s.io/v1beta4
kind: InitConfiguration
localAPIEndpoint: { advertiseAddress: "$IP", bindPort: 6443 }
nodeRegistration: { name: "$NODE" }
bootstrapTokens:
- token: "$TOKEN"
  ttl: "0s"
  usages: [authentication, signing]
  groups: ["system:bootstrappers:kubeadm:default-node-token"]
---
apiVersion: kubeadm.k8s.io/v1beta4
kind: ClusterConfiguration
kubernetesVersion: $(kubeadm version -o short)
controlPlaneEndpoint: "[$IP]:6443"
networking: { serviceSubnet: "$SERVICE_CIDR" }
EOF
# kubeadm signs every other certificate with the mounted CA.
kubeadm init phase certs all --config $K/kubeadm.yaml >$L/kubeadm.log 2>&1 &&
  kubeadm init phase kubeconfig all --config $K/kubeadm.yaml >>$L/kubeadm.log 2>&1 ||
  die "kubeadm: $(tail -3 $L/kubeadm.log)"

# kine serves the etcd v3 API (the only storage kube-apiserver speaks) from a
# SQLite file. The file lives on the instance; a new instance starts an empty
# cluster.
mkdir -p /var/lib/kine
GOMEMLIMIT=200MiB kine --endpoint "sqlite:///var/lib/kine/state.db?_journal=WAL&cache=shared" \
  --listen-address 127.0.0.1:2379 >$L/kine.log 2>&1 &
# kine_up: anything answering on 2379 counts; curl exits 7 when refused, 28 on timeout.
kine_up() { curl -s -o /dev/null -m 2 --http2-prior-knowledge http://127.0.0.1:2379/; r=$?; [ $r -ne 7 ] && [ $r -ne 28 ]; }
wait_for 60 kine_up || die "kine: $(tail -3 $L/kine.log)"

GOMEMLIMIT=600MiB kube-apiserver --etcd-servers=http://127.0.0.1:2379 --advertise-address="$IP" \
  --bind-address=:: --secure-port=6443 --service-cluster-ip-range=$SERVICE_CIDR \
  --authorization-mode=Node,RBAC --enable-admission-plugins=NodeRestriction --enable-bootstrap-token-auth \
  --client-ca-file=$P/ca.crt --tls-cert-file=$P/apiserver.crt --tls-private-key-file=$P/apiserver.key \
  --kubelet-client-certificate=$P/apiserver-kubelet-client.crt --kubelet-client-key=$P/apiserver-kubelet-client.key \
  --service-account-issuer=https://kubernetes.default.svc --service-account-key-file=$P/sa.pub \
  --service-account-signing-key-file=$P/sa.key >$L/apiserver.log 2>&1 &
wait_for 180 kubectl get --raw /readyz || die "kube-apiserver: $(tail -5 $L/apiserver.log)"
log "kube-apiserver ready on [$IP]:6443"

GOMEMLIMIT=200MiB kube-controller-manager --kubeconfig=$K/controller-manager.conf --bind-address=:: \
  --cluster-signing-cert-file=$P/ca.crt --cluster-signing-key-file=$P/ca.key --root-ca-file=$P/ca.crt \
  --service-account-private-key-file=$P/sa.key --use-service-account-credentials \
  --service-cluster-ip-range=$SERVICE_CIDR >$L/controller-manager.log 2>&1 &
GOMEMLIMIT=100MiB kube-scheduler --kubeconfig=$K/scheduler.conf --bind-address=:: >$L/scheduler.log 2>&1 &

# The bootstrap token Secret and the RBAC that lets its holders join as nodes
# and get their certificates approved.
wait_for 60 kubeadm init phase bootstrap-token --config $K/kubeadm.yaml --kubeconfig $K/super-admin.conf ||
  die "bootstrap token: $(kubeadm init phase bootstrap-token --config $K/kubeadm.yaml --kubeconfig $K/super-admin.conf 2>&1 | tail -3)"

kubelet --kubeconfig=$K/kubelet.conf --register-with-taints=node-role.kubernetes.io/control-plane:NoSchedule
wait_for 120 kubectl get node "$NODE" || die "the control plane's kubelet did not register: $(tail -5 $L/kubelet.log)"
kubectl label node "$NODE" node-role.kubernetes.io/control-plane= --overwrite >/dev/null
# Pods can't reach the API through its Service address (no kube-proxy), so
# the add-ons read the real one from here.
kubectl create configmap k8s-api --from-literal=address="$IP" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
log "control plane up"

# Apply the add-ons, label new workers, and print the cluster when it changes.
last=
while true; do
  [ -d /etc/k8s/addons ] && kubectl apply -f /etc/k8s/addons 2>&1 | grep -v -E ' (unchanged|configured)$' | sed 's/^/k8s-node: apply: /'
  for n in $(kubectl get nodes -l '!node-role.kubernetes.io/control-plane' -o name 2>/dev/null); do
    kubectl label "$n" node-role.kubernetes.io/worker= --overwrite >/dev/null 2>&1
  done  # No AGE column, so the output only changes when the cluster does.
  now=$(kubectl get nodes -o custom-columns='NODE:.metadata.name,READY:.status.conditions[?(@.type=="Ready")].status,ADDRESS:.status.addresses[0].address,VERSION:.status.nodeInfo.kubeletVersion' 2>&1
        kubectl get pods -A -o custom-columns='NAMESPACE:.metadata.namespace,POD:.metadata.name,PHASE:.status.phase,ADDRESS:.status.podIP,NODE:.spec.nodeName' 2>&1)
  if [ "$now" != "$last" ]; then echo "$now" | sed 's/^/k8s-node: | /'; last=$now; fi
  sleep 30
done
