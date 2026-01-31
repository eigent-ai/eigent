{
  description = "Eigent - AI-powered desktop agent for browser automation";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        version = "0.0.82";
      in
      {
        packages = {
          eigent = pkgs.appimageTools.wrapType2 {
            pname = "eigent";
            inherit version;

            src = pkgs.fetchurl {
              url = "https://github.com/eigent-ai/eigent/releases/download/v${version}/Eigent-${version}.AppImage";
              sha256 = "sha256-3iymiEjzwGCjnoKWweVbBeGEDFplyMgEwPuOU0yz9Pw="; # Update with actual hash
            };

            extraInstallCommands =
              let
                appimageContents = pkgs.appimageTools.extract {
                  pname = "eigent";
                  inherit version;
                  src = pkgs.fetchurl {
                    url = "https://github.com/eigent-ai/eigent/releases/download/v${version}/Eigent-${version}.AppImage";
                    sha256 = "sha256-3iymiEjzwGCjnoKWweVbBeGEDFplyMgEwPuOU0yz9Pw="; # Update with actual hash
                  };
                };
              in
              ''
                source "${pkgs.makeWrapper}/nix-support/setup-hook"
                wrapProgram $out/bin/eigent \
                  --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations}}"

                install -Dm444 ${appimageContents}/eigent.desktop $out/share/applications/eigent.desktop
                substituteInPlace $out/share/applications/eigent.desktop \
                  --replace 'Exec=eigent' 'Exec=eigent %U'

                for size in 16 32 48 64 128 256 512; do
                  if [ -f "${appimageContents}/usr/share/icons/hicolor/''${size}x''${size}/apps/eigent.png" ]; then
                    install -Dm444 "${appimageContents}/usr/share/icons/hicolor/''${size}x''${size}/apps/eigent.png" \
                      "$out/share/icons/hicolor/''${size}x''${size}/apps/eigent.png"
                  fi
                done
              '';

            meta = with pkgs.lib; {
              description = "AI-powered desktop agent for browser automation";
              homepage = "https://eigent.ai";
              license = licenses.asl20;
              maintainers = [ ];
              platforms = [ "x86_64-linux" ];
              mainProgram = "eigent";
            };
          };

          default = self.packages.${system}.eigent;
        };

        apps = {
          eigent = flake-utils.lib.mkApp {
            drv = self.packages.${system}.eigent;
          };
          default = self.apps.${system}.eigent;
        };
      }
    );
}
