{
  pkgs,
  inputs,
  config,
  ...
}:

let
  state = "${config.devenv.state}/slskd";
  dll = "${state}/artifacts/bin/slskd/debug/slskd.dll";
  soulfind = pkgs.buildDubPackage {
    pname = "soulfind";
    version = inputs.soulfind.shortRev;
    src = inputs.soulfind;
    dubLock.dependencies = { };
    dubBuildFlags = [ ":server" ];
    buildInputs = [ pkgs.sqlite ];
    # TODO: drop once every slskd the tests run against has a Soulseek.NET that acknowledges private message IDs of
    # 2^31 and up. Soulfind picks IDs at random, so half of them are too big, while the real server's count up from far
    # below 2^31, as they do here.
    postPatch = ''
      substituteInPlace src/server/server.d --replace-fail \
        'while (id == 0 || id in pms) id = unpredictableSeed;' \
        'static uint last_id; id = ++last_id;'
    '';
    installPhase = ''
      runHook preInstall
      install -Dm755 bin/soulfind -t $out/bin
      runHook postInstall
    '';
    meta.mainProgram = "soulfind";
  };
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
    SOULFIND_BIN = pkgs.lib.getExe soulfind;
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
    # slskd restarts by starting a copy of itself and exiting, and devenv ends the session when this script exits.
    exec = ''
      mkdir -p "$DEVENV_ROOT/dist"
      SLSKD_CONTENT_PATH=$(realpath --relative-to="$(dirname "${dll}")" "$DEVENV_ROOT/dist") dotnet "${dll}" || exit
      while ${pkgs.lib.getExe' pkgs.procps "pidwait"} -s 0 -x dotnet; do :; done
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
