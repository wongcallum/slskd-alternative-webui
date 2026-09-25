# slskd alternative web UI

An alternative web UI for [slskd](https://github.com/slskd/slskd), run against stock slskd as a drop-in
replacement for its `wwwroot`. It covers Search, Downloads, Uploads and Browse so far.

Build it with `pnpm build` and serve `dist` as slskd's `web.content_path`. The path must be relative to the slskd
binary's directory.

How it works is in [docs/design.md](docs/design.md), and verified behaviour of slskd and our libraries is in
[docs/facts.md](docs/facts.md).

## Roadmap

What's left of the stock UI, in order:

1. Dashboard. Once it exists, decide whether `/` redirects there instead of `/searches`.
2. Rooms
3. Chat
4. Users
5. Config editor

After that:

- Proper responsiveness.
- Keyboard handling: ↵ into a folder and ⌫ up in Browse, `/` to focus a filter, `d` to download, `?` for the keys.
  Weigh `@headless-tree` for Browse's tree then, since it brings an ARIA tree with keys.
- Filter criteria (quality, size) for Browse.
