# Build plan

An alternative web UI for slskd, shipped as a drop-in replacement for its `wwwroot` and run against
stock slskd. `../slskd` is read-only. We reimplement the stock UI's functionality one piece at a time.
Backend behaviour we rely on is in [slskd-facts.md](slskd-facts.md).

Stack (fixed): React, strict TypeScript, Vite, Radix Themes, TanStack Table v9, TanStack Virtual v3,
TanStack Router. Each dependency is added in the phase that first uses it.

## Dev setup

- `nix develop` (or direnv) provides dotnet-sdk_10, nodejs_24, pnpm, jq and curl.
- `dev/slskd build | start [--dist] | stop | restart [--dist] | log` manages a dev slskd built from
  `../slskd`. Build output, app dir and logs live in `.dev/`, and `../slskd` itself stays untouched. The config
  is `dev/slskd.yml`: `no_connect`, url_base `/slskd`, login `slskd`/`slskd`.
- Dev: run `pnpm dev` and open `http://localhost:5173/slskd/`. Vite proxies `/slskd/api` and `/slskd/hub`
  (with WebSocket upgrade) to slskd on `:5030`. It also injects `window.urlBase` itself, since slskd isn't serving the HTML.
- Real build: `pnpm build && dev/slskd restart --dist`, then open `http://localhost:5030/slskd/`.
  Scripted checks must send `-H 'Accept: text/html'`.
- Search and browse return nothing while `no_connect` is on. When we get to them, turn it off and use a
  real Soulseek account. Never write a fake backend.

## Architecture

### Build and URLs

- `base: './'` and `build.assetsDir: 'static'` for builds; `base: '/slskd/'` in dev.
- Read `window.urlBase` at runtime (`"/"` means root), and never use `window.port`. Every REST and hub URL
  is built from it, so nothing hardcodes `/slskd`.
- slskd 404s a deep link whose last path segment contains a dot, so free-form values (usernames,
  folder paths, search text) go in search params or non-final segments.

### Live store

**One hand-rolled live store**, with no TanStack Query, SWR or RTK Query. This is a deliberate exception to
"prefer established dependencies". Those libraries either assume refetching is cheap (TanStack Query's
structural sharing deep-allocates over the whole payload every tick) or assume the server emits deltas.

- Consumers read the store through `useSyncExternalStore` hooks.
- There's one poll loop per resource, reference-counted by subscribers and paused while the tab is hidden.
- The poll interval is floored at a multiple of the last tick's measured cost, so we can't out-poll
  the main thread the way stock does.
- A failed tick keeps the last good data and never blanks the screen.
- Hub pushes (application `STATE`/`OPTIONS`, search metadata, metrics) feed the same store. The hubs use
  `@microsoft/signalr`.

### Array identity

**Array identity is load-bearing.** TanStack Table's core row model memoises on the identity of the `data`
array, and a fresh array means a full rebuild (~114 ms at 20k rows). So we **split transfers on
mutability**: active rows and terminal (`Completed, *`) rows live in separate arrays. Each poll is
merged into the existing arrays rather than replacing them.

Correction to the original premise: a terminal transfer *almost* never changes, but it can (auto-retry
reuses the id, failures flip states, and a failed move adds an `exception`; see the facts). So the merge
doesn't assume immutability. It compares each incoming row with the existing one on the fields that can
still change (`state, attempts, exception, endedAt, bytesTransferred, averageSpeed, placeInQueue`)
and reuses the old object when nothing changed. It returns a new array only when membership changed
(added, removed or superseded) or a row changed. A row that leaves `Completed` moves back to the active
array. In practice the terminal array's identity changes rarely, and a poll with no changes returns the
same arrays.

### Session

**Only a REST 401 ends the session.** Hub disconnects are connectivity signals only.

- Treat the first 401 as a one-way latch and ignore the burst that follows.
- When a hub drops, fire one REST probe so a restart is detected quickly. slskd restarts rotate the JWT
  key, so the probe 401s.
- `GET /session/enabled` decides whether a login is needed at all, because open instances exist.

### Soulseek actions

**Never trigger a Soulseek action automatically.** Browsing a user, searching, downloading and looking
up a user happen only on an explicit user gesture. They never happen on mount, navigation, reload or a timer.
That includes queue-position lookups and retries. Show stored results instead (slskd persists searches,
and we cache browsed share trees in IndexedDB), show when each result was fetched, and re-fetch only on request.

### Routing

**The router is a matcher.** TanStack Router provides typed paths and search params, with a code-based
route tree and `basepath` from `window.urlBase`. There are **no route loaders**: data comes from the store.

### Health

- Show freshness in each surface's own toolbar ("updated 12s ago"). It turns amber once the data is older than
  `min(3 × interval, 20s)`. No global banners or toasts.
- Keep three things separate and never collapse them into one "connected" flag: REST poll health, hub
  health, and slskd's own connection to the Soulseek server.
- Actions disable via `aria-disabled` and give a reason:
  - Every action is gated on REST poll health.
  - Actions that need Soulseek (search, browse, download, user lookup) are also gated on slskd being
    logged in to the Soulseek server (`server.isLoggedIn`). That state is pushed through `STATE`. While
    the application hub is down, poll `GET /server` so the gate never acts on stale state. In
    `no_connect` dev these actions are always disabled, which is expected.
  - Hub health never gates anything.

## Phases

1. **Scaffold with the build contract.** A "hello" page served by real slskd from `dist` at `/slskd/`,
   and working in Vite dev through the proxy. *Done:* the page shows `window.urlBase` and the result of
   `GET /session/enabled`. We checked HTML injection, the `/static` rewrite, deep links, the dotted-segment 404,
   the REST proxy, and the SignalR handshake plus `STATE`/`OPTIONS` over the proxied WebSocket.
2. **Login and session.** Cover open instances (`/session/enabled` is `false`) and the 401 latch across an
   slskd restart (`dev/slskd restart`). Decide token storage, including whether to share stock's `slskd-token`.
3. **App shell and router.** Nav for searches, downloads, uploads and browse. A transfer count badge from
   MetricsHub `Update` (downloads in progress + queued files). A theme menu for Radix appearance. The application hub
   provides server state, and the live store's first real consumers land here.
4. **Transfers**, downloads first and then uploads. The live store and the grid get built for real here
   (TanStack Table + Virtual, the mutability split, and cost-floored polling). Enqueue through the batches endpoint.
5. **Search.** Design it as we go. Responses only arrive once a search finishes, while the hub pushes the
   metadata live. Stock's filter syntax (`minbr:`, `isvbr`, include/exclude terms) is worth porting eventually.
6. **Browse.** A tree pane plus a folder grid, with subfolders listed at the top of the grid, ↵ to go in and
   ⌫ to go up, and a filter that flattens to matching files across the whole share. Share trees are
   cached in IndexedDB under our own database name, and each shows when it was fetched.

Later: dashboard, rooms, chat, users, then the config editor.
