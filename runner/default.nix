# A GitHub Actions runner on NixOS 26.05, to run this repo's workflows on a
# Datum compute instance (general-purpose class).
#
#   nix-build -A image
let
  # Same pinned channel release as ../todo-app/default.nix.
  nixpkgsSrc = builtins.fetchTarball {
    url = "https://releases.nixos.org/nixos/26.05/nixos-26.05.11045.774debe7a0d1/nixexprs.tar.xz";
    sha256 = "sha256-S5MjznoY0gbQbcANPLz5RYjg+5/WQmFRgNbHcP+ydcg=";
  };
  pkgs = import nixpkgsSrc { system = "x86_64-linux"; };
  inherit (pkgs) lib dockerTools;

  # What the images workflow's steps call. There is no Docker here: skopeo
  # pushes the Nix-built images and buildkitd (run by the workflow) builds the
  # unikernel image.
  tools = with pkgs; [
    bashInteractive coreutils findutils gnugrep gnused gawk gnutar gzip xz bzip2 unzip
    diffutils patch which util-linux curl jq git gh nix skopeo buildkit
  ];

  # Registers the image's own store paths, so a root-run `nix` (single user,
  # no sandbox) treats them as valid instead of fetching them again.
  closure = pkgs.closureInfo { rootPaths = tools ++ [ pkgs.github-runner ]; };

  nixConf = pkgs.writeTextDir "etc/nix/nix.conf" ''
    build-users-group =
    sandbox = false
    experimental-features = nix-command flakes
  '';

  # skopeo refuses to run without a policy file.
  containersPolicy = pkgs.writeTextDir "etc/containers/policy.json" (builtins.toJSON {
    default = [ { type = "insecureAcceptAnything"; } ];
  });

  # Registers with GitHub, then takes jobs. Secret keys under /secrets/github:
  #   pat                 a token that can administer the repo's runners;
  #                       a fresh registration token is minted at every start
  #   registration-token  or one registration token (expires in an hour, so
  #                       it only covers the first start)
  start = pkgs.writeShellApplication {
    name = "runner-start";
    runtimeInputs = tools ++ [ pkgs.github-runner ];
    text = ''
      nix-store --load-db < ${closure}/registration
      mkdir -p /tmp /root /work
      chmod 1777 /tmp
      export HOME=/root RUNNER_ROOT=/work/runner RUNNER_ALLOW_RUNASROOT=1
      if [ -f /secrets/github/pat ]; then
        token=$(curl -fsS -X POST \
          -H "Authorization: Bearer $(cat /secrets/github/pat)" \
          -H "Accept: application/vnd.github+json" \
          "https://api.github.com/repos/$GITHUB_REPOSITORY/actions/runners/registration-token" | jq -r .token)
      else
        token=$(cat /secrets/github/registration-token)
      fi
      config.sh --unattended --replace \
        --url "https://github.com/$GITHUB_REPOSITORY" --token "$token" \
        --name "''${RUNNER_NAME:-$(hostname)}" --labels datum --work /work/_work
      exec run.sh
    '';
  };
in
{
  image = dockerTools.buildLayeredImage {
    name = "github-runner";
    tag = lib.trivial.release;
    contents = tools ++ [ dockerTools.fakeNss dockerTools.caCertificates nixConf containersPolicy ];
    config = {
      Cmd = [ "${start}/bin/runner-start" ];
      Env = [
        "PATH=/bin"
        "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
        "NIX_SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
        "DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1"
      ];
    };
  };
}
