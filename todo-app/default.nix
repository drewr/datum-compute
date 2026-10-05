# NixOS 26.05 images for a todo list app and its PostgreSQL database.
#
#   nix-build -A app   # TypeScript web app on Node.js, listens on :8080
#   nix-build -A db    # NixOS system: systemd as PID 1, services.postgresql
let
  # Same pinned channel release as ../nixos/default.nix.
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

  # Lets `nix-shell -p hello` work in the exec-able images: nixpkgs is the
  # pinned channel above, and the image's own store paths are registered when
  # the container starts (the image carries no Nix database).
  nixEnv = [
    "NIX_PATH=nixpkgs=${nixpkgsSrc}"
    "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
    "NIX_SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
  ];
  nixConf = pkgs.writeTextDir "etc/nix/nix.conf" ''
    experimental-features = nix-command flakes
    sandbox = false
    build-users-group =
  '';

  # Compiles src/*.ts with tsc and keeps only production dependencies.
  todoApp = pkgs.buildNpmPackage {
    pname = "todo-app";
    version = "1.0.0";
    src = ./app;
    npmDepsHash = "sha256-7j29sAcq2Bf3ruyI/89pD3QR4D2bOJvGvcaShhf32Ic=";
    nodejs = pkgs.nodejs_22; # npm and tsc at build time; nodejs-slim at runtime
    installPhase = ''
      runHook preInstall
      npm prune --omit=dev
      mkdir -p $out/lib/todo-app
      cp -r dist node_modules package.json $out/lib/todo-app/
      runHook postInstall
    '';
  };

  # The database is a whole NixOS system booted by systemd inside the
  # container. Users, Postgres and its setup all come from modules; NixOS
  # activation writes /etc/passwd and friends at boot.
  dbSystem = (import "${nixpkgsSrc}/nixos/lib/eval-config.nix" {
    system = "x86_64-linux";
    modules = [
      ({ config, pkgs, ... }: {
        boot.isContainer = true;
        system.stateVersion = "26.05";

        # Container runtimes mount the cgroup filesystem read-only, and systemd
        # needs it writable (CAP_SYS_ADMIN). systemd also enables controllers on
        # the cgroup it starts in, after which cgroup v2 forbids processes
        # there; the runtime places `datumctl compute exec` processes in the
        # container's root cgroup, so start systemd one level down.
        boot.postBootCommands = ''
          ${pkgs.util-linux}/bin/mount -o remount,rw /sys/fs/cgroup || true
          mkdir -p /sys/fs/cgroup/systemd && echo 1 > /sys/fs/cgroup/systemd/cgroup.procs || true
        '';

        # The runtime configures eth0 and writes /etc/resolv.conf with Datum's
        # resolvers; keep NixOS from regenerating it.
        networking.resolvconf.enable = false;
        # Instances only have private addresses and no inbound internet path.
        networking.firewall.enable = false;

        # A shell and Nix for `datumctl compute exec`. nix-shell -p hello works:
        # nixpkgs is the pinned channel, and the oneshot below registers the
        # image's store paths from /nix-path-registration on first boot.
        programs.zsh.enable = true;
        nix.nixPath = [ "nixpkgs=${nixpkgsSrc}" ];
        nix.settings = {
          sandbox = false;
          experimental-features = [ "nix-command" "flakes" ];
        };
        systemd.services.nix-image-registration = {
          wantedBy = [ "multi-user.target" ];
          before = [ "nix-daemon.service" "nix-daemon.socket" ];
          unitConfig.ConditionPathExists = "/nix-path-registration";
          serviceConfig.Type = "oneshot";
          script = ''
            ${config.nix.package}/bin/nix-store --load-db < /nix-path-registration
            rm /nix-path-registration
          '';
        };

        services.postgresql = {
          enable = true;
          package = pkgs.postgresql_17;
          enableTCPIP = true;
          ensureDatabases = [ "todo" ];
          ensureUsers = [ { name = "todo"; ensureDBOwnership = true; } ];
          # Private (ULA) peers only, with the password set below.
          authentication = "host todo todo fc00::/7 scram-sha-256";
        };

        # Sets the todo role's password from the todo-db Secret (mounted at
        # /secrets/todo-db) and loads the schema and sample rows.
        systemd.services.todo-db-seed = {
          description = "Set the todo role's password and load the todo schema";
          requires = [ "postgresql-setup.service" ];
          after = [ "postgresql-setup.service" ];
          wantedBy = [ "multi-user.target" ];
          path = [ config.services.postgresql.finalPackage ];
          serviceConfig = {
            Type = "oneshot";
            RemainAfterExit = true;
            User = "postgres";
            LoadCredential = "password:/secrets/todo-db/POSTGRES_PASSWORD";
          };
          script = ''
            psql -d postgres -v ON_ERROR_STOP=1 <<'EOF'
            \set pw `cat "$CREDENTIALS_DIRECTORY/password"`
            ALTER ROLE todo PASSWORD :'pw';
            EOF
            psql -d todo -f ${./db/schema.sql}
          '';
        };

        environment.systemPackages = with pkgs; [
          iproute2 # ip
          nettools # route, netstat
          iputils # ping
          # iputils dropped the ping6 binary; keep the old name working.
          (writeShellScriptBin "ping6" ''exec ${iputils}/bin/ping -6 "$@"'')
          s6-dns # s6-dnsip, s6-dnsq, s6-dnsqr, ...
          dnsutils # dig
        ];
      })
    ];
  }).config.system.build.toplevel;

  # Carries IPv6 packets between a laptop's tun and the VPC over iroh.
  vpcTun = pkgs.rustPlatform.buildRustPackage {
    pname = "vpc-tun";
    version = "0.1.0";
    src = ./vpc-tun;
    cargoLock.lockFile = ./vpc-tun/Cargo.lock;
  };

  dbClosure = pkgs.closureInfo { rootPaths = [ dbSystem ]; };

  # The gateway forwards between eth0 and the tun, and answers neighbor
  # discovery on eth0 for each peer's address (the VPC finds addresses inside
  # an instance's /96 by NDP). /proc/sys is mounted read-only in the
  # container; remounting it needs CAP_SYS_ADMIN.
  gatewayTools = with pkgs; [ bashInteractive coreutils gnugrep procps iproute2 iputils tcpdump nftables zsh nix dockerTools.caCertificates nixConf ];
  gatewayClosure = pkgs.closureInfo { rootPaths = gatewayTools ++ [ nixpkgsSrc pkgs.util-linux vpcTun ]; };
  gatewayStart = pkgs.writeShellApplication {
    name = "vpc-gateway-start";
    runtimeInputs = with pkgs; [ coreutils iproute2 nftables util-linux vpcTun nix ];
    text = ''
      [ -e /nix/var/nix/db/db.sqlite ] || nix-store --load-db < ${gatewayClosure}/registration
      mount -o remount,rw /proc/sys
      echo 1 > /proc/sys/net/ipv6/conf/all/forwarding
      echo 2 > /proc/sys/net/ipv6/conf/eth0/accept_ra # keep the RA default route
      echo 1 > /proc/sys/net/ipv6/conf/eth0/proxy_ndp
      mkdir -p /dev/net
      [ -e /dev/net/tun ] || mknod /dev/net/tun c 10 200
      ip tuntap add dev vpc0 mode tun
      # IPv6's minimum MTU, which fits in one iroh datagram (1288 bytes on a
      # relay path); bigger packets would fall back to the stream and arrive
      # out of order with the rest, which slows TCP down tenfold.
      ip link set vpc0 mtu 1280 up
      # Exit node: the platform only lets an instance's own address out to the
      # internet, so rewrite laptop traffic bound outside the private range
      # (fc00::/7) to this instance's address. Private destinations still see
      # the laptop's own address. Laptop IPv4 arrives translated to IPv6 for
      # the network's NAT64 (64:ff9b::/96), so this rule covers it too.
      if [ "''${VPC_TUN_EXIT:-}" = 1 ]; then
        nft -f - <<'EOF'
      table ip6 vpc_exit {
        chain postrouting {
          type nat hook postrouting priority srcnat; policy accept;
          iifname "vpc0" oifname "eth0" ip6 daddr != fc00::/7 masquerade
        }
      }
      EOF
      fi
      peers=()
      IFS=, read -ra list <<< "$VPC_TUN_PEERS"
      for p in "''${list[@]}"; do peers+=(--peer "$p"); done
      # --exit also translates peers' IPv4 for the network's NAT64.
      [ "''${VPC_TUN_EXIT:-}" = 1 ] && peers+=(--exit)
      exec vpc-tun gateway --key-file /secrets/vpc-gateway/key --tun vpc0 "''${peers[@]}"
    '';
  };
