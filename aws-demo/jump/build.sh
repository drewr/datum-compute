#!/usr/bin/env bash
# Build the jump image and push it to ghcr.io/drewr/datum-jump; writes the digest ref to jump/IMAGE.
# The registry token comes from `gh auth token` (needs write:packages) and lives only in a
# throwaway DOCKER_CONFIG.
set -euo pipefail
cd "$(dirname "$0")"
REPO=${REPO:-ghcr.io/drewr/datum-jump}
TAG=${TAG:-$(date +%Y%m%d%H%M)}
export DOCKER_CONFIG=$(mktemp -d); trap 'rm -rf "$DOCKER_CONFIG"' EXIT
gh auth token | docker login ghcr.io -u "${GH_USER:-drewr}" --password-stdin >/dev/null
docker build -t "$REPO:$TAG" .
docker push "$REPO:$TAG" | tee "$DOCKER_CONFIG/push.log"
digest=$(sed -n 's/.*digest: \(sha256:[0-9a-f]*\).*/\1/p' "$DOCKER_CONFIG/push.log" | tail -1)
[ -n "$digest" ] || { echo "no digest in push output" >&2; exit 1; }
echo "$REPO:$TAG@$digest" >IMAGE
echo "wrote jump/IMAGE: $(cat IMAGE)"
