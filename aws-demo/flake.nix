{
  description = "Tools for the aws-demo scripts (datumctl itself is not in nixpkgs; install it separately)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (s: f nixpkgs.legacyPackages.${s});
    in {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            awscli2
            ssm-session-manager-plugin
            jq
            curl
            coreutils
            gnugrep
            gawk
            gnused
            python3
            gh
          ];
        };
      });
    };
}
