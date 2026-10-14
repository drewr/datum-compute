#!/usr/bin/env bash
# Shared helpers; sourced by bin/*. Everything is derived from the logged-in `aws` and `datumctl`
# sessions; override with environment variables.
set -uo pipefail
DEMO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
export AWS_PAGER=

GW_LOCATION=${GW_LOCATION:-us-east-1}          # Datum location of the single gateway
INSTANCE_TYPE=${INSTANCE_TYPE:-t4g.micro}
TAG=datum-connect-test                         # project tag value on every AWS resource we create
FLEET_PREFIX_SET=${FLEET_PREFIX:+1}
FLEET_PREFIX=${FLEET_PREFIX:-drewr-}           # FLEET = this + the AWS user's name (see set_fleet); names everything
BOUNDARY=${FLEET_PREFIX}boundary                # permissions boundary for instance roles (one per account)
POOL=${POOL:-"us-east-1 us-east-2 us-west-1 us-west-2 ca-central-1 sa-east-1 eu-west-1 eu-west-2 eu-west-3 eu-central-1 eu-north-1 ap-south-1 ap-northeast-1 ap-northeast-2 ap-northeast-3 ap-southeast-1 ap-southeast-2"}
API_ENDPOINT=${API_ENDPOINT:-https://api.staging.env.datum.net}
TOKEN_URI=${TOKEN_URI:-https://auth.staging.env.datum.net/oauth/v2/token}

say()  { printf '==> %s\n' "$*" >&2; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

need() { for c in "$@"; do command -v "$c" >/dev/null || die "missing command: $c (try: nix-shell -p $c)"; done; }

# FLEET = FLEET_PREFIX + the AWS caller's user name, lowercased. It names every resource (AWS and
# Datum), the Datum network and the state directory, so fleets of different operators, or of one
# operator under different users, can run side by side. Set FLEET to override.
set_fleet() {
  local arn; arn=$(aws sts get-caller-identity --query Arn --output text) || die "aws is not logged in${AWS_PROFILE:+ (profile $AWS_PROFILE)}"
  # A FLEET that contains the user's name carries its own prefix (hello-demo261014-01 => hello-), so
  # FLEET alone is enough unless FLEET_PREFIX is set explicitly.
  local user; user=$(printf '%s' "${arn##*/}" | tr 'A-Z_' 'a-z-' | tr -c 'a-z0-9-' '-')
  if [ -n "${FLEET:-}" ] && [ -z "$FLEET_PREFIX_SET" ]; then
    case $arn:$FLEET in
      *:user/*:*"$user"|*:user/*:*"$user"-*)
        case ${FLEET%%"$user"*} in *-) FLEET_PREFIX=${FLEET%%"$user"*}; BOUNDARY=${FLEET_PREFIX}boundary ;; esac ;;
    esac
  fi
  local base; base=$(printf '%s' "${FLEET_PREFIX}${arn##*/}" | tr 'A-Z_' 'a-z-' | tr -c 'a-z0-9-' '-')
  [ -n "${FLEET:-}" ] || FLEET=$base
  # The operator policy grants SSM parameters only under /<FLEET_PREFIX><user>/, so keys of an extended
  # FLEET (drewr-demo261009-b) live under that root rather than under /<fleet>/.
  case $arn in *:user/*) KEY_ROOT=$base ;; *) KEY_ROOT=$FLEET ;; esac
  [ "${#FLEET}" -le 40 ] || die "fleet name $FLEET is longer than 40 characters; set a shorter FLEET_PREFIX or FLEET"
  STATE_DIR=${STATE_DIR:-$DEMO_DIR/state/$FLEET}
  mkdir -p "$STATE_DIR/logs"
  NET=${NET:-$FLEET-net}                          # Datum Network (VPC) for the fleet
  nodes_file=$STATE_DIR/nodes.txt
  export FLEET NET STATE_DIR KEY_ROOT
}

preflight() {
  need aws datumctl jq
  local err
  ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>&1) || {
    err=$(tail -1 <<<"$ACCOUNT")
    die "aws is not logged in${AWS_PROFILE:+ (profile $AWS_PROFILE)}: ${err:-no output}
       set AWS_PROFILE (e.g. AWS_PROFILE=alice) or log in with aws sso login / aws configure"
  }
  set_fleet
  local who; who=$(datumctl whoami 2>/dev/null) || die "datumctl is not logged in"
  ORG=${ORG:-$(sed -n 's/^Context:[[:space:]]*\(org-[^/[:space:]]*\)\/.*/\1/p' <<<"$who")}
  PROJECT=${PROJECT:-$(sed -n 's/^Context:[[:space:]]*org-[^/]*\/\(project-[^[:space:]]*\).*/\1/p' <<<"$who")}
  [ -n "$ORG" ] && [ -n "$PROJECT" ] || die "datumctl has no org/project context (datumctl ctx use ORG/PROJECT, or set ORG and PROJECT)"
  PROJECT_UID=$(datumctl get projects "$PROJECT" --organization "$ORG" -o jsonpath='{.metadata.uid}' 2>/dev/null) || true
  [ -n "$PROJECT_UID" ] || die "cannot read project $PROJECT in $ORG"
  say "aws account $ACCOUNT, fleet $FLEET; datum $ORG/$PROJECT ($API_ENDPOINT)"
  export ACCOUNT ORG PROJECT PROJECT_UID FLEET FLEET_PREFIX
}

# check_fleet_name: the operator policy grants only AWS names that start with <FLEET_PREFIX><user>-, so
# a FLEET override must be that name or extend it (drewr-demo261009-b). Checked by setup only, so
# teardown can still clean up a fleet that was named wrongly.
check_fleet_name() {
  local arn base; arn=$(aws sts get-caller-identity --query Arn --output text) || return 0
  case $arn in *:user/*) ;; *) return 0 ;; esac
  base=$(printf '%s' "${FLEET_PREFIX}${arn##*/}" | tr 'A-Z_' 'a-z-' | tr -c 'a-z0-9-' '-')
  case $FLEET in
    "$base"|"$base"-*) ;;
    *) die "FLEET $FLEET is not allowed for $arn: names must start $base- (FLEET_PREFIX is ${FLEET_PREFIX}, from the environment or default)
       name the fleet <prefix>${arn##*/}[-suffix] where <prefix> is the FLEET_PREFIX you gave bin/bootstrap-iam, or unset FLEET" ;;
  esac
}

