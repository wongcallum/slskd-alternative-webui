# Build plan

An alternative web UI for slskd, shipped as a drop-in replacement for its `wwwroot` and run against
stock slskd. `../slskd` is read-only. We reimplement the stock UI's functionality one piece at a time.
Verified behaviour of slskd and the libraries we rely on is in [facts.md](facts.md).

Stack (fixed): React, strict TypeScript, Vite, Radix Themes, ky, `@microsoft/signalr`, TanStack Table v9,
TanStack Virtual v3, TanStack Router. Each dependency is added in the phase that first uses it.

## Dev setup

- `nix develop` (or direnv) provides dotnet-sdk_10, nodejs_24, pnpm, jq, curl and chromium.
- Browser checks: write a throwaway script in `.dev/` using `playwright-core` with
  `chromium.launch({ executablePath: process.env.CHROMIUM })`, save screenshots to `.dev/` and view them. Headless
  works without a GPU and needs no extra flags. The devShell also sets `$CHROMIUM` and a `FONTCONFIG_FILE` with DejaVu fonts. Without that
  font config, pages render blank or in a serif font. If `$CHROMIUM` is unset, the shell predates the flake change, so
  run the script under `nix develop -c`. Never run `playwright install`: its downloaded browsers break on Nix setups.
- `dev/slskd build | start|restart [--dist] [slskd args...] | stop | log` manages a dev slskd built from
  `../slskd`. Build output, app dir and logs live in `.dev/`, and `../slskd` itself stays untouched. The config
  is `dev/slskd.yml`: `no_connect`, url_base `/slskd`, login `slskd`/`slskd`, and no Soulseek credentials.
  Extra args go to slskd, so `dev/slskd restart --no-auth` runs an open instance and
  `dev/slskd restart --dist --url-base /` runs at root.
- Real Soulseek account: `.dev/soulseek.env` (gitignored) exports `SLSKD_SLSK_USERNAME` and
  `SLSKD_SLSK_PASSWORD`, and `dev/slskd` loads it. `no_connect` stays on, so slskd only connects when you press
  Connect in the Soulseek popover. Without the file, Connect fails inside slskd and retries forever without
  touching the network.
- Real downloads: `dev/enqueue search <text...>` runs a search and lists the folders found, and
  `dev/enqueue pick <n>` batch-enqueues one. Both are deliberate Soulseek actions. Never write a fake backend.
- Dev: run `pnpm dev` (`--host` to reach it through VS Code port forwarding) and open
  `http://localhost:5173/slskd/`. Vite proxies `/slskd/api` and `/slskd/hub` (with WebSocket upgrade) to slskd
  on `:5030`. It also injects `window.urlBase` itself, since slskd isn't serving the HTML. VS Code's forward
  carries WebSockets fine. Once, Firefox stopped opening WebSockets to the forwarded port (live reload failed and
  the hubs fell back to SSE after about 40 s each) until it was restarted. Its requests never reached Vite.
- Real build: `pnpm build && dev/slskd restart --dist`, then open `http://localhost:5030/slskd/`.
  Scripted checks must send `-H 'Accept: text/html'`.

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

- Each resource is its own module built with `createResource` (`store.ts`) and read through `useResource`, a
  `useSyncExternalStore` hook. It starts its sources for the first subscriber and stops them after the last.
- **An update equal to the current data keeps the old snapshot and notifies nobody.** Hub payloads are mapped
  at ingestion to flat objects holding only the fields we read, so a shallow compare is enough. The snapshot
  is the data plus the last error. `updatedAt` is read separately, and `useFreshness` re-renders on its own
  1 s clock only where freshness is shown, so identical pushes and polls cost nothing.
- There's one poll loop per resource, reference-counted by subscribers. A hidden tab skips ticks and polls
  as soon as it's visible again.
- The poll interval is floored at a multiple of the last tick's measured cost, so we can't out-poll
  the main thread the way stock does (phase 4).
- A failed tick keeps the last good data and never blanks the screen.
- Hub pushes (application `STATE`, search metadata, metrics) feed the same store. The hubs use
  `@microsoft/signalr`.
- Soulseek server state is one resource: `STATE` while the application hub is connected, otherwise
  `GET /server` every 2 s, including during the initial connect.
- Payload types are hand-written and cover only the fields we read. OpenAPI is a poor source (see the facts).

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
- Hubs are reference-counted by their subscribers (`useHub` and the resources listening to them) and stop
  2 s after the last one leaves. They stay connected in hidden tabs.
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

