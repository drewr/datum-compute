#!/usr/bin/env python3
"""Speaks the Global Mesh peer protocol so an EC2 member shows up in the page.

GET /mesh/ping   tiny reply the page's pinger times
GET /mesh/local  this member's own measurements to every other member, as the page expects
Members come from /etc/mesh-members ("name address [port]" per line; port defaults to ours).
/etc/mesh-push ("url token") says where to POST our report; the viewer is not routable from here. and who we are from /etc/mesh-self
("name location"). Both are rewritten by bin/setup; the files are re-read every few seconds.
"""
import http.client, json, socket, threading, time
from datetime import datetime, timezone
from urllib.parse import urlsplit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT, INTERVAL, TIMEOUT = 8081, 2.0, 1.5  # 8080 is taken by the edge stub
started = time.time()
lock = threading.Lock()
peers = {}      # name -> state
exchanges = []  # newest last


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat().replace("+00:00", "Z")


def read_self():
    try:
        n, loc = open("/etc/mesh-self").read().split()[:2]
        return n, loc
    except Exception:
        return "", ""


def read_members(me):
    out = {}
    try:
        for line in open("/etc/mesh-members"):
            f = line.split()
            if len(f) in (2, 3) and f[0] != me:
                out[f[0]] = (f[1], int(f[2]) if len(f) == 3 else PORT)
    except OSError:
        pass
    return out


def ping(addr, port):
    conn = http.client.HTTPConnection(addr, port, timeout=TIMEOUT)
    try:
        conn.connect()  # time the request alone: one round trip, not handshake plus request
        t0 = time.monotonic()
        conn.request("GET", "/mesh/ping")
        r = conn.getresponse()
        r.read()
        return time.monotonic() - t0, r.status == 200
    except Exception:
        return 0.0, False
    finally:
        conn.close()


def one(name, member):
    addr, port = member
    rtt, ok = ping(addr, port)
    now = time.time()
    with lock:
        st = peers.setdefault(name, dict(addr=addr, rtts=[], outcomes=[], attempts=0, messages=0, last=None))
        if st["addr"] != addr:
            st.update(addr=addr, rtts=[], outcomes=[], attempts=0, messages=0, last=None)
        st["attempts"] += 1
        st["outcomes"] = (st["outcomes"] + [ok])[-20:]
        if ok:
            st["messages"] += 2
            st["last"] = now
            st["rtts"] = (st["rtts"] + [rtt])[-15:]
        exchanges.append(dict(at=iso(now), to=name, rttMs=round(rtt * 1000, 3), ok=ok))
        del exchanges[:-50]


def loop():
    while True:
        me, _ = read_self()
        members = read_members(me)
        with lock:
            for gone in set(peers) - set(members):
                del peers[gone]
        ts = [threading.Thread(target=one, args=(n, m)) for n, m in members.items()]
        [t.start() for t in ts]
        [t.join() for t in ts]
        push()
        time.sleep(INTERVAL)


def push():
    """Send our report to the viewer: it cannot reach us, but we can reach it."""
    try:
        url, token = open("/etc/mesh-push").read().split()[:2]
    except Exception:
        return
    u = urlsplit(url)
    conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=TIMEOUT)
    try:
        conn.request("POST", u.path, json.dumps(report()),
                     {"Content-Type": "application/json", "Authorization": "Bearer " + token})
        conn.getresponse().read()
    except Exception:
        pass
    finally:
        conn.close()


def median(v):
    s = sorted(v)
    if not s:
        return 0.0
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def report():
    me, loc = read_self()
    with lock:
        ps = [dict(name=n, address=st["addr"], rttMs=round(median(st["rtts"]) * 1000, 3),
                   successRate=(sum(st["outcomes"]) / len(st["outcomes"])) if st["outcomes"] else 0,
                   attempts=st["attempts"], messages=st["messages"], bytes=st["messages"] * 120,
                   **({"lastSuccess": iso(st["last"])} if st["last"] else {}))
              for n, st in sorted(peers.items())]
        ex = list(reversed(exchanges))[:24]
    return dict(name=me, location=loc, startedAt=iso(started), peers=ps, exchanges=ex)


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    disable_nagle_algorithm = True  # headers and body go as separate writes; Nagle would add a round trip

    def log_message(self, *a):
        pass

    def send_json(self, obj):
        b = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/mesh/ping":
            me, loc = read_self()
            self.send_json(dict(name=me, location=loc, uptimeSeconds=int(time.time() - started),
                                time=iso(time.time())))
        elif self.path == "/mesh/local":
            self.send_json(report())
        elif self.path == "/healthz":
            self.send_json("ok")
        else:
            self.send_error(404)


class Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6
    daemon_threads = True


if __name__ == "__main__":
    threading.Thread(target=loop, daemon=True).start()
    Server(("::", PORT), H).serve_forever()
