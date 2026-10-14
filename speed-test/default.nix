# NixOS 26.05 image for the speed test.
#
#   nix-build -A app   # TypeScript server on Node.js, listens on :8080
let
  # Same pinned channel release as ../todo-app/default.nix.
  nixpkgsSrc = builtins.fetchTarball {
    url = "https://releases.nixos.org/nixos/26.05/nixos-26.05.11045.774debe7a0d1/nixexprs.tar.xz";
    sha256 = "sha256-S5MjznoY0gbQbcANPLz5RYjg+5/WQmFRgNbHcP+ydcg=";
  };
  pkgs = import nixpkgsSrc { system = "x86_64-linux"; };
  inherit (pkgs) lib dockerTools;

  nodejs = pkgs.nodejs-slim_22;

  osRelease = pkgs.writeTextDir "etc/os-release" ''
    NAME=NixOS
    ID=nixos
    VERSION_ID="${lib.trivial.release}"
    PRETTY_NAME="NixOS ${lib.trivial.release} (${lib.trivial.codeName})"
  '';

  # DB-IP's IP to ASN Lite (CC BY 4.0; the page credits it), for the page's
  # "Your network". Released monthly; bump the month and hash now and then.
  asnDb = pkgs.fetchurl {
    url = "https://download.db-ip.com/free/dbip-asn-lite-2026-10.mmdb.gz";
    hash = "sha256-bN3gK6qMG9YZq4TC5QXs2R1FKItah/qt8bfEFSWhepQ=";
  };

  # Compiles the server with tsc and bundles the browser code (Cloudflare's
  # measurement engine, d3-geo, the world map) with esbuild. The only
  # runtime package is mmdb-lib, which reads the ASN database.
  speedTest = pkgs.buildNpmPackage {
    pname = "speed-test";
    version = "1.0.0";
    # Only what the build reads, not a local node_modules or dist.
    src = lib.fileset.toSource {
      root = ./app;
      fileset = lib.fileset.unions [
        ./app/package.json
        ./app/package-lock.json
        ./app/tsconfig.json
        ./app/tsconfig.client.json
        ./app/src
      ];
    };
    npmDepsHash = "sha256-6PiwQnbSHAvV0dOdjT2Ns6mu3rYz74iIWRVDOFZb0cY=";
    nodejs = pkgs.nodejs_22; # npm, tsc and esbuild at build time; nodejs-slim at runtime
    installPhase = ''
      runHook preInstall
      npm prune --omit=dev
      mkdir -p $out/lib/speed-test
      cp -r dist node_modules package.json $out/lib/speed-test/
      gunzip -c ${asnDb} > $out/lib/speed-test/asn.mmdb
      runHook postInstall
    '';
  };
in
{
  app = dockerTools.buildLayeredImage {
    name = "speed-test";
    tag = lib.trivial.release;
    contents = [ dockerTools.fakeNss osRelease ];
    extraCommands = ''
      mkdir -p tmp
      chmod 1777 tmp
    '';
    config = {
      Cmd = [ "${nodejs}/bin/node" "${speedTest}/lib/speed-test/dist/server.js" ];
      Env = [ "PORT=8080" "NODE_ENV=production" ];
      ExposedPorts."8080/tcp" = { };
    };
  };
}