- **The router is always mounted.** Its root route renders `<SessionGate><Shell /></SessionGate>`, so the
  shell, pages, polls and hubs unmount when the session ends while the router keeps following the URL.
  Remounting `<RouterProvider>` can render a stale page (see the facts).
- Paths match stock's: `/searches`, `/downloads`, `/uploads` and `/browse`. `/` redirects to `/searches` from
  `beforeLoad`, replacing the history entry.
- Search params are plain strings (`URLSearchParams` both ways), and routes parse numbers in `validateSearch`.
  The validation library is picked when the first search param lands.
- Not-found and crash pages (`defaultErrorComponent`) render inside the shell, so the nav survives.
- Titles come from `head` + `<HeadContent />`: "Downloads · slskd". Only unmatched paths keep the root
  route's "Page not found · slskd".
- No router devtools, code splitting or scroll restoration.

### Shell

- A top bar, desktop-first: on narrow screens it scrolls sideways and the page never overflows. Dark only
  (`appearance="dark"`, plus a `color-scheme` meta tag so the page is dark before the JS loads).
- Tabs: Search · Downloads · Uploads · Browse, active on a prefix match.
- The Downloads badge is an **approximate** count of unfinished downloads from the metrics hub
  (`inProgress.files + queued.files`, each clamped at 0). It's hidden at zero, gray while the metrics hub is
  down, and its tooltip says "About N downloads unfinished". slskd's gauges trail the list by a few seconds
  and by up to a whole batch while it's being enqueued (see the facts), so exact counts belong to the
  Downloads toolbar.
- The Soulseek indicator shows unknown / connected as the user / connecting / retrying at a time /
  disconnected. Its popover has the server address, the data source and its age, the last poll error, a
  `pendingReconnect` note, and Connect, Retry now + Stop trying, or Disconnect. Connect is only offered while
  disconnected, because `PUT /server` while connected leaves slskd's retry timer running.
- Hub health has no indicator of its own in the bar, since two status dots side by side looked wrong. The
  Soulseek popover lists each hub with its retry count. At a glance, the badge grays while the metrics hub is
  down, and the popover's source line reads "hub down, polling" while the application hub is.
- Log out has no confirmation and is hidden on open instances.

### Health

- Show freshness in each surface's own toolbar ("updated 12s ago"). It turns amber once the data is older than
  `min(3 × interval, 20s)`. No global banners or toasts.
- Keep three things separate and never collapse them into one "connected" flag: REST poll health, hub
  health, and slskd's own connection to the Soulseek server.
- Actions disable via `aria-disabled` and give a reason:
  - Every action is gated on REST poll health. The shell has no poll of its own, so its actions are gated
    on the Soulseek server state being known: the hub is connected and has sent `STATE`, or the last
    `GET /server` succeeded within the amber threshold.
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
3. **App shell and router.** *Done:* the router, the shell with placeholder pages, the live store's core with
   its first resources (Soulseek server state and the metrics badge), and Soulseek connect/disconnect. We
   checked these in headless Chromium against both `pnpm dev` and the `--dist` build:
   - tabs, deep links, reloads, titles, the `/` redirect with Back, and not-found pages
   - Back/Forward while logged out, then logging in on the right page
   - no requests at all while logged out
   - an slskd outage on an open instance: hub retries, "unknown", disabled actions, and recovery
   - the popover's hub lines with the application hub blocked, and the indicator falling back to polling
   - the `/server` poll pausing in a hidden tab
   - Connect without credentials retrying, and Stop trying
   - a page crash inside the shell, and "Try again"
   - a dark page with JS disabled, and a narrow window
   - a root url_base (`--dist` only)

   With a real account we checked Connect and Disconnect, and compared the badge with the downloads list over
   a 41-file batch, which is what made the badge approximate.
4. **Transfers**, downloads first and then uploads. The live store and the grid get built for real here
   (TanStack Table + Virtual, the mutability split, and cost-floored polling). Enqueue through the batches
   endpoint. The Downloads toolbar shows exact counts from the list.
5. **Search.** Design it as we go. Responses only arrive once a search finishes, while the hub pushes the
   metadata live. Stock's filter syntax (`minbr:`, `isvbr`, include/exclude terms) is worth porting eventually.
6. **Browse.** A tree pane plus a folder grid, with subfolders listed at the top of the grid, ↵ to go in and
   ⌫ to go up, and a filter that flattens to matching files across the whole share. Share trees are
   cached in the `slskd-alt` IndexedDB database, and each shows when it was fetched.

Later: dashboard, rooms, chat, users, then the config editor. Once the dashboard exists, decide whether `/`
redirects there instead. After the plan: proper responsiveness.
