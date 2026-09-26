# slskd-alternative-webui

A drop-in replacement web UI for [slskd](https://github.com/slskd/slskd).

## Features

- Long lists are virtualised, and stay responsive while transfers update.
- Browsed shares and user profiles persist across reloads and logins.
- Page state, such as the open user, room or conversation and filters and sorts, is stored in the URL.
- Transfers and search results are sortable, filterable tables.
- Downloading a folder from Browse keeps its subfolders.
- Search results filter by quality, size, length, files per folder and free upload slot.
- Files shows each directory's whole tree, with folder sizes and a filter.

## Install

```sh
git clone https://github.com/wongcallum/slskd-alternative-webui.git
cd slskd-alternative-webui
pnpm install
pnpm build
```

This writes the UI to `dist`. Install it in one of these ways:

- Set `web.content_path` in `slskd.yml` (or `SLSKD_CONTENT_PATH`, or `--content-path`) to `dist`, and restart slskd.
  The path must be relative to the directory the slskd binary is in, and slskd refuses to start with an absolute
  path:

  ```yaml
  web:
    content_path: ../slskd-alternative-webui/dist
  ```

- In Docker, mount `dist` over the image's `wwwroot`, for example `-v /path/to/dist:/slskd/wwwroot:ro`, and recreate
  the container.
- Replace the contents of the `wwwroot` directory beside the slskd binary with the contents of `dist`.

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

## Roadmap

- A prebuilt `dist` attached to each GitHub release
- Keyboard handling (weigh `@headless-tree` for Browse's tree)
- Filter criteria (quality, size) for Browse.
- Dashboard
- Reply to a room message, quoting it in the message box.
- Audit the stock UI for complete feature parity

## License

[AGPL-3.0-or-later](LICENSE)
