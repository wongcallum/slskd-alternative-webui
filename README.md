# slskd-alternative-webui

A drop-in replacement web UI for [slskd](https://github.com/slskd/slskd).

## Features

- Long lists are virtualised, and stay responsive while transfers update.
- Browsed shares and user profiles persist across reloads and logins.
- Page state, such as the open user, room or conversation and filters and sorts, is stored in the URL.
- Transfers and search results are sortable, filterable tables.
- Downloading a folder from Browse or a search result keeps its subfolders.
- Search results filter by quality, size, length, files per folder and free upload slot.
- Files shows each directory's whole tree, with folder sizes and a filter.
- The dashboard charts what was transferred and what failed by hour, day or month, and lists the top users, your most
  downloaded folders and the errors, counting successes and failures apart.
- Everything works from the keyboard. Arrow keys move through lists and the folder tree, `/` goes to the page's
  filter, `g` and a letter switch pages, and `?` lists the keys.

## Install

Download `slskd-alternative-webui.zip` from the
[latest release](https://github.com/wongcallum/slskd-alternative-webui/releases/latest) and unzip it into a directory:

```sh
curl -LO https://github.com/wongcallum/slskd-alternative-webui/releases/latest/download/slskd-alternative-webui.zip
unzip slskd-alternative-webui.zip -d slskd-alternative-webui
```

To build it from source instead, run `pnpm install` and `pnpm build` in a clone of this repository, which writes it to
`dist`. Install the directory in one of these ways:

- Set `web.content_path` in `slskd.yml` (or `SLSKD_CONTENT_PATH`, or `--content-path`) to it, and restart slskd.
  The path must be relative to the directory the slskd binary is in, and slskd refuses to start with an absolute
  path:

  ```yaml
  web:
    content_path: ../slskd-alternative-webui
  ```

- In Docker, mount it over the image's `wwwroot`, for example `-v /path/to/slskd-alternative-webui:/slskd/wwwroot:ro`,
  and recreate the container.
- Replace the contents of the `wwwroot` directory beside the slskd binary with its contents.

To update, replace the directory's contents with the new release's and reload the page. slskd doesn't need a restart.

## Uninstall

- Remove `web.content_path` from `slskd.yml` (or the environment variable or flag), and restart slskd.
- If you replaced the contents of `wwwroot`, restore them from the slskd release you installed.

## Development

Install Nix and devenv, then enter the environment with `devenv shell` or `direnv allow`.
It provides Node.js, pnpm, the .NET SDK and Chromium, and links `slskd` to the slskd source pinned in `devenv.yaml`.

1. Run `pnpm install`.
2. Run `devenv up -d` to build and start a dev slskd, and `devenv down` to stop it. It runs with `no_connect`, url
   base `/slskd` and login `slskd`/`slskd`, and serves `dist`.
3. Run `pnpm dev` to serve the UI at `http://localhost:5173/slskd/`, proxying the API and hubs to the dev slskd.
   After `pnpm build`, slskd serves the build at `http://localhost:5030/slskd/`.

- To use a real Soulseek account, put `soulseek: { username, password }` in `.devenv/state/slskd/app/slskd.yml` and
  press Connect in the Soulseek popover.
- To run slskd with other settings, run `devenv down` first, then override its environment, for example
  `devenv up -d -O processes.slskd.env.SLSKD_NO_AUTH:string true`.
- To move to another slskd commit, change its rev in `devenv.yaml` and run `devenv update slskd`.
- Run `pnpm fmt` and `pnpm lint` before committing.

### Tests

`pnpm test` builds the UI and runs the tests with Playwright. Each test worker starts its own slskd instances from the
build `devenv up` makes. `tests/contract` checks the slskd behaviour the UI relies on, and `tests/ui` checks the pages
in Chromium.

Tests that need a Soulseek login run on a local network, which each worker starts the first time one of them runs:
[Soulfind](https://github.com/soulfind-dev/soulfind) as the server, and two slskd peers sharing test files. Nothing
reaches the real Soulseek network.

- To test another slskd, set `SLSKD_BIN` to its `slskd` binary or `slskd.dll`. A release binary needs libicu, or
  `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1` where there's none.
- devenv builds Soulfind from the commit pinned in `devenv.yaml` and sets `SOULFIND_BIN`. Soulfind needs an IPv4
  route, though not internet access.
- CI runs the tests in the devenv shell against the pinned slskd and the latest release, and nightly against the latest
  release and slskd's master, each built from source.

## Roadmap

- Filter criteria (quality, size) for Browse.
- Reply to a room message, quoting it in the message box.
- Audit the stock UI for complete feature parity

## License

[AGPL-3.0-or-later](LICENSE)
