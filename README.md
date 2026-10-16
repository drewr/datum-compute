# datum-compute

Notes and demos for Datum Cloud compute.

- [todo-app](todo-app/): a TypeScript todo app and its PostgreSQL database, built with Nix and NixOS and running on Datum Cloud (the app as a unikernel, the database on general-purpose). Includes vpc-tun, which puts a laptop on the project's private network over iroh and can act as its exit node to the internet.
- [k8s-demo](k8s-demo/): a 3-node Kubernetes cluster from the upstream binaries on the unikernel class, serving one Caddy workload at a Datum URL, with `deploy.sh` to build, bring up and tear down. Also records what the unikernel class's kernel allows and how idle suspension affects a cluster.
- [runner](runner/): a GitHub Actions runner image and manifest, to run this repo's workflows on a Datum compute instance. Start a manual run of the images workflow with runner set to `datum`.