dc()  { datumctl --project "$PROJECT" "$@"; }       # project-scoped
dco() { datumctl --organization "$ORG" "$@"; }      # org-scoped (PolicyBindings)

# A node is one EC2 instance, named <region>-<n> (n counts per region from 0): us-east-1-0, eu-west-2-3.
# state/<fleet>/nodes.txt lists them, one per line.
nodes()       { cat "$nodes_file" 2>/dev/null; }
node_region() { echo "${1%-*}"; }
node_index()  { echo "${1##*-}"; }
regions()     { nodes | sed 's/-[0-9]*$//' | awk '!s[$0]++'; }

# bad-names: node names whose Datum ServiceAccount got stuck; never reused, even after teardown
bad_names() { cat "$STATE_DIR/bad-names" 2>/dev/null; }
mark_bad()  { grep -qxF -- "$1" "$STATE_DIR/bad-names" 2>/dev/null || echo "$1" >>"$STATE_DIR/bad-names"; }
# next_index REGION -> the lowest index above every node and bad name already used in REGION
next_index() {
  { nodes; bad_names; } | awk -v r="$1" '{ s=$0; sub(/-[0-9]+$/,"",s); if (s==r) { i=$0; sub(/.*-/,"",i); if (i+0>=n) n=i+1 } } END{print n+0}'
}

# resolve_node X -> a node: X itself, or the first node in region X
resolve_node() {
  local x=$1
  if nodes | grep -qxF -- "$x"; then echo "$x"; return 0; fi
  nodes | awk -v r="$x" '{ s=$0; sub(/-[0-9]+$/,"",s) } s==r{print; exit}' | grep . && return 0
  die "no node or region '$x' in this fleet (nodes: $(nodes | tr '\n' ' '))"
}

