{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      forAllSystems = nixpkgs.lib.genAttrs [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              dotnet-sdk_10
              nodejs_24
              pnpm
              jq
              curl
              chromium
            ];
            DOTNET_CLI_TELEMETRY_OPTOUT = "1";
            DOTNET_NOLOGO = "1";
            CHROMIUM = pkgs.lib.getExe pkgs.chromium;
            # makeFontsConf only includes /etc/fonts/conf.d, which a non-NixOS host may lack, leaving no family aliases.
            FONTCONFIG_FILE = pkgs.writeText "fonts.conf" ''
              <?xml version="1.0"?>
              <!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
              <fontconfig>
                <include>${pkgs.fontconfig.out}/etc/fonts/conf.d</include>
                <dir>${pkgs.dejavu_fonts}</dir>
                <cachedir prefix="xdg">fontconfig</cachedir>
              </fontconfig>
            '';
          };
        }
      );
    };
}
