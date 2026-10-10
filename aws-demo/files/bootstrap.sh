# On-instance step 3 (root): fetch this instance's Datum key from SSM, enrol, join the VPC, delete secrets.
# Header supplies: REGION CONNECTOR KEYPARAM NET PROJECT API_ENDPOINT TOKEN_URI
set -e
umask 077
export HOME=/root
mkdir -p /run/datum
aws ssm get-parameter --region "$REGION" --name "$KEYPARAM" --with-decryption --query Parameter.Value --output text > /run/datum/key.json
jq --arg p "$PROJECT" --arg a "$API_ENDPOINT" --arg t "$TOKEN_URI" '. + {project_id:$p, api_endpoint:$a, token_uri:$t}' /run/datum/key.json > /run/datum/connect-cred.json
id datum >/dev/null 2>&1 || useradd -m -s /bin/bash datum
U=$(id -u datum)
# Must be the exact default managed policy; a narrowed one is rejected by the daemon.
cat > /root/helper-config.json <<JSON
{"allowed_uid":$U,"approvals":[],"managed_policy":{"client_only":true,"address_ranges":["fc00::/7"],"route_ranges":["fc00::/7"],"minimum_route_prefix":16,"minimum_mtu":1280,"maximum_mtu":1500,"interface_prefix":"dc","interface_behavior":"ephemeral_exclusive","maximum_active_attachments":8,"maximum_routes_per_attachment":32,"deny_connect_route_overlap":true}}
JSON
[ -d /var/lib/datum-connect-network-$U ] || datumctl-connect daemon helper install --uid $U --config /root/helper-config.json --executable /usr/local/bin/datum-connect-network-helper 2>&1 | tail -2
loginctl enable-linger datum; sleep 3
install -o datum -g datum -m 600 /run/datum/connect-cred.json /home/datum/cred.json
cat > /tmp/ub.sh <<EOS
export HOME=/home/datum XDG_RUNTIME_DIR=/run/user/$U
T="--token-file /home/datum/.local/state/datumctl/connect/daemon/daemon_auth/setup.token"
P="--project $PROJECT"
datumctl plugin trust connect >/dev/null 2>&1
datumctl connect daemon install --credentials-file /home/datum/cred.json 2>&1 | head -1
datumctl connect daemon start 2>&1 | tail -1
# The gateway workload can still be scaling when setup starts; up/join time out until it is ready, so retry.
ok=
for i in \$(seq 1 30); do
  datumctl connect up \$P --name $CONNECTOR --credentials-file /home/datum/cred.json \$T 2>&1 | tail -2
  datumctl connect join $NET \$P \$T 2>&1 | tail -2
  if datumctl connect status \$P \$T 2>&1 | grep -q "Network $NET: connected"; then ok=1; break; fi
  echo "not joined yet (attempt \$i), retrying in 20s"; sleep 20
done
datumctl connect status \$P \$T 2>&1 | head -8
[ -n "\$ok" ]
EOS
chmod 644 /tmp/ub.sh
rc=0; runuser -u datum -- bash /tmp/ub.sh || rc=$?
rm -f /home/datum/cred.json /run/datum/key.json /run/datum/connect-cred.json /root/helper-config.json /tmp/ub.sh
exit $rc
