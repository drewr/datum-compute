#!/usr/bin/env bash
# Shared helpers; sourced by bin/*. Everything is derived from the logged-in `aws` and `datumctl`
# sessions; override with environment variables.
set -uo pipefail
DEMO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
STATE_DIR=${STATE_DIR:-$DEMO_DIR/state}
mkdir -p "$STATE_DIR/logs"
export AWS_PAGER=

NET=${NET:-aws-test-net}                       # Datum Network (VPC) for the fleet
GW_LOCATION=${GW_LOCATION:-us-east-1}          # Datum location of the single gateway
INSTANCE_TYPE=${INSTANCE_TYPE:-t4g.micro}
TAG=datum-connect-test                         # project tag value on every AWS resource we create
FLEET_PREFIX=${FLEET_PREFIX:-drewr-}           # fleet tag value = this + the AWS user's name (see preflight)
BOUNDARY=datum-test-instance-boundary          # permissions boundary for instance roles
POOL=${POOL:-"us-east-1 us-east-2 us-west-1 us-west-2 ca-central-1 eu-central-1 eu-west-2 eu-west-3 eu-north-1 ap-northeast-1 ap-southeast-1"}
API_ENDPOINT=${API_ENDPOINT:-https://api.staging.env.datum.net}
TOKEN_URI=${TOKEN_URI:-https://auth.staging.env.datum.net/oauth/v2/token}

say()  { printf '==> %s\n' "$*" >&2; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

need() { for c in "$@"; do command -v "$c" >/dev/null || die "missing command: $c (try: nix-shell -p $c)"; done; }

preflight() {
  need aws datumctl jq
  local err
  ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>&1) || {
    err=$(tail -1 <<<"$ACCOUNT")
    die "aws is not logged in${AWS_PROFILE:+ (profile $AWS_PROFILE)}: ${err:-no output}
       set AWS_PROFILE (e.g. AWS_PROFILE=alice) or log in with aws sso login / aws configure"
  }
  local arn; arn=$(aws sts get-caller-identity --query Arn --output text)
  FLEET=${FLEET_PREFIX}${arn##*/}
  local who; who=$(datumctl whoami 2>/dev/null) || die "datumctl is not logged in"
  ORG=${ORG:-$(sed -n 's/^Organization:.*(\(org-[^)]*\)).*/\1/p' <<<"$who")}
  PROJECT=${PROJECT:-$(sed -n 's/^Project:.*(\(project-[^)]*\)).*/\1/p' <<<"$who")}
  [ -n "$ORG" ] && [ -n "$PROJECT" ] || die "datumctl has no org/project context (datumctl ctx use ORG/PROJECT, or set ORG and PROJECT)"
  PROJECT_UID=$(datumctl get projects "$PROJECT" --organization "$ORG" -o jsonpath='{.metadata.uid}' 2>/dev/null) || true
  [ -n "$PROJECT_UID" ] || die "cannot read project $PROJECT in $ORG"
  say "aws account $ACCOUNT, fleet $FLEET; datum $ORG/$PROJECT ($API_ENDPOINT)"
  export ACCOUNT ORG PROJECT PROJECT_UID FLEET
}

dc()  { datumctl --project "$PROJECT" "$@"; }       # project-scoped
dco() { datumctl --organization "$ORG" "$@"; }      # org-scoped (PolicyBindings)

regions_file=$STATE_DIR/regions.txt
regions() { cat "$regions_file" 2>/dev/null; }

# tmpl FILE KEY=VAL...  -> FILE with __KEY__ replaced
tmpl() { local f=$1 s; shift; s=$(cat "$f"); for kv in "$@"; do s=${s//__${kv%%=*}__/${kv#*=}}; done; printf '%s\n' "$s"; }

inst_name() { echo "datum-test-$1-1"; }              # AWS-side name (role/profile/SG/Name tag)
sa_name()   { echo "aws-test-$1-1"; }                # Datum-side name (SA/connector/binding)

instance_id() { # region -> id of the live instance
  aws ec2 describe-instances --region "$1" \
    --filters "Name=tag:Name,Values=$(inst_name "$1")" "Name=tag:project,Values=$TAG" \
              Name=instance-state-name,Values=pending,running,stopping,stopped \
    --query 'Reservations[].Instances[].InstanceId' --output text | awk '{print $1}'
}

# ssm_run REGION INSTANCE_ID SCRIPT [timeout-seconds]  -> prints status and output
ssm_run() {
  local r=$1 iid=$2 f=$3 max=${4:-900} cid s i
  for i in $(seq 60); do
    [ "$(aws ssm describe-instance-information --region "$r" --filters Key=InstanceIds,Values="$iid" \
      --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null)" = Online ] && break; sleep 5
  done
  cid=$(aws ssm send-command --region "$r" --instance-ids "$iid" --document-name AWS-RunShellScript \
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
