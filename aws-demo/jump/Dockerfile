# A small shell inside the VPC: ping, traceroute, mtr, dig, curl, nc and an ssh client, plus bash for
# netcheck (bin/jump installs it in /root). iputils (not BusyBox) because BusyBox ping needs a raw
# socket and exec sessions start without capabilities. datumctl and its compute plugin (sha256-verified)
# let the gateway alias watcher run here; bin/jump gives it a service account.
FROM alpine:3.20
ARG DATUMCTL_VERSION=v0.21.0
ARG COMPUTE_VERSION=v0.12.1
RUN apk add --no-cache bash iputils traceroute mtr bind-tools curl openssh-client netcat-openbsd iproute2 jq
RUN set -eu; cd /tmp; v=${DATUMCTL_VERSION#v}; \
    fetch() { curl -fsSL --retry 3 -O "https://github.com/$1/releases/download/$2/$3"; \
              curl -fsSL --retry 3 -o "sums.$3" "https://github.com/$1/releases/download/$2/$4"; \
              awk -v a="$3" '$2==a' "sums.$3" | sha256sum -c -; }; \
    fetch datum-cloud/datumctl "$DATUMCTL_VERSION" datumctl_Linux_x86_64.tar.gz "datumctl_${v}_checksums.txt"; \
    tar -xzf datumctl_Linux_x86_64.tar.gz datumctl; install -m755 datumctl /usr/local/bin/datumctl; \
    fetch datum-cloud/compute "$COMPUTE_VERSION" datumctl-compute_Linux_x86_64.tar.gz checksums.txt; \
    tar -xzf datumctl-compute_Linux_x86_64.tar.gz datumctl-compute; install -m755 datumctl-compute /usr/local/bin/datumctl-compute; \
    rm -f /tmp/*
WORKDIR /root
ENV PATH=/root:$PATH
CMD ["tail", "-f", "/dev/null"]
