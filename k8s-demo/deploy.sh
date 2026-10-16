#!/usr/bin/env bash
# A 3-node Kubernetes cluster (upstream binaries, no distribution) on Datum
# Compute's unikernel class, serving one page: a live diagram of the cluster
# and each node's host details.
#
#   ./deploy.sh build    build the node image and push it (records image/IMAGE)
#   ./deploy.sh up       create or update the cluster and print its URL
#   ./deploy.sh status   workloads, the cluster's nodes and pods, the URL
#   ./deploy.sh down     delete everything up created (--keep-secrets keeps the CA)
#
# Environment:
#   DATUM_SESSION  datumctl session (default draines@datum.net@api.staging.env.datum.net)
#   PROJECT        Datum project (default project-xx4hh)
#   IMAGE_REPO     where build pushes (default ghcr.io/drewr/k8s-node-uk)
#   PULL_SECRET    the project's Secret for pulling IMAGE_REPO (default ghcr-drewr)
#
# Needs datumctl, jq, openssl and curl; build also needs a container engine
# with BuildKit and push access to IMAGE_REPO.
set -euo pipefail
cd "$(dirname "$0")"

export DATUM_SESSION=${DATUM_SESSION:-draines@datum.net@api.staging.env.datum.net}
PROJECT=${PROJECT:-project-xx4hh}
IMAGE_REPO=${IMAGE_REPO:-ghcr.io/drewr/k8s-node-uk}
PULL_SECRET=${PULL_SECRET:-ghcr-drewr}

say() { printf '==> %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
need() { for c in "$@"; do command -v "$c" >/dev/null || die "missing command: $c (try: nix-shell -p $c)"; done; }
dc() { datumctl "$@" --project "$PROJECT"; }

image() {
  [ -s image/IMAGE ] || die "no image/IMAGE; run ./deploy.sh build first"
  cat image/IMAGE
}

# render FILE: a manifest with its @PLACEHOLDERS@ filled in (all but
# @MANIFEST_SUM@, which deploy_workload adds).
render() {
  sed -e "s|@IMAGE@|$(image)|g" -e "s|@PULL_SECRET@|$PULL_SECRET|g" -e "s|@CP_IP@|${CP_IP:-}|g" "$1"
}

cmd_build() {
  need datumctl
  local tag out ref
  tag=$(date -u +%Y%m%d%H%M)
  say "building image/ and pushing $IMAGE_REPO:$tag"
  # datumctl writes the image index the unikernel class needs; refer to it by
  # digest only.
  out=$(datumctl compute build image --analyze --push --output "$IMAGE_REPO:$tag" 2>&1 | tee /dev/stderr) || die "build failed"
  ref=$(sed -n 's/^Pushed .* (\(.*@sha256:[0-9a-f]*\))$/\1/p' <<<"$out" | tail -1)
  [ -n "$ref" ] || die "could not find the pushed digest in the build output"
  echo "$ref" >image/IMAGE
  say "image/IMAGE is $ref; run ./deploy.sh up to roll it out"
}

# ensure_secrets: the cluster CA (control plane only) and the join Secret
# (CA certificate plus bootstrap token, every node). Created once; the keys
# never touch the terminal and the temporary copies are removed.
ensure_secrets() {
  if dc get secret k8s-ca >/dev/null 2>&1 && dc get secret k8s-join >/dev/null 2>&1; then
    say "Secrets k8s-ca and k8s-join exist"; return
  fi
  say "creating the cluster CA and bootstrap token (Secrets k8s-ca, k8s-join)"
  local id secret
  # Global, so the EXIT trap can still see it after a failure.
  d=$(mktemp -d); trap 'rm -rf "$d"' EXIT
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=kubernetes \
    -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign \
    -keyout "$d/ca.key" -out "$d/ca.crt" 2>/dev/null
  id=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 6 || true)
  secret=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 16 || true)
  printf '%s.%s' "$id" "$secret" >"$d/token"
  jq -n --rawfile crt "$d/ca.crt" --rawfile key "$d/ca.key" --rawfile token "$d/token" '[
    {apiVersion: "v1", kind: "Secret", type: "Opaque", metadata: {name: "k8s-ca", namespace: "default"},
     data: {"ca.crt": ($crt | @base64), "ca.key": ($key | @base64)}},
    {apiVersion: "v1", kind: "Secret", type: "Opaque", metadata: {name: "k8s-join", namespace: "default"},
     data: {"ca.crt": ($crt | @base64), "token": ($token | @base64)}}
  ] | {apiVersion: "v1", kind: "List", items: .}' | dc apply -f - >/dev/null
  rm -rf "$d"
}

