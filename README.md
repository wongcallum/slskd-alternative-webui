# slskd alternative web UI

An alternative web UI for [slskd](https://github.com/slskd/slskd), run against stock slskd as a drop-in
replacement for its `wwwroot`. It covers Search, Downloads, Uploads and Browse so far.

Build it with `pnpm build` and serve `dist` as slskd's `web.content_path`. The path must be relative to the slskd
binary's directory.

How it works is in [docs/design.md](docs/design.md), and verified behaviour of slskd and our libraries is in
[docs/facts.md](docs/facts.md).

## Development

Install Nix and devenv (`nix profile add nixpkgs#devenv`), then enter the environment with `devenv shell` or
`direnv allow`.

- `devenv up -d` builds and starts a dev slskd from the source pinned in `devenv.yaml`, and `devenv down` stops it.
  It runs with `no_connect`, url base `/slskd` and login `slskd`/`slskd`, and serves `dist`.
- `pnpm dev` (`--host` to reach it through port forwarding) serves the UI at `http://localhost:5173/slskd/`. After
  `pnpm build`, slskd serves the build at `http://localhost:5030/slskd/`.
- To use a real Soulseek account, put `soulseek: { username, password }` in `.devenv/state/slskd/app/slskd.yml`
  and press Connect in the Soulseek popover.
- To move to another slskd commit, change its rev in `devenv.yaml` and run `devenv update slskd`.

## Roadmap

What's left of the stock UI, in order:

1. Dashboard. Once it exists, decide whether `/` redirects there instead of `/searches`. The nav grows to nine
   destinations with the pages below, so settle its layout here too.
2. System info: the application state, Restart, Shut down, Check for updates and Get privileges. The shell then gets
   a marker for a pending restart, reconnect or share rescan that links there, and a new-version notice.
3. System logs, from the logs hub.
4. Rooms
5. Chat
6. Users
7. System shares: the shares and exclusions, each share's contents, and rescanning with progress.
8. System files: browsing the downloads and incomplete directories, and deleting when remote file management is on.
9. System events: the paginated event list.
10. System options: the redacted config, and the YAML editor when remote configuration is on.
11. The rest of the shell: upload and download speeds and counts, the slskd version, and light theme with a toggle.

After that:

- Proper responsiveness.
- Keyboard handling: ↵ into a folder and ⌫ up in Browse, `/` to focus a filter, `d` to download, `?` for the keys.
  Weigh `@headless-tree` for Browse's tree then, since it brings an ARIA tree with keys.
- Filter criteria (quality, size) for Browse.