in
{
  app = dockerTools.buildLayeredImage {
    name = "todo-app";
    tag = lib.trivial.release;
    contents = [ dockerTools.fakeNss osRelease ];
    extraCommands = ''
      mkdir -p tmp
      chmod 1777 tmp
    '';
    config = {
      Cmd = [ "${nodejs}/bin/node" "${todoApp}/lib/todo-app/dist/server.js" ];
      Env = [ "PORT=8080" "NODE_ENV=production" ];
      ExposedPorts."8080/tcp" = { };
    };
  };

  # Runs only with the capabilities and secret mount in todo-db.yaml.
  db = dockerTools.buildLayeredImage {
    name = "todo-db";
    tag = lib.trivial.release;
    extraCommands = ''
      mkdir -p sbin tmp
      ln -s ${dbSystem}/init sbin/init
      cp ${dbClosure}/registration nix-path-registration
    '';
    config = {
      Cmd = [ "${dbSystem}/init" ];
      # Lets `datumctl compute exec` find sh and the system's tools.
      Env = [ "PATH=/run/current-system/sw/bin:/bin" ] ++ nixEnv;
      ExposedPorts."5432/tcp" = { };
    };
  };

  # The laptop side: nix-build -A vpc-tun
  vpc-tun = vpcTun;

  # Runs only with the capabilities and secret mount in vpc-gateway.yaml.
  vpc-gateway = dockerTools.buildLayeredImage {
    name = "vpc-gateway";
    tag = lib.trivial.release;
    # ping, ip, ss, tcpdump, grep and ps for debugging with `datumctl compute
    # exec`, plus zsh and Nix (see nixEnv).
    contents = gatewayTools;
    extraCommands = ''
      mkdir -p tmp
      chmod 1777 tmp
    '';
    config = {
      Cmd = [ "${gatewayStart}/bin/vpc-gateway-start" ];
      Env = [ "PATH=/bin" ] ++ nixEnv;
    };
  };
}