# apply_addons: every file in addons/ as one key of ConfigMap k8s-addons,
# which the control plane mounts and applies.
apply_addons() {
  say "updating ConfigMap k8s-addons from addons/"
  local args=() f
  for f in addons/*.yaml; do args+=(--rawfile "$(basename "$f" .yaml)" "$f"); done
  jq -n "${args[@]}" '{apiVersion: "v1", kind: "ConfigMap", metadata: {name: "k8s-addons", namespace: "default"},
    data: ($ARGS.named | with_entries(.key += ".yaml"))}' | dc apply -f - >/dev/null
}

# deploy_workload NAME FILE [FILE...]: deploy the rendered manifest unless the
# live workload already runs it. Any deploy replaces a workload's instances, and
# a replaced control plane starts an empty cluster, so an unchanged workload is
# left alone. The extra FILEs count toward "changed".
deploy_workload() {
  local name=$1 file=$2 m sum live; shift 2
  m=$(render "$file")
  sum=$({ echo "$m"; cat "$@" </dev/null; } | sha256sum | cut -c1-16)
  live=$(dc get workloads.compute.datumapis.com "$name" -o json 2>/dev/null |
    jq -r '.metadata.annotations["k8s-demo/manifest"] // empty' || true)
  if [ "$live" = "$sum" ]; then say "$name is up to date"; return; fi
  say "deploying $name"
  sed "s|@MANIFEST_SUM@|$sum|" <<<"$m" | dc compute deploy -f /dev/stdin -y >/dev/null
}

# cp_ip: the control plane instance's address, once it has one.
cp_ip() {
  dc compute instances --workload=k8s-cp -o json 2>/dev/null |
    jq -r '.items[0].status.networkInterfaces[0].addresses[0].address // empty' | sed 's|/.*||'
}

url() { dc get httpproxy k8s-hello -o json 2>/dev/null | jq -r '.status.canonicalHostname // empty'; }

cmd_up() {
  need datumctl jq openssl curl
  say "project $PROJECT as $DATUM_SESSION; image $(image)"
  ensure_secrets
  apply_addons

  # The control plane reads the add-ons once, at boot, so they count as part of
  # its manifest.
  deploy_workload k8s-cp manifests/k8s-cp.yaml addons/*.yaml
  local i
  for i in $(seq 60); do CP_IP=$(cp_ip); [ -n "$CP_IP" ] && break; sleep 5; done
  [ -n "${CP_IP:-}" ] || die "the control plane instance has no address after 5 minutes"
  say "control plane at [$CP_IP]:6443"

  deploy_workload k8s-worker manifests/k8s-worker.yaml

  say "publishing the workers' port 80 (NetworkService and HTTPProxy k8s-hello)"
  dc apply -f manifests/k8s-http.yaml >/dev/null
  local u=
  for i in $(seq 60); do u=$(url); [ -n "$u" ] && break; sleep 5; done
  [ -n "$u" ] || die "HTTPProxy k8s-hello has no hostname after 5 minutes"

  say "waiting for https://$u to serve the cluster page (the cluster takes a few minutes to form)"
  for i in $(seq 90); do
    if body=$(curl -fsS --max-time 5 "https://$u/" 2>/dev/null) && grep -q 'content="cluster page"' <<<"$body"; then
      sed -n 's/.*<p class="sub">\(.*\)<\/p>.*/\1/p' <<<"$body"; say "up: https://$u"; return
    fi
    sleep 10
  done
  die "no cluster page from https://$u after 15 minutes; see ./deploy.sh status"
}

cmd_status() {
  need datumctl jq
  dc compute workloads 2>/dev/null | awk 'NR == 1 || $1 ~ /^k8s-(cp|worker)$/'
  echo
  # The control plane prints the nodes and pods whenever they change; show the
  # latest copy.
  dc compute logs k8s-cp --since 24h 2>/dev/null | sed -n 's/.*k8s-node: | //p' |
    awk '/^NODE /{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}'
  local u; u=$(url)
  echo
  echo "URL: ${u:+https://$u}"
}

cmd_down() {
  need datumctl
  local keep=
  [ "${1:-}" = --keep-secrets ] && keep=1
  say "deleting the URL, the workers and the control plane"
  dc delete -f manifests/k8s-http.yaml --ignore-not-found >/dev/null 2>&1 || true
  dc compute destroy k8s-worker -y >/dev/null 2>&1 || true
  dc compute destroy k8s-cp -y >/dev/null 2>&1 || true
  dc delete configmap k8s-addons --ignore-not-found >/dev/null
  if [ -z "$keep" ]; then dc delete secret k8s-ca k8s-join --ignore-not-found >/dev/null; fi
}

case ${1:-} in
  build) cmd_build ;;
  up) cmd_up ;;
  status) cmd_status ;;
  down) shift; cmd_down "$@" ;;
  *) sed -n '2,/^set -euo/{/^#/s/^# \{0,1\}//p}' "$0"; exit 2 ;;
esac