# expand_regions LIST -> one AWS region per line. Each entry (space or comma separated) is a region
# name or a continent alias (na, sa, eu, ap, me, af) meaning every POOL region there.
expand_regions() {
  local t pat got out=
  for t in $(tr ',[:upper:]' ' [:lower:]' <<<"$1"); do
    pat=
    case $t in
      na|north-america|americas) pat='us-|ca-' ;;
      sa|south-america) pat='sa-' ;;
      eu|europe) pat='eu-' ;;
      ap|asia|apac|asia-pacific) pat='ap-' ;;
      me|middle-east) pat='me-|il-' ;;
      af|africa) pat='af-' ;;
      *-*-[0-9]*) out=$(printf '%s\n%s\n' "$out" "$t") ;;
      *) warn "REGIONS: '$t' is neither a region name (like us-east-1) nor a continent (na, sa, eu, ap, me, af)"; return 1 ;;
    esac
    if [ -n "$pat" ]; then
      got=$(tr ' ' '\n' <<<"$POOL" | grep -E "^($pat)" || true)
      [ -n "$got" ] || { warn "REGIONS: no pool region on '$t' (POOL: $POOL)"; return 1; }
      out=$(printf '%s\n%s\n' "$out" "$got")
    fi
  done
  sed '/^$/d' <<<"$out" | awk '!s[$0]++'
}

# denied_regions REGION...: print those the caller's policy explicitly denies (probed in parallel).
# Anything else, including a transient error, counts as allowed.
denied_regions() {
  local r d out; d=$(mktemp -d)
  for r; do
    ( out=$(aws ec2 describe-instances --region "$r" --max-results 5 --query 'length(Reservations)' --output text 2>&1) ||
        case $out in *UnauthorizedOperation*|*AccessDenied*|*"explicit deny"*) touch "$d/$r" ;; esac ) &
  done
  wait
  ls "$d"; rm -rf "$d"
}

# gateway_for_net -> name of the gateway already serving $NET at $GW_LOCATION (the conventional
# name first, else any, such as a join's hash-suffixed one); empty if none
gateway_for_net() {
  dc get connectgateways -o json 2>/dev/null | jq -r --arg n "$NET" --arg l "$GW_LOCATION" --arg want "connect-$NET-$GW_LOCATION" \
    '[.items[] | select(.spec.networkRef==$n and .spec.locationRef==$l) | .metadata.name] | (map(select(.==$want)) + .)[0] // empty'
}

# throttle: wait until fewer than ${JOBS:-12} background jobs are running
throttle() { while [ "$(jobs -rp | wc -l)" -ge "${JOBS:-12}" ]; do wait -n; done; }

# retry CMD...: run CMD (a command or function); if it fails with a transient-looking error
# (throttling, 5xx, timeout, reset) run it again, up to RETRY_MAX (4) tries with backoff. Permanent
# errors (AccessDenied, quota, NotFound, ...) fail at once. stdout passes through; stderr is shown
# for the final failure only. stdin is not replayed: keep a heredoc inside the function you retry, and
# pass secrets as function arguments, never on a command line.
RETRY_TRANSIENT='Throttl|RequestLimitExceeded|TooManyRequests|timed out|timeout|connection (reset|refused)|TLS handshake|EOF|temporarily unavailable|ServiceUnavailable|InternalError|InternalFailure|(^|[^0-9])(429|500|502|503|504)([^0-9]|$)'
RETRY_PERMANENT='AccessDenied|Forbidden|Unauthorized|quota|AlreadyExists|InvalidParameter|NotFound|IdempotentParameterMismatch'
retry() {
  local err try=1 max=${RETRY_MAX:-4} base=${RETRY_BASE:-2} rc
  err=$(umask 077; mktemp)
  while :; do
    "$@" 2>"$err"
    rc=$?
    [ "$rc" -ne 0 ] || break
    if [ "$try" -ge "$max" ] || grep -Eiq "$RETRY_PERMANENT" "$err" || ! grep -Eiq "$RETRY_TRANSIENT" "$err"; then
      cat "$err" >&2; break
    fi
    warn "retrying ($try/$((max - 1))): ${1##*/} ${2:-}: $(tail -1 "$err" | cut -c1-120)"
    sleep $((base * (1 << (try - 1)) + RANDOM % (base + 1)))
    try=$((try + 1))
  done
  rm -f "$err"
  return "$rc"
}

