{
  pkgs,
  inputs,
  config,
  ...
}:

let
  state = "${config.devenv.state}/slskd";
  dll = "${state}/artifacts/bin/slskd/debug/slskd.dll";
in
{
  packages = with pkgs; [
    dotnet-sdk_10
    nodejs_24
    pnpm
    jq
    curl
    chromium
  ];

  env = {
    DOTNET_CLI_TELEMETRY_OPTOUT = "1";
    DOTNET_NOLOGO = "1";
    CHROMIUM = pkgs.lib.getExe pkgs.chromium;
    SLSKD_SRC = "${inputs.slskd}";
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

  enterShell = ''
    ln -sfn "$SLSKD_SRC" "$DEVENV_ROOT/slskd"
  '';

  tasks."slskd:build" = {
    exec = ''
      dotnet build "$SLSKD_SRC/src/slskd/slskd.csproj" --artifacts-path "${state}/artifacts" &&
        echo "$SLSKD_SRC" >"${state}/source"
    '';
    status = ''[[ -f "${dll}" && $(cat "${state}/source" 2>/dev/null) == "$SLSKD_SRC" ]]'';
    before = [ "devenv:processes:slskd" ];
  };

  processes.slskd = {
    exec = ''
      mkdir -p "$DEVENV_ROOT/dist"
      SLSKD_CONTENT_PATH=$(realpath --relative-to="$(dirname "${dll}")" "$DEVENV_ROOT/dist") exec dotnet "${dll}"
    '';
    env = {
      SLSKD_APP_DIR = "${state}/app";
      SLSKD_HTTP_PORT = "5030";
      SLSKD_URL_BASE = "/slskd";
      SLSKD_USERNAME = "slskd";
      SLSKD_PASSWORD = "slskd";
      SLSKD_NO_CONNECT = "true";
      SLSKD_NO_SHARE_SCAN = "true";
      SLSKD_NO_VERSION_CHECK = "true";
      SLSKD_NO_CONFIG_WATCH = "true";
    };
    ready.http.get = {
      port = 5030;
      path = "/api/v0/session/enabled";
    };
    shutdown.grace = 10;
  };
}
