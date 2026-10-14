#!/usr/bin/env bash
# Alias a fleet's nodes on the VPC gateway so instances in the VPC can reach them (see bin/gwmap).
# Needs datumctl (with the compute plugin), jq and bash. Runs from bin/gwmap on the operator's machine and
# from the jump host, where `--watch` keeps the aliases in place across gateway restarts.
# Environment: PROJECT FLEET NET GW_LOCATION (GW to name the gateway; else the one serving NET at GW_LOCATION)
# and optionally MEMBERS_FILE (rewritten with "connector alias" lines whenever the aliases are applied).
#   gwmap.sh             apply; print "connector alias" lines on stdout
#   gwmap.sh --clear     remove the aliases and the table
#   gwmap.sh --check     exit 0 if the gateway has every alias
#   gwmap.sh --watch [SECS]   check every SECS (default 30), re-apply when a check fails
set -u
: "${PROJECT:?}" "${FLEET:?}" "${NET:?}" "${GW_LOCATION:?}"
log() { echo "gwmap: $*" >&2; }
dc() { datumctl --project "$PROJECT" "$@"; }

mode=apply watch=30
case ${1:-} in
  "") ;; --clear) mode=clear ;; --check) mode=check ;;
  --watch) mode=watch watch=${2:-30} ;;
  *) echo "usage: gwmap.sh [--clear | --check | --watch [SECS]]" >&2; exit 2 ;;
esac
if [ "$mode" = watch ]; then
  log "watching every ${watch}s"
  while :; do
    "$0" --check >/dev/null 2>&1 || { log "$(date +%T) aliases missing or stale; re-applying"; "$0" >/dev/null || log "re-apply failed"; }
    sleep "$watch"
  done
fi

GW=${GW:-$(dc get connectgateways -o json 2>/dev/null | jq -r --arg n "$NET" --arg l "$GW_LOCATION" --arg want "connect-$NET-$GW_LOCATION" \
  '[.items[] | select(.spec.networkRef==$n and .spec.locationRef==$l) | .metadata.name] | (map(select(.==$want)) + .)[0] // empty')}
GW=${GW:-connect-$NET-$GW_LOCATION}
wl=$(dc get connectgateway "$GW" -o json 2>/dev/null | jq -r '.status.workloadRef // empty')
[ -n "$wl" ] || { log "gateway $GW has no workload yet; nothing to map"; exit 0; }
read -r inst gaddr < <(dc get instances -o json | jq -r --arg w "$wl" \
  '[.items[] | select(.metadata.labels["compute.datumapis.com/workload-name"]==$w)] | sort_by(.metadata.name)[0] // empty
   | "\(.metadata.name) \(first(.status.networkInterfaces[]?.assignments?.networkIP? // empty) // "" | sub("/.*";""))"')
[ -n "${inst:-}" ] && [ -n "${gaddr:-}" ] || { log "gateway instance for $GW has no address yet"; exit 1; }
pre=${gaddr%:*}   # fd20:0:32::1:0

members=
[ "$mode" = clear ] || members=$(dc get connectnetworkbindings -o json | jq -r --arg gw "$GW" --arg f "$FLEET-" \
  '.items[] | select(.spec.gatewayRef==$gw and (.spec.connectorRef|startswith($f))) | select(.status.assignedAddress)
   | "\(.spec.connectorRef) \(.status.assignedAddress|sub("/128";""))"' | sort)

if [ "$mode" = check ]; then
  want=$(grep -c . <<<"$members")
  have=$(datumctl compute exec "$inst" --project "$PROJECT" -- nft list table ip6 jumpmap 2>/dev/null | grep -c ' dnat to ')
  [ "$have" = "$want" ] && [ "$want" -gt 0 ]; exit
fi

script=$(mktemp)
{
  echo "pre=$pre"
  echo 'ip -6 -o addr show dev eth0 scope global | awk "{print \$4}" | grep -E "^$pre:[0-9a-f]+/128\$" | while read -r a; do ip -6 addr del "$a" dev eth0; done'
  echo 'nft delete table ip6 jumpmap 2>/dev/null'
  if [ -n "$members" ]; then
    echo 'nft -f - <<NFT'
    echo 'table ip6 jumpmap {'
    echo '  chain pre { type nat hook prerouting priority dstnat; policy accept;'
    i=0; while read -r c a; do i=$((i+1)); printf '    ip6 daddr %s:%x dnat to %s\n' "$pre" $((256+i)) "$a"; done <<<"$members"
    echo '  }'; echo '}'; echo NFT
    i=0; while read -r c a; do i=$((i+1)); printf 'ip -6 addr add %s:%x/128 dev eth0 nodad\n' "$pre" $((256+i)); done <<<"$members"
  fi
} >"$script"
ok=
for _ in $(seq 6); do
  datumctl compute exec "$inst" -i --project "$PROJECT" -- sh <"$script" >/dev/null 2>&1 && { ok=1; break; }; sleep 5
done
rm -f "$script"
[ -n "$ok" ] || { log "could not configure gateway $inst"; exit 1; }
if [ "$mode" = clear ]; then log "cleared the aliases on $inst"; exit 0; fi
i=0; out=; while read -r c a; do i=$((i+1)); out+=$(printf '%s %s:%x' "$c" "$pre" $((256+i)))$'\n'; done <<<"$members"
[ -z "${MEMBERS_FILE:-}" ] || printf '%s' "$out" >"$MEMBERS_FILE"
log "gateway $inst: $(grep -c . <<<"$members") member aliases"
printf '%s' "$out"
