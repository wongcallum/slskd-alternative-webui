# Verified facts

What slskd and our libraries actually do. Each library section names the version it was checked against.
The slskd sections are verified against slskd `e3d377d4` (2026-09-20). Most of those items come from
reading the source; the build-contract items were also confirmed against a running instance. slskd paths
are relative to `../slskd/src/slskd`, and line numbers drift over time.

## API surface

- REST is at `/api/v0/*`. Every action is `[Authorize]` except `GET /session/enabled` (bare
  `true`/`false`) and `POST /session`. `/health` is also open.
- The UI hubs are `/hub/{application,logs,search,metrics}`. They broadcast to all clients (there are no
  groups), and each one sends a snapshot to a client when it connects. `/hub/relay` is for relay agents
  and isn't for the UI.
- **There is no transfers hub**, and there's no ETag, `If-None-Match` or `since` param anywhere. The
  transfer list endpoints have no pagination, and their only filter is `includeRemoved`.
  `GET /transfers/downloads` returns every non-removed download every time (3.5 MiB on a heavily
  loaded instance). Stock polls it at 1 Hz per tab while the Downloads/Uploads page is mounted
  (`web/src/components/Transfers/Transfers.jsx:36`). Under load, stock saturates the main thread,
  starves the SignalR keepalive and shows "Lost connection". Avoiding that is the main reason this
  project exists. (Events and telemetry reports do paginate with `offset`/`limit`, but they're irrelevant here.)
- Pushed:
  - application hub: `STATE` on every change, and `OPTIONS` (redacted). See [Application hub](#application-hub).
  - search hub: `CREATE`/`UPDATE`/`DELETE` with `responses: null`. A `RESPONSE` method is declared but never sent.
  - logs hub: `BUFFER` on connect, then `LOG`
  - metrics hub: `Update` every second, carrying aggregate transfer counts. See [Metrics hub](#metrics-hub).
- Poll-only: transfers, browse, search response bodies, rooms and conversations.
- REST JSON omits nulls (`WhenWritingNull`, `Program.cs:981`), but hub payloads keep them. Both use
  camelCase and string enums.

## Transfers

- The list shape is `[{ username, directories: [{ directory, fileCount, files: Transfer[] }] }]`,
  grouped by user and then by remote directory, in no particular order. A `Transfer` has `id, batchId?,
  username, direction, filename (full remote path), size, state, requestedAt, enqueuedAt?, startedAt?,
  endedAt?, bytesTransferred, averageSpeed, placeInQueue?, exception?, attempts, nextAttemptAt?,
  removed`, plus the computed `bytesRemaining, percentComplete, elapsedTime?, remainingTime?`.
- `state` is a flags enum serialised like `"Completed, Succeeded"` or `"Queued, Locally"`. Terminal
  states are `Completed, Succeeded|Cancelled|TimedOut|Errored|Rejected|Aborted`. `Completed`
  means "this attempt ended". It doesn't mean success, and **it isn't guaranteed final**:
  - Download auto-retry (default 3 attempts, 5 s backoff capped at 60 s) writes
    `Completed, Errored`. Milliseconds later it writes `Queued, Locally` **under the same id**, with
    `attempts` incremented and `startedAt/endedAt/bytesTransferred/averageSpeed/exception/placeInQueue`
    reset. Cancellation, rejection, duplicate transfers and size mismatches are not retried.
  - A failure before Soulseek reports any state flips the state
    `Completed, Errored` → `Queued, Locally` → `Completed, Errored` within milliseconds. Examples are
    enqueueing while disconnected or cancelling during a retry backoff. This affects downloads and uploads.
  - If moving the file after a download fails, the state stays `Completed, Succeeded` but the record gains an `exception`.
  - Small race windows can bump `bytesTransferred`/`averageSpeed` after `Completed`, or un-remove a record.
  - These fields never change: `id, batchId, username, direction, filename, size, requestedAt`.
    `nextAttemptAt` is declared but never set.
- Removal is a soft delete (`removed: true`), and lists exclude removed records unless `?includeRemoved=true`.
  Re-enqueueing a file marks the old record removed and creates a **new id**. Clear-completed and retention
  pruning also remove records. `DELETE …?remove=true` only removes transfers that are already `Completed`;
  on an active transfer it just cancels.
- At startup, unfinished transfers become `Completed, Errored`. After login they're re-enqueued under
  new ids and the old records are removed.
- Batches: `POST /transfers/downloads/batches` returns `{batch, failures}` with 201 (all enqueued),
  207 (partial) or 200 (none enqueued). It returns 409 for a duplicate id and 429 while another enqueue
  is running. The per-user `POST /transfers/downloads/{username}` is `[Obsolete]`.

## Auth

- Auth is JWT, and there is **no refresh endpoint**. `web.authentication.jwt.key` defaults to random bytes per
  process, so **every slskd restart invalidates every token**. That's the common expiry case, not the
  7-day TTL (which also has 5 minutes of clock skew).
- Browser logins (`POST /session`) always get the Administrator role, so there's no role-gated UI. The response is
  `{token, tokenType, expires, issued, notBefore, name}`. API keys (`X-API-Key`) also exist but aren't for browsers.
- `POST /session` returns 401 with an empty body for wrong credentials, and 400 with a JSON string
  (`"Username and/or Password missing or invalid"`) for missing or blank fields. The comparison is exact
  and case-sensitive. There's no rate limit, lockout or delay on failures (`SessionController.cs`).
- `GET /session` is `[Authorize]` (JWT or API key) and returns 200 with an empty body and no side effects,
  which makes it the cheapest session probe. There's no `DELETE /session` and no revocation: JWTs are
  stateless, so logout is client-side only.
- 401 bodies are always empty. A bad or stale token gets `WWW-Authenticate: Bearer error="invalid_token"`.
  A browser JWT never gets a 403 from role checks, only from explicit `Forbid()` calls (relay agent
  mode, remote configuration or file management disabled).
- An instance can have no auth: `web.authentication.disabled: true`, or `--no-auth`. Then
  `GET /session/enabled` returns `false` and every request is Administrator. `POST /session` still
  validates credentials and returns a JWT that's useless. JwtBearer isn't registered in that mode, so a
  stale or bogus `Bearer` header (or hub `access_token`) is ignored and the request succeeds (`Program.cs:932`).
- Hub connections authenticate with `Authorization: Bearer` on negotiate and `access_token` on the WebSocket. An
  unauthenticated negotiate gets 401. An open hub connection survives token invalidation, and only the
  next reconnect's negotiate gets 401.
- Stock UI stores the token under `slskd-token` (sessionStorage, or localStorage with "remember me"), and stores `'n/a'` when
  auth is disabled. Any 401 outside `/session`, `/server` and `/application` clears it and reloads.
  The `/server` and `/application` exemptions are leftovers: they fixed redirect loops in 2021 (8b1f5d46,
  70b14335), when stock polled those endpoints before login. Stock no longer calls either.

## Shutdown

- Observed in phase 2: while a hub WebSocket was connected, SIGTERM made slskd log "Application is shutting
  down" and "Client stopped" and then hang instead of exiting. `dev/slskd stop` kills it after 10 s.
- Observed in phase 3, with no Soulseek credentials configured: it exited in 0.3 s with both hubs connected.
  What triggers the hang is unknown.

## Application hub

- On connect the caller gets `STATE` and then `OPTIONS` (`Core/API/Hubs/ApplicationHub.cs:92`). The method
  names are uppercase, and the JS client matches them case-insensitively.
- `STATE` is the whole `State` record (`Core/State.cs`), pushed in full to every client on **every** update, with
  no debounce and no check that anything changed (`Common/ManagedState.cs:198`, `Application.cs:1913`). That
  includes share-scan progress in 1% steps, and `health`, which updates every 30 s, so a push arrives at least
  every 30 s. `GET /application` returns the same object with nulls omitted.
- Top-level keys: `version {full, current, latest, isUpdateAvailable, isCanary, isDevelopment}`,
  `pendingReconnect`, `pendingRestart`, `server`, `connectionWatchdog {isEnabled, isAttemptingConnection,
  isAwaitingVpn, nextAttemptAt}`, `vpn`, `relay`, `health`, `user {username, privileges, statistics}`,
  `distributedNetwork`, `shares {scanPending, scanning, ready, faulted, cancelled, scanProgress, hosts,
  directories, files}`, `rooms` and `users`. `users` is never populated.
- `user.username` is updated on every Soulseek client state change. `pendingReconnect` is set when an option
  that needs a reconnect changes while connected, and any disconnect clears it. `pendingRestart` stays set
  until a restart. `version.latest` and `isUpdateAvailable` stay null on dev and canary builds and with
  `no_version_check`.
- `OPTIONS` is the whole options object with every secret replaced by `"*****"`. It's pushed on connect and
  after each options change that actually differs.

## Metrics hub

- `Update` goes to every client every second whether or not anything changed
  (`Telemetry/TelemetryService.cs:51`), and to the caller on connect (`Telemetry/API/MetricsHub.cs:56`):
  `{ downloads: { inProgress: {files, users, averageSpeed, totalSpeed}, queued: {files, users, bytes}, completed: {succeeded, failed, bytes} }, uploads: <same> }`.
  Every value is a JSON number. There's nothing per-transfer.
- `completed.*` are counters since the process started. Everything else is a gauge, and all of it starts at 0
  after a restart. Startup's "Application shut down" errors don't count as failed.
- The gauges are recounted every 5 s from Soulseek.NET's in-memory transfer list (`Client.Downloads` /
  `Client.Uploads`), not from the database (`Transfers/Downloads/DownloadService.cs:1101`,
  `Transfers/Uploads/UploadService.cs:1032`). Queued is any state with the `Queued` flag, and in progress is
  exactly `InProgress`. Between recounts, each state transition adjusts the gauges using different groups
  (`Transfers/Types/TransferStateCategories.cs`: queued also includes `Requested`, in progress also includes
  `Initializing`). Those adjustments don't stop at zero, so a gauge can dip negative until the next recount.
- **So `inProgress.files + queued.files` doesn't match the unfinished rows of `GET /transfers/downloads`.**
  Rows are written as `Queued, Locally` straight away but reach Soulseek.NET through an enqueue limiter:
  every file at once for requests of 30 or fewer, otherwise 5 at a time, each slot held until its file is
  `Queued, Remotely` (`DownloadService.cs:417-538`). Rows waiting out a retry backoff also show
  `Queued, Locally` without being in `Client.Downloads`. Uploads come closer, because they enter Soulseek.NET
  immediately.
- Observed with a 41-file batch from one peer: the sum read 0 while the list had 41 unfinished rows, and caught
  up about 10 s later, once every file was `Queued, Remotely`. While files downloaded it ran 1–4 below the list,
  and `inProgress.files` dipped to -2. Each file was `InProgress` for only a few seconds, so `inProgress.files`
  mostly read 0. While nothing moved, the two matched exactly.

## Soulseek server connection

- `STATE.server` (application hub) and `GET /server` give
  `{address, ipEndPoint, state ("Connected, LoggedIn"), isConnected, isConnecting, isLoggedIn, isLoggingIn, isTransitioning}`.
  `state` is `"None"` until the first client event, `isConnected` is already true during `Connected, LoggingIn`,
  and `GET /server` omits `address` and `ipEndPoint` while disconnected. The Soulseek username is only in
  `STATE.user.username`.
- `connectionWatchdog.nextAttemptAt` (UTC) is set while the watchdog is attempting or waiting to retry.
- `PUT /server` returns without waiting; progress arrives through `STATE`. If the watchdog is enabled it
  restarts the retry loop and returns 205, otherwise it starts it and returns 200 (`Core/API/Controllers/ServerController.cs:74`).
  It ignores `no_connect` and doesn't check credentials. They're read at each attempt, and a missing username
  fails the attempt, which then retries forever with backoff from 1 s up to 5 min (`Core/ConnectionWatchdog.cs:280`).
  Observed: each such attempt logs "Username may not be null or an empty string" and opens no socket to the
  Soulseek server.
- **Never `PUT` while connected.** The attempt exits at once but leaves the watchdog enabled, so the next
  `PUT` gets 205. From reading the code (untested), each 100 ms watchdog tick then rewrites
  `connectionWatchdog`, pushing `STATE` about 10 times a second until a `DELETE`.
- `DELETE /server` stops the watchdog, aborts any attempt and, if connected, disconnects intentionally, so
  there's no auto-reconnect. It always returns 204. The optional body is a JSON string used as the disconnect
  message (stock sends `"client disconnected from web UI"`).
- The controller only accepts `application/json`, and returns 403 in relay agent mode.

## Serving the UI (build contract)

- slskd serves `web.content_path` (default `wwwroot`). **The path must be relative to the slskd binary's
  directory** (`AppContext.BaseDirectory`); an absolute path fails validation at startup.
  `dev/slskd start --dist` computes the relative path.
- For a GET that returns 200, slskd checks the `Accept` header: split on commas, it must contain an exact
  `text/html` token. If it does, slskd:
  - regex-rewrites `./static` and `/static` to `{urlBase}/static`, and `./favicon.ico` and
    `/favicon.ico` to `{urlBase}/favicon.ico`, across the **whole** HTML body, inline scripts included
  - appends `<script>window.urlBase="/slskd";window.port=5030</script>` **after `</html>`**
- So Vite needs `base: './'` and `build.assetsDir: 'static'`. Read `window.urlBase` at runtime and only
  from module/deferred code (never bake it in). Never use `window.port`, which is the HTTP port even
  over HTTPS. `window.urlBase` is `"/"` at root and otherwise has no trailing slash (`"/slskd"`).
  Nothing else in `dist` gets rewritten.
- Browsers match the `Accept` check. `curl` defaults to `*/*` and gets the raw file, so scripted checks must
  send `-H 'Accept: text/html'`. `application/json, text/html` (note the space) doesn't match either.
- SPA deep links work, but **only for paths without a file extension**. If the last segment contains a
  dot (`/browse/foo.bar`) the response is 404. Unmatched `/api/*` returns an empty 404. `index.html` is sent
  with `Cache-Control: no-cache`.
- A non-root `url_base` is additive: slskd answers at both `/api/...` and `/slskd/api/...`. At root,
  `GET /slskd/api/...` returns the SPA HTML with a 200 (other methods get 404), so a hardcoded path can hide.

## Search

- `GET /searches/{id}/responses` (or `GET /searches/{id}?includeResponses=true`) returns
  `[{username, fileCount, files, lockedFileCount, lockedFiles, hasFreeUploadSlot, queueLength, uploadSpeed, token}]`,
  **but only after the search finishes. While it's running, the endpoint returns `[]`.**
- `POST /searches {searchText}` while not logged in to Soulseek returns 409 with a JSON string, but the search
  is still stored, as `Completed, Errored` with no responses (observed).
- Once logged in, other peers' searches arrive constantly. If no share scan has ever run (`no_share_scan`), each
  one logs a `no such table: filenames` warning, about 3,600 in the first two minutes (observed).
- Searches persist across restarts in SQLite. Any that were running become `Completed, TimedOut` with zero
  counts. `retention.search` prunes old searches.

## Browse

- `GET /users/{u}/browse` is always a fresh network request for the peer's **entire** share (the server
  has no cache) and returns `{directories, lockedDirectories}`. Progress comes from
  `GET /users/{u}/browse/status` (stock polls every 500 ms). The protocol can't list folders lazily.
- `POST /users/{u}/directory {directory}` returns the peer's listing for that directory. Stock uses
  only element `[0]`. That its shape depends on the peer's client is Soulseek protocol behaviour, which
  can't be verified from slskd's source.
- Stock caches browse results in IndexedDB (`slskd-browse` / `browse`) and `localStorage['slskd-browse-state']`.
  We share an origin with stock, so use different names.

## Stock UI

Paths are relative to `../slskd/src/web/src`.

- Routes, all under `urlBase` (`components/App.jsx:582`): `/dashboard`, `/searches/:id?`, `/browse`, `/users`,
  `/chat`, `/rooms`, `/uploads`, `/downloads` and `/system/:tab?` (`info`, `options`, `shares`, `files`, `data`,
  `events`, `logs`). Everything else, `/` included, redirects to `/dashboard`. Browse and users take their
  user from router state or localStorage, not the URL.
- The nav's connection item disconnects on a single click with no confirmation, and connects on a click while
  disconnected. There are no count badges; the footer shows transfer counts from the metrics hub.
- Theme: localStorage `slskd-theme` (`dark`/`light`), falling back to `prefers-color-scheme`. It never sets
  `document.title`.

## Config

- Sources layer defaults < env vars (`SLSKD_` prefix) < YAML < CLI (`Program.cs:1466`), so an env var can't
  override a value the YAML sets.
- Names used here: `--url-base`/`SLSKD_URL_BASE` (default `/`), `--slsk-username`/`SLSKD_SLSK_USERNAME`,
  `--slsk-password`/`SLSKD_SLSK_PASSWORD`, `--no-connect`/`SLSKD_NO_CONNECT` and `-X`/`--no-auth`. A bool
  flag given without a value means true.
- Startup doesn't connect to Soulseek when `no_connect` is set or the credentials are missing.

## OpenAPI

- Swagger is off unless `--swagger` (or `feature.swagger`) is set, and then it's at `/swagger/v0/swagger.json`.
- It's a poor source for generated types. Many endpoints, the transfer lists included, declare no response
  type, and the hubs aren't described. Swashbuckle also lists flag enums by single flag name, so combined
  values like `"Queued, Locally"` wouldn't fit a generated union (not checked against a generated document).

## SignalR client

Read from the `@microsoft/signalr` 10.0.11 package source (paths are under its `src/`).

- `withAutomaticReconnect()` retries after 0, 2, 10 and 30 s, then gives up and fires `onclose(undefined)`.
  A failed initial `start()` is never retried (`DefaultReconnectPolicy.ts`, `HubConnection.ts`).
- A 401 on negotiate is just another failed attempt. It's re-wrapped as a non-exported
  `FailedToNegotiateWithServerError` with no `statusCode`, so only the message (`Status code '401'`)
  shows it. The reconnect loop carries on under the retry policy (`HttpConnection.ts`).
- A custom `IRetryPolicy` is called once when the connection drops and after every failed attempt.
  `retryReason` is the most recent failure. Returning `null` stops and fires `onclose`.
- `onreconnecting` fires as soon as the WebSocket closes, which a dying server does.
  `serverTimeoutInMilliseconds` (30 s) only covers silent drops. So the first probe after a drop hits a
  slskd that is still shutting down.
- `accessTokenFactory` runs for every negotiate and every WebSocket connect. Browsers put the token in
  the `access_token` query param. An empty string sends no token.
- `stop()` during a pending `start()` rejects it with an `AbortError` and doesn't fire `onclose`.
  During a reconnect it fires `onclose(undefined)`.
- If the WebSocket fails, the client falls back to SSE and then long polling, negotiating afresh each
  time. Observed against slskd: it stays on WebSockets across restarts.

## TanStack Router

Checked against `@tanstack/react-router` 1.170.38–39 (package source, docs at `ddad69a`, and a throwaway app
in headless Chromium).

- `basepath` is still the option (since 2025 it's built on the `rewrite` API). `"/"` adds nothing. With
  `"/slskd"`, `<Link>` hrefs include the base, `useLocation().pathname` doesn't, and paths outside the base
  are not-found. An incoming trailing slash (`/slskd/searches/`) still matches.
- **Remounting `<RouterProvider>` can render a stale page.** If the URL changes while no provider is mounted
  (Back/Forward, `history.push`), the remounted router keeps the old match: on mount it only loads when
  `router._tx` is unset, and after the first load it never is (`Transitioner.js`). `router.navigate()` with
  no provider mounted returns a promise that only resolves once one mounts (#8125).
- **With no `errorComponent` on a route and no `defaultErrorComponent`, there's no route error boundary.** A
  render error replaces the whole app, although the docs say it defaults to `ErrorComponent`.
- Search values are JSON by default. Plain strings pass through, but a string that parses as JSON gets quoted
  (`'123'` becomes `?user=%22123%22`), `?user=123` parses as the number 123, and on load the router rewrites
  the URL to match the validated value. `parseSearch`/`stringifySearch` built on `URLSearchParams` keep
  everything a plain string.
- `validateSearch` takes Standard Schema validators (Zod 4, Valibot, ArkType) directly. `@tanstack/zod-adapter`
  is only for Zod 3.
- `head` + `<HeadContent />` sets `document.title` in a client-only SPA. The title goes in
  `meta: [{ title }]`, and the deepest match wins.
- A redirect thrown from `beforeLoad` replaces the history entry.
- `useMatchRoute()` defaults to `fuzzy: false`. `<Link>` `activeOptions` default to a segment-prefix match
  with `includeSearch: true`.
- Unmatched paths render `defaultNotFoundComponent` or the nearest route's `notFoundComponent`
  (`notFoundMode: 'fuzzy'`); leaf routes can't handle not-found. Without either you get `<p>Not Found</p>`.
- Preloading and scroll restoration are off by default, but `window` scrolls to the top on navigation.

## Radix Themes

Checked against the `@radix-ui/themes` 3.3.0 package source.

- `appearance` is `'inherit' | 'light' | 'dark'`. There's no system mode, and no Radix CSS uses
  `prefers-color-scheme`. `inherit` with no `.dark` ancestor is light.
- An explicit appearance puts `light`/`dark` on the `Theme` element and sets `color-scheme` on `:root` through
  `:has([data-is-root-theme='true'])`, so only once React has rendered. Portalled content (menus, tooltips,
  popovers, dialogs) is wrapped in a nested `Theme` and inherits the appearance.
- `TabNav.Link asChild active` is the documented way to render router links. `active` sets `data-active` and
  `aria-current="page"`. The child's children are wrapped in inner spans and **the label renders twice** (once
  hidden, to reserve its bold width), so keep stateful components and `id`s out of it. A `Badge` inside works
  but needs its own margin.
- The root `Theme` provides a `Tooltip.Provider` with a 200 ms delay.
- next-themes 0.4.6, which the Radix docs recommend, is mostly unmaintained. Its anti-flash script does nothing
  when rendered client-side only (React 19 doesn't run rendered `<script>`s) and logs a warning in dev.
