# slskd backend facts

Verified against slskd `e3d377d4` (2026-09-20). Most items come from reading the source; the
build-contract items were also confirmed against a running instance. Paths are relative to
`../slskd/src/slskd`, and line numbers drift over time.

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
  - application hub: `STATE` on every change, and `OPTIONS` (redacted)
  - search hub: `CREATE`/`UPDATE`/`DELETE` with `responses: null`. A `RESPONSE` method is declared but never sent.
  - logs hub: `BUFFER` on connect, then `LOG`
  - metrics hub: `Update` every ~1 s, carrying aggregate transfer metrics. It's cheap and suits a badge:
    `{ downloads: { inProgress: {files, users, averageSpeed, totalSpeed}, queued: {files, users, bytes}, completed: {succeeded, failed, bytes} }, uploads: <same> }`.
    All values are doubles and are process-lifetime counters that reset on restart. There's nothing per-transfer.
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
- An instance can have no auth: `web.authentication.disabled: true`, or `--no-auth`. Then
  `GET /session/enabled` returns `false` and every request is Administrator. `POST /session` still
  validates credentials and returns a JWT that's useless.
- Hub connections authenticate with `Authorization: Bearer` on negotiate and `access_token` on the WebSocket. An
  unauthenticated negotiate gets 401. An open hub connection survives token invalidation, and only the
  next reconnect's negotiate gets 401.
- Stock UI stores the token under `slskd-token` (sessionStorage, or localStorage with "remember me"), and stores `'n/a'` when
  auth is disabled. Any 401 outside `/session`, `/server` and `/application` clears it and reloads.

## Soulseek server connection

- `STATE.server` (application hub) and `GET /server` give
  `{address, ipEndPoint, state ("Connected, LoggedIn"), isConnected, isConnecting, isLoggedIn, isLoggingIn, isTransitioning}`.
  `STATE` also has `connectionWatchdog` and `pendingReconnect`. `PUT /server` connects and `DELETE /server` disconnects.

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
