{
  description = "aspyn dev shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f {
        inherit system;
        pkgs = import nixpkgs { inherit system; };
      });
    in {
      devShells = forAllSystems ({ pkgs, ... }: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_latest
            (pkgs.pnpm.override { nodejs = pkgs.nodejs_latest; })
          ];

          shellHook = ''
            export PATH="$PWD/.flake.local/bin:$PATH"
          '';
        };
      });
    };
}
