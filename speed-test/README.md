# speed-test

A copy of [speed.cloudflare.com](https://speed.cloudflare.com/) with Datum's branding, measuring the path from your browser to a Datum Cloud compute instance instead of to Cloudflare. The layout, sizes and spacing follow Cloudflare's page; the logo, type and colors come from [todo-app](../todo-app/app/src/theme.ts).

The browser runs Cloudflare's open-source measurement engine, [`@cloudflare/speedtest`](https://github.com/cloudflare/speedtest) (MIT), pointed at this server:

- `GET /__down?bytes=N` streams N random bytes (up to 100 MB).
- `POST /__up` reads and discards the body.
- Both return `Server-Timing: app;dur=…`, which the engine subtracts from time-to-first-byte to get latency.
- `GET /__meta` returns the instance's location (`LOCATION`), its hostname, the client's address cut to /24 or /48, the client's network (AS number and name), and the client's rough place (city, and coordinates rounded to about 1 km) for the map's route.

The network and place come from DB-IP's [IP to ASN Lite](https://db-ip.com/db/download/ip-to-asn-lite) and [IP to City Lite](https://db-ip.com/db/download/ip-to-city-lite) databases (CC BY 4.0), which `default.nix` fetches and installs as `asn.mmdb` and `city.mmdb` next to `dist/`. The lookups happen on the instance. The city database is about 130 MB, which the server holds in memory.

The map is [OpenFreeMap](https://openfreemap.org)'s Positron basemap (OpenStreetMap data), drawn by [MapLibre GL JS](https://maplibre.org) and recolored from the `--map-*` tokens in `theme.ts`. The browser loads the style and tiles from OpenFreeMap directly. The build copies MapLibre's worker into `dist/` next to `client.js`, and the server gzips the three browser files once at startup.

It differs from Cloudflare's test in three ways:

- **No packet loss.** Cloudflare measures it over WebRTC through a TURN relay, and this test has none, so it shows N/A. The quality scores count it as unknown, as the engine does when it's missing.
- **Smaller downloads at most.** It stops at 100 MB downloads and 50 MB uploads; Cloudflare goes to 250 MB.
- **Nothing is reported.** The engine posts results to Cloudflare by default; here that's turned off.

## Run it locally

```sh
cd app
npm ci
npm run build
curl -s https://download.db-ip.com/free/dbip-asn-lite-2026-10.mmdb.gz | gunzip > asn.mmdb
curl -s https://download.db-ip.com/free/dbip-city-lite-2026-10.mmdb.gz | gunzip > city.mmdb
PORT=8080 LOCATION=us-central-1 npm start
```

The server looks for `asn.mmdb` and `city.mmdb` in `app/`; set `ASN_DB` and `CITY_DB` to read them from elsewhere. Without them the page leaves out "Your network" and the route on the map.

Then open http://localhost:8080. Over loopback, upload results run into the Gbps.

## Icons

The favicon is the Datum mark from the logo in `app/src/theme.ts`: an SVG that the server builds from it, canyon clay in light mode and aurora moss in dark. `app/static/` holds two raster copies, `favicon.ico` (16, 32 and 48 px, canyon clay on transparent) and `apple-touch-icon.png` (180 px, aurora moss on midnight fjord). They were drawn from the same path with `rsvg-convert` and combined with ImageMagick; redraw them if the mark or colors change.

## Build and deploy

`nix-build -A app` builds the OCI image. [manifests/speed-test.yaml](manifests/speed-test.yaml) has the steps to wrap it for the unikernel class and deploy it.
