# Build plan

An alternative web UI for slskd, shipped as a drop-in replacement for its `wwwroot` and run against
stock slskd. `../slskd` is read-only. We reimplement the stock UI's functionality one piece at a time.
Backend behaviour we rely on is in [slskd-facts.md](slskd-facts.md).

Stack (fixed): React, strict TypeScript, Vite, Radix Themes, ky, `@microsoft/signalr`, TanStack Table v9,
TanStack Virtual v3, TanStack Router. Each dependency is added in the phase that first uses it.

## Dev setup

- `nix develop` (or direnv) provides dotnet-sdk_10, nodejs_24, pnpm, jq and curl.
- `dev/slskd build | start|restart [--dist] [slskd args...] | stop | log` manages a dev slskd built from
  `../slskd`. Build output, app dir and logs live in `.dev/`, and `../slskd` itself stays untouched. The config
  is `dev/slskd.yml`: `no_connect`, url_base `/slskd`, login `slskd`/`slskd`. Extra args go to slskd, so
  `dev/slskd restart --no-auth` runs an open instance.
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

### Storage

- We share an origin with stock, so everything we persist is prefixed `slskd-alt`: the localStorage key
  `slskd-alt-token`, and the IndexedDB database `slskd-alt`.

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

- `session.ts` is a module-level store (`checking | unreachable | open | anonymous | authenticated`) read
  through `useSyncExternalStore`, so the HTTP client and hubs can use it outside React. `<SessionGate>`
  renders the login form, a spinner (only after 300 ms) or "Can't reach slskd" in place of the app at whatever URL
  you're on. There's no login route, so deep links survive.
- Boot sends `GET /session/enabled` and, if a token is stored, `GET /session` with it, in parallel. The
  outcomes:
  - Auth disabled: the instance is open, and a stored token is ignored.
  - No token: login.
  - 200: straight into the app.
  - 401: drop the token and show login with "Your session ended".
  - A network error or 5xx on either: "Can't reach slskd", which retries itself after 1 s, 2 s, then
    every 5 s, and has a "Retry now" button.
- The token is a bare string in localStorage (never stock's `slskd-token`). There's no remember-me and
  no handling of `expires`. Tabs mirror it through `storage` events: a new token lets every tab in, and
  removing it sends every tab to login.
- **A 401 ends the session only if the request carried the current token.** That one rule is the
  latch and suppresses the burst, including late 401s from before a re-login.
  - Ending deletes the stored token only if it's still the one that got the 401, so a stale tab can't
    wipe a newer token.
  - The app unmounts, so polls and hubs stop through their reference counts.
  - `/session/enabled` is re-checked, because auth may have been toggled across a restart.
  - With no current token, the client rejects requests without sending them.
  - `POST /session` is exempt.
- Logout is local only, because slskd can't revoke tokens.
- Hubs retry forever: after 0, 1 and 2 s, then every 5 s, and that includes the initial `start()`.
  Every retry decision fires a `GET /session` probe. SignalR treats a negotiate 401 as an ordinary
  failure, and a single probe on drop would hit a slskd that is still down. After a restart the session
  ends within about 1 s of slskd coming back.
- Hubs are reference-counted by `useHub` subscribers and stop 2 s after the last one leaves. They stay
  connected in hidden tabs.
- Accepted gaps:
  - A token that expires while its hub stays up looks logged in until the next REST call.
  - If auth is turned off across a restart, the tab stays "logged in" until it's reloaded.

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
2. **Login and session.** *Done:* the session gate, login and logout, open instances, tab sync, the
   token-scoped 401 latch, and the application hub with retry-forever probing. A placeholder page shows
   the session mode, hub state and `server.state`. We checked these in headless Chromium against both
   `pnpm dev` and the `--dist` build:
   - login errors
   - a reload with no login flash
   - a restart landing on login with the URL preserved
   - two tabs gating and un-gating together
   - unreachable slskd
   - `--no-auth` in both directions

   Under `--dist`, slskd serves the page itself, so the unreachable check there is a login attempt
   while slskd is down.
3. **App shell and router.** Nav for searches, downloads, uploads and browse. A transfer count badge from
   MetricsHub `Update` (downloads in progress + queued files). A theme menu for Radix appearance. The application hub
   provides server state, and the live store's first real consumers land here.
4. **Transfers**, downloads first and then uploads. The live store and the grid get built for real here
   (TanStack Table + Virtual, the mutability split, and cost-floored polling). Enqueue through the batches endpoint.
5. **Search.** Design it as we go. Responses only arrive once a search finishes, while the hub pushes the
   metadata live. Stock's filter syntax (`minbr:`, `isvbr`, include/exclude terms) is worth porting eventually.
6. **Browse.** A tree pane plus a folder grid, with subfolders listed at the top of the grid, ↵ to go in and
   ⌫ to go up, and a filter that flattens to matching files across the whole share. Share trees are
   cached in the `slskd-alt` IndexedDB database, and each shows when it was fetched.

Later: dashboard, rooms, chat, users, then the config editor.
