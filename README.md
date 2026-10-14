# datum-compute

Notes and demos for Datum Cloud compute.

- [todo-app](todo-app/): a TypeScript todo app and its PostgreSQL database, built with Nix and NixOS and running on Datum Cloud (the app as a unikernel, the database on general-purpose). Includes vpc-tun, which puts a laptop on the project's private network over iroh and can act as its exit node to the internet.
- [runner](runner/): a GitHub Actions runner image and manifest, to run this repo's workflows on a Datum compute instance. Start a manual run of the images workflow with runner set to `datum`.
- [aws-demo](aws-demo/): a fleet of EC2 instances in many AWS regions joined to one Datum VPC through Datum Connect, with scripts to build and tear it down and a `netcheck` latency report.
