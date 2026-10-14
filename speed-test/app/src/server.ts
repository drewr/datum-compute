// A speed test in the style of speed.cloudflare.com, served from a Datum
// compute instance. The browser runs Cloudflare's open-source measurement
// engine (@cloudflare/speedtest, bundled into dist/client.js) against this
// server's /__down and /__up, so the numbers describe the path from the
// browser to this instance.
import http from "node:http";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import mmdb from "mmdb-lib";
import type { AsnResponse, CityResponse } from "mmdb-lib/lib/reader/response.js";
import { PAGE } from "./page.js";

const port = Number(process.env.PORT ?? 8080);

// The Datum location this instance runs in (us-central-1, ...). Set by the
// manifest; the page shows it and pins it on the map.
const location = process.env.LOCATION ?? "";

// The engine asks for up to 100 MB per request; anything bigger is refused
// rather than streamed, so a stray URL can't tie the instance up.
const MAX_BYTES = 100e6;

// Download bodies are slices of one random buffer, so they don't compress and
// the server spends no time generating them.
const CHUNK = randomBytes(1 << 20);

const CLIENT_JS = readFileSync(new URL("./client.js", import.meta.url));

// The instance's hostname, for the page's "Served by". Unikernel instances
// have none (os.hostname() is "(none)"), so the page leaves the row out.
const hostname = os.hostname();
const instance = hostname && hostname !== "(none)" && hostname !== "localhost" ? hostname : null;

// DB-IP's IP to ASN Lite and IP to City Lite databases (CC BY 4.0), which
// default.nix installs next to dist/. The first names the client's network
// like Cloudflare's "Your network"; the second places the client on the map.
// Lookups stay on this instance. ASN_DB and CITY_DB point elsewhere for local
// runs; without a file the page leaves out what it would have shown.
function openDb<T extends AsnResponse | CityResponse>(env: string | undefined, file: string): mmdb.Reader<T> | null {
  const path = env ?? new URL(`../${file}`, import.meta.url).pathname;
  try {
    return new mmdb.Reader<T>(readFileSync(path));
  } catch (err) {
    console.warn(`no database at ${path}: ${(err as Error).message}`);
    return null;
  }
}
const asnDb = openDb<AsnResponse>(process.env.ASN_DB, "asn.mmdb");
const cityDb = openDb<CityResponse>(process.env.CITY_DB, "city.mmdb");

// Rounded to two decimals (about 1 km): enough for a map pin, and no finer
// than an IP lookup deserves.
function place(ip: string): { lat: number; lon: number; city: string; country: string } | null {
  try {
    const r = cityDb?.get(ip);
    const loc = r?.location;
    if (!loc || loc.latitude === undefined || loc.longitude === undefined) return null;
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      lat: round(loc.latitude),
      lon: round(loc.longitude),
      city: r.city?.names?.en ?? "",
      country: r.country?.iso_code ?? "",
    };
  } catch {
    return null;
  }
}

function network(ip: string): { asn: number; org: string } | null {
  try {
    const r = asnDb?.get(ip);
    return r?.autonomous_system_number ? { asn: r.autonomous_system_number, org: r.autonomous_system_organization ?? "" } : null;
  } catch {
    return null; // not an address the database understands
  }
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: http.OutgoingHttpHeaders = {}): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(text);
}

// The engine subtracts the dur= value of Server-Timing from time-to-first-byte
// to get network latency, as it does with Cloudflare's cfRequestDuration.
function serverTiming(start: bigint): string {
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return `app;dur=${ms.toFixed(3)}`;
}

function down(req: http.IncomingMessage, res: http.ServerResponse, url: URL, start: bigint): void {
  const bytes = Number(url.searchParams.get("bytes") ?? 0);
  if (!Number.isInteger(bytes) || bytes < 0) throw new HttpError(400, "bytes must be a non-negative integer");
  if (bytes > MAX_BYTES) throw new HttpError(400, `bytes must be at most ${MAX_BYTES}`);
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": bytes,
    "cache-control": "no-store",
    "server-timing": serverTiming(start),
  });
  let left = bytes;
  const pump = (): void => {
    while (left > 0) {
      const n = Math.min(left, CHUNK.length);
      left -= n;
      if (!res.write(n === CHUNK.length ? CHUNK : CHUNK.subarray(0, n))) {
        res.once("drain", pump);
        return;
      }
    }
    res.end();
  };
  req.socket.once("close", () => (left = 0));
  pump();
}

async function up(req: http.IncomingMessage, res: http.ServerResponse, start: bigint): Promise<void> {
  let bytes = 0;
  for await (const chunk of req) {
    bytes += (chunk as Buffer).length;
    if (bytes > MAX_BYTES) throw new HttpError(413, "body too large");
  }
  send(res, 200, { bytes }, { "server-timing": serverTiming(start) });
}

// The client's address as this instance sees it, cut to /24 (IPv4) or /48
// (IPv6) like Cloudflare's page does, and the network and rough place it
// belongs to, looked up from the full address. Behind Datum's HTTP proxy the address arrives in
// X-Forwarded-For; a client can set that header too, so this is only display.
function clientAddress(req: http.IncomingMessage): {
  ip: string;
  family: "IPv4" | "IPv6";
  network: { asn: number; org: string } | null;
  place: { lat: number; lon: number; city: string; country: string } | null;
} {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  let ip = first || req.socket.remoteAddress || "";
  if (ip.startsWith("::ffff:") && ip.includes(".")) ip = ip.slice(7);
  if (ip.includes(".")) {
    return { ip: ip.split(".").slice(0, 3).concat("0").join(".") + "/24", family: "IPv4", network: network(ip), place: place(ip) };
  }
  const groups = expandIPv6(ip).slice(0, 3).map((g) => g.replace(/^0+(?=.)/, ""));
  return { ip: `${groups.join(":")}::/48`, family: "IPv6", network: network(ip), place: place(ip) };
}

function expandIPv6(ip: string): string[] {
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const zeros = ip.includes("::") ? Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...zeros, ...t];
}

async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const start = process.hrtime.bigint();
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/__down") return down(req, res, url, start);
  if (req.method === "POST" && url.pathname === "/__up") return up(req, res, start);
  if (req.method === "GET" && url.pathname === "/") return send(res, 200, PAGE);
  if (req.method === "GET" && url.pathname === "/client.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
    res.end(CLIENT_JS);
    return;
  }
  if (req.method === "GET" && url.pathname === "/__meta") {
    return send(res, 200, { location, instance, client: clientAddress(req) });
  }
  if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });

  throw new HttpError(404, "not found");
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (res.headersSent) return void res.destroy();
    send(res, status, { error: err instanceof HttpError ? err.message : "internal error" });
  });
});

server.listen(port, "::", () => {
  console.log(`speed-test listening on [::]:${port}, location ${location || "unset"}`);
});
