# datum-compute

Notes and demos for Datum Cloud compute.

- [todo-app](todo-app/): a TypeScript todo app and its PostgreSQL database, built with Nix and NixOS and running on Datum Cloud (the app as a unikernel, the database on general-purpose). Includes vpc-tun, which puts a laptop on the project's private network over iroh and can act as its exit node to the internet.
- [runner](runner/): a GitHub Actions runner image and manifest, to run this repo's workflows on a Datum compute instance. Start a manual run of the images workflow with runner set to `datum`.
- [speed-test](speed-test/): a copy of speed.cloudflare.com with Datum branding, measuring download, upload, latency and jitter between the browser and a Datum compute instance. It runs Cloudflare's open-source measurement engine against its own endpoints, as a unikernel.
