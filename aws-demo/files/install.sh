# On-instance step 1 (root): OS packages, AWS CLI v2, Datum binaries (sha256-verified).
# Expects the header from bin/setup (VERSIONS below can be overridden there).
export HOME=/root DEBIAN_FRONTEND=noninteractive
: "${DATUMCTL_VERSION:=v0.21.0}" "${CONNECT_VERSION:=v1.0.0-preview.28}" "${COMPUTE_VERSION:=v0.12.1}"
apt-get update -qq && apt-get install -y -qq curl jq unzip ca-certificates iputils-ping postgresql-client python3 >/dev/null
d=$(mktemp -d); cd "$d"
command -v aws >/dev/null || {
  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip -o awscli.zip && unzip -q awscli.zip && ./aws/install >/dev/null
}
B=/usr/local/bin
fetch() { # repo tag archive checksums-file
  curl -fsSL --retry 3 -O "https://github.com/$1/releases/download/$2/$3"
  curl -fsSL --retry 3 -o "$4.$3" "https://github.com/$1/releases/download/$2/$4"
  awk -v a="$3" '$2==a' "$4.$3" | sha256sum -c -
}
v=${DATUMCTL_VERSION#v}
fetch datum-cloud/datumctl "$DATUMCTL_VERSION" datumctl_Linux_arm64.tar.gz "datumctl_${v}_checksums.txt"
tar -xzf datumctl_Linux_arm64.tar.gz datumctl && install -m755 datumctl $B/datumctl
fetch datum-cloud/connect "$CONNECT_VERSION" datumctl-connect_Linux_arm64.tar.gz checksums.txt
tar -xzf datumctl-connect_Linux_arm64.tar.gz datumctl-connect datum-connectd datum-connect-network-helper
install -m755 datumctl-connect datum-connectd datum-connect-network-helper $B/
fetch datum-cloud/compute "$COMPUTE_VERSION" datumctl-compute_Linux_arm64.tar.gz checksums.txt
tar -xzf datumctl-compute_Linux_arm64.tar.gz datumctl-compute && install -m755 datumctl-compute $B/
cd /; rm -rf "$d"
datumctl version; datumctl-connect version || true