# tmpl FILE KEY=VAL...  -> FILE with __KEY__ replaced
tmpl() { local f=$1 s; shift; s=$(cat "$f"); for kv in "$@"; do s=${s//__${kv%%=*}__/${kv#*=}}; done; printf '%s\n' "$s"; }

member()    { echo "$FLEET-$1"; }                      # node -> name of that member everywhere (role, profile, SG, Name tag, ServiceAccount, connector)
key_param() { echo "/$KEY_ROOT/$FLEET/$(node_region "$1")/$(node_index "$1")/key"; }   # node -> SSM parameter holding that member's Datum key

instance_id() { # node -> id of the live instance
  retry aws ec2 describe-instances --region "$(node_region "$1")" \
    --filters "Name=tag:Name,Values=$(member "$1")" "Name=tag:project,Values=$TAG" "Name=tag:fleet,Values=${FLEET:?}" \
              Name=instance-state-name,Values=pending,running,stopping,stopped \
    --query 'Reservations[].Instances[].InstanceId' --output text | awk '{print $1}'
}

# ssm_run REGION INSTANCE_ID SCRIPT [timeout-seconds]  -> prints status and output; returns 4 if the instance never registers with SSM
ssm_run() {
  local r=$1 iid=$2 f=$3 max=${4:-900} cid s i online=
  for i in $(seq 60); do
    [ "$(aws ssm describe-instance-information --region "$r" --filters Key=InstanceIds,Values="$iid" \
      --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null)" = Online ] && { online=1; break; }; sleep 5
  done
  [ -n "$online" ] || { echo "status: instance $iid is not Online in SSM after 300 s"; return 4; }
  cid=$(retry aws ssm send-command --region "$r" --instance-ids "$iid" --document-name AWS-RunShellScript \
    --timeout-seconds "$max" --parameters "$(jq -Rs '{commands: [.], executionTimeout: ["'"$max"'"]}' <"$f")" \
    --query Command.CommandId --output text) || return 1
  for i in $(seq $((max / 3))); do
    s=$(aws ssm get-command-invocation --region "$r" --command-id "$cid" --instance-id "$iid" --query Status --output text 2>/dev/null || echo Pending)
    case $s in Success|Failed|Cancelled|TimedOut) break;; esac; sleep 3
  done
  echo "status: $s"
  aws ssm get-command-invocation --region "$r" --command-id "$cid" --instance-id "$iid" \
    --query '[StandardOutputContent,StandardErrorContent]' --output text
  [ "$s" = Success ]
}

# aws_down NODE: remove the node's instance, security group, role, profile and SSM key
aws_down() {
  local nd=$1 r n; r=$(node_region "$nd"); n=$(member "$nd")
  local ids; ids=$(aws ec2 describe-instances --region "$r" --filters "Name=tag:Name,Values=$n" "Name=tag:project,Values=$TAG" "Name=tag:fleet,Values=$FLEET" \
    Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[].Instances[].InstanceId' --output text)
  if [ -n "$ids" ]; then
    # shellcheck disable=SC2086
    aws ec2 terminate-instances --region "$r" --instance-ids $ids >/dev/null
    # shellcheck disable=SC2086
    aws ec2 wait instance-terminated --region "$r" --instance-ids $ids
  fi
  local sg; sg=$(aws ec2 describe-security-groups --region "$r" --filters Name=group-name,Values="$n" "Name=tag:project,Values=$TAG" "Name=tag:fleet,Values=$FLEET" --query 'SecurityGroups[0].GroupId' --output text)
  [ "$sg" != None ] && for _ in 1 2 3 4 5 6; do aws ec2 delete-security-group --region "$r" --group-id "$sg" 2>/dev/null && break; sleep 10; done
  local owner; owner=$(aws iam get-role --role-name "$n" --query 'Role.Tags[?Key==`fleet`].Value | [0]' --output text 2>/dev/null)
  if [ -n "$owner" ] && [ "$owner" != "$FLEET" ]; then
    echo "$nd: role $n belongs to fleet ${owner/None/(none)}, not $FLEET; leaving the role, profile and key"
    return 0
  fi
  aws iam remove-role-from-instance-profile --instance-profile-name "$n" --role-name "$n" 2>/dev/null
  aws iam delete-instance-profile --instance-profile-name "$n" 2>/dev/null
  aws iam delete-role-policy --role-name "$n" --policy-name own-key-and-ssm 2>/dev/null
  aws iam delete-role --role-name "$n" 2>/dev/null
  aws ssm delete-parameter --region "$r" --name "$(key_param "$nd")" 2>/dev/null
  return 0
}

# datum_down NODE [BINDINGS_JSON]: delete the node's Datum objects (bindings, connector, PolicyBinding, key, ServiceAccount)
datum_down() {
  local nd=$1 n b bindings=${2:-}; n=$(member "$nd")
  [ -n "$bindings" ] || bindings=$(dc get connectnetworkbindings -o json 2>/dev/null)
  for b in $(jq -r --arg c "$n" '.items[]|select(.spec.connectorRef==$c)|.metadata.name' <<<"$bindings"); do
    dc delete connectnetworkbindings "$b" >/dev/null 2>&1
  done
  dc delete connectors "$n" >/dev/null 2>&1
  dco delete policybindings "$n-editor" -n "organization-$ORG" >/dev/null 2>&1
  dc delete serviceaccountkeys "$n-key" >/dev/null 2>&1
  dc delete serviceaccounts "$n" >/dev/null 2>&1
}

# fleet_members GATEWAY -> "connector address" lines for this fleet's nodes attached to GATEWAY
fleet_members() {
  dc get connectnetworkbindings -o json | jq -r --arg gw "$1" --argjson names "$(nodes | jq -R --arg f "$FLEET" '"\($f)-\(.)"' | jq -s .)" \
    '.items[] | select(.spec.gatewayRef==$gw) | select(.spec.connectorRef as $c | $names | index($c)) | select(.status.assignedAddress)
     | "\(.spec.connectorRef) \(.status.assignedAddress|sub("/128";""))"'
}

# Datum ServiceAccount helpers (bin/setup for the nodes, bin/jump for the jump host)
create_sa() { # name
  dc create --validate=false -f - >/dev/null <<Y
apiVersion: iam.miloapis.com/v1alpha1
kind: ServiceAccount
metadata: {name: $1}
spec: {state: Active}
Y
}
mint_key() { # name email -> prints the private key (returned only once); replaces an old key object
  dc delete serviceaccountkeys "$1-key" >/dev/null 2>&1 || true
  dc create --validate=false -o json -f - <<Y | jq -r .status.privateKey
apiVersion: identity.miloapis.com/v1alpha1
kind: ServiceAccountKey
metadata: {name: $1-key}
spec: {serviceAccountUserName: $2}
Y
}
create_binding() { # name uid; `editor` is the only assignable role that inherits connect admin on staging (broad; see README)
  dco create --validate=false -n "organization-$ORG" -f - >/dev/null <<Y
apiVersion: iam.miloapis.com/v1alpha1
kind: PolicyBinding
metadata: {name: $1-editor, namespace: organization-$ORG}
spec:
  resourceSelector: {resourceRef: {apiGroup: resourcemanager.miloapis.com, kind: Project, name: $PROJECT, uid: $PROJECT_UID}}
  roleRef: {name: editor, namespace: datum-cloud}
  subjects: [{kind: ServiceAccount, name: $1, uid: $2}]
Y
}
