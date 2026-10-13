# speed-test

A copy of [speed.cloudflare.com](https://speed.cloudflare.com/) with Datum's branding, measuring the path from your browser to a Datum Cloud compute instance instead of to Cloudflare. The layout, sizes and spacing follow Cloudflare's page; the logo, type and colors come from [todo-app](../todo-app/app/src/theme.ts).

The browser runs Cloudflare's open-source measurement engine, [`@cloudflare/speedtest`](https://github.com/cloudflare/speedtest) (MIT), pointed at this server:

- `GET /__down?bytes=N` streams N random bytes (up to 100 MB).
- `POST /__up` reads and discards the body.
- Both return `Server-Timing: app;dur=…`, which the engine subtracts from time-to-first-byte to get latency.
- `GET /__meta` returns the instance's location (`LOCATION`), its hostname, and the client's address cut to /24 or /48.

It differs from Cloudflare's test in three ways:

- **No packet loss.** Cloudflare measures it over WebRTC through a TURN relay, and this test has none, so it shows N/A. The quality scores count it as unknown, as the engine does when it's missing.
- **Smaller downloads at most.** It stops at 100 MB downloads and 50 MB uploads; Cloudflare goes to 250 MB.
- **Nothing is reported.** The engine posts results to Cloudflare by default; here that's turned off.

## Run it locally

```sh
cd app
npm ci
npm run build
PORT=8080 LOCATION=us-central-1 npm start
```

Then open http://localhost:8080. Over loopback, upload results run into the Gbps.

## Build and deploy

`nix-build -A app` builds the OCI image. [manifests/speed-test.yaml](manifests/speed-test.yaml) has the steps to wrap it for the unikernel class and deploy it.
