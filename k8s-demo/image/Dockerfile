# Upstream Kubernetes binaries (no distribution) and the node entrypoint, for
# the unikernel runtime class. Wrap and push with:
#
#   datumctl compute build k8s-demo/image --analyze --push --output ghcr.io/<you>/k8s-node-uk:<tag>
#
# The base is glibc (Debian): the upstream kubelet is dynamically linked.
FROM docker.io/library/debian:trixie-slim AS fetch
ARG K8S=v1.37.1
ARG ETCD=v3.7.2
ARG CONTAINERD=2.4.2
ARG RUNC=v1.5.2
ARG CNI=v1.9.1
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /out
RUN for b in kubeadm kube-apiserver kube-controller-manager kube-scheduler kubelet kubectl; do \
      curl -fsSLo $b https://dl.k8s.io/release/$K8S/bin/linux/amd64/$b && chmod 755 $b; done
RUN curl -fsSL https://github.com/etcd-io/etcd/releases/download/$ETCD/etcd-$ETCD-linux-amd64.tar.gz \
      | tar xz --strip-components=1 etcd-$ETCD-linux-amd64/etcd etcd-$ETCD-linux-amd64/etcdctl
RUN curl -fsSL https://github.com/containerd/containerd/releases/download/v$CONTAINERD/containerd-static-$CONTAINERD-linux-amd64.tar.gz \
      | tar xz --strip-components=1 bin/containerd bin/containerd-shim-runc-v2 bin/ctr
RUN curl -fsSLo runc https://github.com/opencontainers/runc/releases/download/$RUNC/runc.amd64 && chmod 755 runc
RUN mkdir -p /cni && curl -fsSL https://github.com/containernetworking/plugins/releases/download/$CNI/cni-plugins-linux-amd64-$CNI.tgz \
      | tar xz -C /cni ./bridge ./host-local ./loopback ./portmap

FROM docker.io/library/debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      iproute2 iptables util-linux mount procps ca-certificates curl busybox conntrack ethtool socat \
    && rm -rf /var/lib/apt/lists/* \
    && update-alternatives --set iptables /usr/sbin/iptables-legacy \
    && update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy
COPY --from=fetch /cni/ /opt/cni/bin/
COPY --from=fetch /out/ /usr/local/bin/
# probe.sh reports what the instance supports; run it with command: [/probe.sh].
COPY --chmod=755 node.sh probe.sh /
EXPOSE 80 6443
ENTRYPOINT ["/node.sh"]
