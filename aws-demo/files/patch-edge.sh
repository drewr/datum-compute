# On-instance step 2 (root): make `connect join` choose the gateway in GW_LOCATION.
# The connect client asks https://edge.datum.net/ which region is nearest (prod anycast) and
# then matches a gateway by that location. Staging only has us-central-1 and us-east-1 gateways,
# so instances whose real edge region differs would create (and be quota-denied) their own
# gateway. We byte-replace the URL in datum-connectd with a local stub that always answers
# region=$GW_LOCATION. Test-fleet hack only; the original binary is kept as datum-connectd.orig.
set -e
: "${GW_LOCATION:=us-east-1}"
cat > /usr/local/bin/edge-stub.py <<PY
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        b=b"region=$GW_LOCATION\npod=edge-stub\n"
        self.send_response(200); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self,*a): pass
HTTPServer(("127.0.0.1",8080),H).serve_forever()
PY
cat > /etc/systemd/system/edge-stub.service <<'U'
[Unit]
Description=Local edge location stub
[Service]
ExecStart=/usr/bin/python3 /usr/local/bin/edge-stub.py
Restart=always
[Install]
WantedBy=multi-user.target
U
systemctl daemon-reload; systemctl enable --now edge-stub >/dev/null 2>&1
[ -f /usr/local/bin/datum-connectd.orig ] || cp -p /usr/local/bin/datum-connectd /usr/local/bin/datum-connectd.orig
# replacement is exactly the same length as the original (23 bytes), so offsets are unchanged
perl -pe 's#https://edge\.datum\.net/#http://127.0.0.1:8080/x#g' /usr/local/bin/datum-connectd.orig > /usr/local/bin/datum-connectd.new
chmod 755 /usr/local/bin/datum-connectd.new; mv /usr/local/bin/datum-connectd.new /usr/local/bin/datum-connectd
echo "patched strings: $(grep -c -a 'http://127.0.0.1:8080/x' /usr/local/bin/datum-connectd) stub: $(curl -s http://127.0.0.1:8080/x | head -1)"
if id datum >/dev/null 2>&1 && [ -d /run/user/$(id -u datum) ]; then
  runuser -u datum -- env XDG_RUNTIME_DIR=/run/user/$(id -u datum) systemctl --user restart datum-connect-daemon 2>/dev/null || true
fi
