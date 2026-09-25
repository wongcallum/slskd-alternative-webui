# Verified facts

What slskd and our libraries actually do. Each library section names the version it was checked against.
The slskd sections are verified against slskd `e3d377d4` (2026-09-20). Most of those items come from
reading the source; the build-contract items were also confirmed against a running instance. slskd paths
are relative to `slskd/src/slskd`, and line numbers drift over time.

## API surface

- REST is at `/api/v0/*`. Every action is `[Authorize]` except `GET /session/enabled` (bare
  `true`/`false`) and `POST /session`. `/health` is also open.
- The UI hubs are `/hub/{application,logs,search,metrics}`. They broadcast to all clients (there are no
  groups), and each one sends a snapshot to a client when it connects. `/hub/relay` is for relay agents
  and isn't for the UI.
- **There is no transfers hub**, and there's no ETag, `If-None-Match` or `since` param anywhere. The
  transfer list endpoints have no pagination, and their only filter is `includeRemoved`.
  `GET /transfers/downloads` returns every non-removed download every time, uncompressed (3.5 MiB on a heavily
  loaded instance). Stock polls it at 1 Hz per tab while the Downloads/Uploads page is mounted
  (`web/src/components/Transfers/Transfers.jsx:36`). Under load, stock saturates the main thread,
  starves the SignalR keepalive and shows "Lost connection". Avoiding that is the main reason this
  project exists. Events and telemetry reports do paginate with `offset`/`limit`.
- Pushed:
  - application hub: `STATE` on every change, and `OPTIONS` (redacted). See [Application hub](#application-hub).
  - search hub: `LIST` on connect, then `CREATE`/`UPDATE`/`DELETE` without responses. A `RESPONSE` method is
    declared but never sent. See [Search hub](#search-hub).
  - logs hub: `BUFFER` on connect, then `LOG`. See [Logs](#logs).
  - metrics hub: `Update` every second, carrying aggregate transfer counts. See [Metrics hub](#metrics-hub).
- Poll-only: transfers, browse, search response bodies, rooms, conversations and events.
- REST JSON omits nulls (`WhenWritingNull`, `Program.cs:981`), but hub payloads keep them. Both use
  camelCase and string enums.

## Transfers

Paths below are relative to `Transfers/` unless they start with another directory.

### Records

- The list shape is `[{ username, directories: [{ directory, fileCount, files: Transfer[] }] }]`. A `Transfer` has
  `id, batchId?, username, direction, filename (full remote path), size, state, requestedAt, enqueuedAt?, startedAt?, endedAt?, bytesTransferred, averageSpeed, placeInQueue?, exception?, attempts, nextAttemptAt?, removed`,
  plus the computed `bytesRemaining, percentComplete, elapsedTime?, remainingTime?` (`Types/Transfer.cs`).
  - Sizes are bytes, `averageSpeed` is bytes per second, and `percentComplete` runs from 0 to 100.
  - `averageSpeed` comes from Soulseek.NET 10.0.2 (`TransferInternal.cs`): an exponential moving average (α 0.2) of
    1 s samples. It's 0 for a transfer's first second and is replaced by bytes ÷ duration once every byte is in. So
    it underreads short transfers while they run: over a batch of 3–5 s files, the running rows' summed
    `averageSpeed` showed 18% of the bytes actually moved (measured).
  - `elapsedTime` and `remainingTime` are .NET TimeSpans (`"00:00:03.6311109"`). `elapsedTime` is measured
    against the server's clock, so a running transfer's record changes on every poll.
  - **`requestedAt` and `enqueuedAt` are UTC but serialised without the `Z`**, while `startedAt` and
    `endedAt` have it. Only the latter two have a `SpecifyKind(Utc)` converter (`TransfersDbContext.cs`).
  - `attempts` is 0 until a download's first attempt starts, and always 0 for uploads.
- `state` is a flags enum serialised like `"Completed, Succeeded"` or `"Queued, Locally"`. The states actually
  written are `Queued, Locally`, `Requested`, `Queued, Remotely` (downloads only), `Initializing`,
  `InProgress` and `Completed, Succeeded|Cancelled|TimedOut|Errored|Rejected|Aborted`. Bare `Queued` and
  `Completed` never occur. `Completed` means "this attempt ended". It doesn't mean success, and
  **it isn't guaranteed final**:
  - Download auto-retry (3 attempts in total by default) retries every failure except cancellation, rejection,
    duplicate transfers and size mismatches, so `Completed, Errored`, `TimedOut` and `Aborted` can all flip
    back to `Queued, Locally` **under the same id**, with `attempts` incremented. The wait before an attempt is
    `floor((2^n − 1) / 2) × 5 s` plus up to 5 s of jitter: 0–5 s before the second, 5–10 s before the third
    (`Common/Compute.cs`, `Common/Retry.cs`).
  - While it waits, the record keeps the failed attempt's `startedAt`, `endedAt`, `exception`,
    `bytesTransferred` and `averageSpeed`. They're overwritten by the next attempt's first state change.
    `placeInQueue` is already cleared.
  - Cancelling during that wait ends as `Completed, Errored`, not `Cancelled`.
  - A comment in `Downloads/DownloadService.cs` says a download the peer doesn't acknowledge within 3 minutes is
    recorded as `Cancelled`. From reading the code, the `TimeoutException` is probably recorded first, which makes
    it `TimedOut` (not observed).
  - A failure before Soulseek reports any state flips the state
    `Completed, Errored` → `Queued, Locally` → `Completed, Errored` within milliseconds, for example when
    enqueueing while disconnected. This affects downloads and uploads.
  - If moving the file after a download fails, the state stays `Completed, Succeeded` but the record gains an `exception`.
  - Small race windows can bump `bytesTransferred`/`averageSpeed` after `Completed`, or un-remove a record.
  - These fields never change: `id, batchId, username, direction, filename, size, requestedAt`.
    `nextAttemptAt` is declared but never set.
- Removal is a soft delete (`removed: true`). Re-enqueueing a file marks its old record removed and creates a
  **new id**. Clear-completed and retention pruning also remove records.
- At startup, unfinished transfers become `Completed, Errored` ("Application shut down"). On the first
  Soulseek login after that, the unfinished _downloads_ are re-enqueued under new ids, without their batch (so
  a batch destination is lost), and the old records are removed. If the peer is offline the old record just
  stays errored. Observed: pressing Connect on the dev instance restarted 34 such downloads.
- Uploads have no enqueue, retry or position endpoint, and never have the `Remotely` flag. A peer's
  re-request supersedes the old record like a download re-enqueue does.
- Retention (`retention.transfers.{upload,download}.{succeeded,errored,cancelled,failed}`, YAML only) is in
  **minutes** and off by default. It soft-removes records at startup and then every 5 minutes.

### Endpoints

Everything is under `/transfers`, needs `application/json` for bodies, and returns 403 in relay agent mode.
Error bodies are JSON strings. Encode the username segment with `encodeURIComponent`.

- `GET downloads` / `GET uploads` return every non-removed record, read from SQLite on **every** call with
  no cache and no `ORDER BY` (in practice insertion order). The query visits every record of that direction
  ever written, removed ones included. The only parameter is `includeRemoved`. There's no pagination, no
  ETag or `If-None-Match`, and **no response compression**. `GET .../{username}` returns one user's object
  (not an array) and 404 if there are none.
- `DELETE .../{username}/{id}?remove=bool` always returns 204 for a well-formed id, even an unknown one.
  - The cancel is asynchronous.
  - `remove=true` only removes a record that's already `Completed`. On an active transfer it just cancels,
    and removing the resulting `Completed, Cancelled` record takes a second DELETE.
  - A stuck download with nothing to cancel is set to `Completed, Cancelled` in the same call; uploads have no
    such fallback.
- `DELETE downloads/all/completed` (and `uploads/...`) removes every `Completed` record, succeeded and failed
  alike. There's no succeeded-only or failed-only variant and no bulk cancel.
- **`GET downloads/{username}/{id}/position` is a Soulseek action**: it asks the peer. It returns a bare
  integer and stores it as `placeInQueue`, which the next state change clears. Every Soulseek failure is a
  500; observed: `"The wait timed out after 5000 milliseconds"` when the peer didn't answer.
- `POST downloads/batches` takes `{id?, searchId?, username, files: [{filename, size}], options?: {destination?}}`.
  - It returns `{batch, failures: [{filename, message}]}` with 201 (all enqueued), 207 (partial) or 200 (none).
    Failures include `"Skipped: Already in progress"` when the file's current record isn't `Completed`.
  - It returns 400 for invalid bodies and duplicate filenames, 404 when the user is offline or blacklisted,
    409 for a duplicate batch id, and 500 when not logged in to Soulseek or the peer can't be reached.
  - `options` may be omitted, but `"options": null` is a 500. `externalId` is accepted and dropped.
  - It returns once the records are inserted as `Queued, Locally`, without waiting for the peer's queue.
  - **At most two enqueues run at once**, across the batch and the obsolete per-user POST. A third gets 429
    straight away with nothing done. Observed: a retry's POST got 429 twice while two other enqueues held the
    slots for about 2 s each, then succeeded on the next resend.
  - It has no limit on the number of files. Kestrel's default 30 MB body limit applies, and behind nginx's default
    1 MB limit a batch of roughly 7–10k files fails. Duplicate `filename`s within a request are compared exactly, and
    give a 400. The work before it returns grows roughly with the square of the file count (one DbContext tracks
    every insert), and files then reach the peer 5 at a time (`Downloads/DownloadService.cs`, not measured).
- **Where a download lands.** It's written to
  `<directories.incomplete>/<username>/<remote directory without its root>/<file>`, and on completion moved to
  `<directories.downloads>/<destination>/<basename>`. The destination is worked out at completion, from the batch and
  the current config (`Downloads/DownloadService.cs`, `Files/FileService.cs`).
  - By default it's the YAML-only pattern `transfers.download.destination.subdirectory: ${SOURCE_DIRECTORY}`: the
    last remote folder name. The pattern's variables are `SOURCE_USERNAME`, `SOURCE_PATH` (the remote directory
    without an `@@abcde`, drive or UNC root), `SOURCE_DIRECTORY`, `BATCH_ID`, `BATCH_EXTERNAL_ID`, `SEARCH_ID` and
    `SEARCH_TEXT` (`Core/Options.cs`). So `Album\CD1\01.flac` and `Album\CD2\01.flac` land in `CD1/` and `CD2/`, and
    two albums' `CD1`s merge, with a clashing name renamed `01_<ticks>.flac` under the default `exists: rename`.
  - A batch's `options.destination` replaces the pattern. It's one literal folder relative to the downloads
    directory, with no template expansion, and `.` or `..` segments are rejected. `\` and `/` both work as
    separators. Every file in the batch lands flat in it, so keeping a tree takes one batch per remote folder.
- `GET downloads/batches/{id}` returns `{id, searchId?, username, direction, createdAt, options, transfers}`,
  including removed transfers. There's no endpoint that lists batches.
- A batch's `searchId` is only used by the `SEARCH_ID` and `SEARCH_TEXT` destination template variables
  (`Downloads/DownloadService.cs`).
- **There's no retry endpoint.** Retrying means enqueueing the same `username` + `filename` + `size` again.
  Stock's retry uses the obsolete `POST downloads/{username}` one file at a time, so it loses the batch and
  its destination, and runs into the 429.

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

- Observed once: while a hub WebSocket was connected, SIGTERM made slskd log "Application is shutting
  down" and "Client stopped" and then hang instead of exiting. `devenv.nix` gives it a 10 s shutdown grace before SIGKILL.
- Observed later, with no Soulseek credentials configured: it exited in 0.3 s with both hubs connected.
  What triggers the hang is unknown.

## Application hub

- On connect the caller gets `STATE` and then `OPTIONS` (`Core/API/Hubs/ApplicationHub.cs:92`). The method
  names are uppercase, and the JS client matches them case-insensitively.
- `STATE` is the whole `State` record (`Core/State.cs`), pushed in full to every client on **every** update, with
  no debounce and no check that anything changed (`Common/ManagedState.cs:198`, `Application.cs:1913`). That
  includes share-scan progress in 1% steps, and `health`, which updates every 30 s, so a push arrives at least
  every 30 s. `GET /application` returns the same object with nulls omitted.
- Top-level keys: `version {full, current, latest, isUpdateAvailable, isCanary, isDevelopment}`,
  `pendingReconnect`, `pendingRestart`, `server`,
  `connectionWatchdog {isEnabled, isAttemptingConnection, isAwaitingVpn, nextAttemptAt}`, `vpn`, `relay`, `health`,
  `user {username, privileges, statistics}`, `distributedNetwork`,
  `shares {scanPending, scanning, ready, faulted, cancelled, scanProgress, hosts, directories, files}`, `rooms` and
  `users`. `users` is never populated.
- `user.username` is updated on every Soulseek client state change. It's null until the first login and again after
  every disconnect, since Soulseek.NET clears its `Username` as it disconnects (`SoulseekClient.cs`).
  `pendingReconnect` is set when an option that needs a reconnect changes while connected, and any disconnect clears
  it. `pendingRestart` stays set until a restart. `version.latest` and `isUpdateAvailable` stay null on dev and
  canary builds and with `no_version_check`.
- `OPTIONS` is the whole options object with every secret replaced by `"*****"`. It's pushed on connect and
  after each options change that actually differs.
- Other shapes: `user.statistics {averageSpeed, directoryCount, fileCount, uploadCount}` (as the server reports
  them), `health.search.incoming {latency, queueDepth, dropRate}` (a moving average in ms, the waiting incoming
  searches, and drops so far this minute; refreshed every 30 s) and
  `distributedNetwork {branchLevel, branchRoot, canAcceptChildren, childLimit, children[], hasParent, isBranchRoot, parent}`.
  `vpn` is `{isReady, isConnected}` both when the VPN integration is off and when it's down, and `relay.mode` reads
  `Controller` with relay disabled, so neither says whether its feature is on.
- `GET /application` is about 1.2 KB on dev.

## Application

Paths are relative to `Core/API/Controllers/` unless they start with another directory. Restart and shutdown were
observed on throwaway instances of the dev build and the 0.25.1 and 0.26.0 release binaries.

- `PUT /application` restarts and `DELETE /application` shuts down. Both need a JWT (API keys can't call them),
  return 204 at once, and aren't gated on any option or on relay mode (`ApplicationController.cs`).
- **Restart re-executes slskd itself** (`Process.Start` with the same command line, then a graceful stop), and
  **fails for good while slskd is still answering a request.** The new process checks the single-instance mutex
  first thing, and the old one holds it until its graceful stop ends, which waits up to 30 s for open requests
  (`Program.cs`). Observed:
  - Idle, it came back every time (about 20 restarts), answering `/health` again in about 2 s. The new process won
    the race by only 35–80 ms.
  - With a slow 20 MB download open it never came back (3 of 3). The new process logged "An instance of slskd is
    already running" and quit, and the old one exited when the request ended or 30 s passed. A 761 KB download
    didn't block it, and open hub connections don't either.
  - The release binary passes its own path again as an argument, so each restart adds one more
    (`slskd slskd slskd --app-dir …`). slskd ignores them.
  - The mutex is per Unix session (no `Global\` prefix), and the child stays in its parent's session.
  - Nothing detects Docker or a supervisor. The image's entrypoint exits with slskd, which kills the child, so in
    Docker a restart relies on the container's restart policy, and under `always` or `unless-stopped` a shutdown
    comes back too (inferred).
- Shutdown stops gracefully and calls `Environment.Exit(0)` 500 ms later regardless, so the process is gone within
  0.2–0.75 s even with requests open. It then skips the Soulseek disconnect.
- On the next start, unfinished transfers become `Completed, Errored` and downloads are re-enqueued without their
  batch (see [Records](#records)).
- Hidden and unused by stock: `POST /application/gc` (a blocking full collection), `GET /application/dump` (downloads
  `dotnet-dump` and serves a full memory dump) and `POST /application/loopback`. None has a role check.

### Version check

- slskd asks `https://api.github.com/repos/slskd/slskd/releases/latest` once at startup unless `no_version_check`
  is set, and never again on its own (`Application.cs`). `GET /application/version/latest?forceCheck=true` checks
  again, ignoring `no_version_check`, and returns `state.version`. A failed check is a 500. Development and canary
  builds never check, even when forced.
- A check sets `version.latest` and `isUpdateAvailable` and pushes `STATE`. When up to date, `latest` is set to
  `current`.
- Release tags have no `v` (`0.26.0`), but release builds report a fourth part (`current: "0.26.0.0"`), so `latest`
  is a valid tag for `releases/tag/<latest>` only when `isUpdateAvailable`. Canary builds end in `.65534`.

### Pending states

- `pendingRestart` is set when a changed option is marked restart-required (debug, instance name, directories,
  logger, web, most flags and about 60 more in `Core/Options.cs`), or on `PUT /options/yaml` while
  `no_config_watch` is on. Only a new process clears it. Observed: editing `instance_name` in the YAML set it.
- `pendingReconnect` is set when the Soulseek address, port, username or password changes while connected, and any
  disconnect clears it.
- `shares.scanPending` is set when `shares.directories` or `shares.filters` change, or when a scan faults, and a
  scan that ends any other way clears it, **a cancelled one included** (see [Scanning](#scanning)). Observed: adding a
  directory in the YAML set it and a rescan cleared it.
  - Changes are compared as sets, so reordering the entries or adding a duplicate doesn't set it.
  - While a scan runs it comes from the share service's own flag, which never sees config changes. Observed: false
    during the rescan after a config change, true during the rescan after a cancel.
- `PUT /shares` rescans and always returns 200, even while a scan runs (observed). Its 409 for a scan in progress can't
  happen, because the exception lands in the returned task (`Shares/ShareService.cs`). `DELETE /shares` cancels (204,
  or 404 when none runs).

### Privileges

- `user.privileges.privilegesRemaining` is in **seconds**, although Soulseek.NET's docs say days: it passes the
  server's integer through unchanged, and Nicotine+ and its protocol docs treat it as seconds. `isPrivileged` is
  `> 0`.
- It's fetched at login, after a share scan, and otherwise at most every 4 hours, so it doesn't count down and a
  purchase only shows after the next login. The server's privilege notifications don't carry the time, and slskd
  doesn't subscribe to them.
- There's no endpoint to get privileges. The donation page SoulseekQt and Nicotine+ open is
  `https://www.slsknet.org/qtlogin.php?username=<username>`, with the username percent-encoded.

### Process metrics

- `STATE` has no uptime, pid, OS or runtime. `GET /telemetry/metrics` has them, for any authenticated caller and
  whether or not `metrics.enabled` is set: `process_start_time_seconds`, `process_working_set_bytes`, the
  `dotnet_build_info` labels `runtime_version`, `os_version` and `process_architecture`, and free space per mount.
  It's Prometheus text, or a JSON object keyed by metric name (`{name, help, type, samples: [{value, labels}]}`) when
  `Accept` is exactly `application/json`. About 35 KB and 10 ms on dev.
- 0.25.1 sometimes answers it with a 500 ("An item with the same key has already been added"). Observed twice in
  about five minutes. 0.25.1 also has no metrics hub, so its negotiate is a 404.

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
- Observed against the list's `InProgress` rows at the same moments, `inProgress.files` disagreed in 19–30% of samples.
  A peer stuck in `Initializing` counts, and when that attempt fails the decrement takes the gauge to 0 while another
  file runs, or to −3 in a batch. `users` is only set at recounts, and `queued.files` reached −1.

### Speeds

- `inProgress.totalSpeed` is an exponential moving average (factor 0.5) of the in-progress transfers' summed
  `averageSpeed` (see [Records](#records)), fed only at each recount and reset to 0 by one that finds none running.
  `inProgress.averageSpeed` is the same over their mean, but each running transfer also feeds it its own speed about
  once a second between recounts (`Telemetry/Metrics.cs`, `Transfers/Downloads/DownloadService.cs`,
  `Transfers/Uploads/UploadService.cs`). Both are bytes per second. Stock's footer shows `averageSpeed`.
- Measured with real downloads, as a share of the bytes the files actually moved:

  | Downloads                                  | `totalSpeed` | `averageSpeed` | The higher of the two |
  | ------------------------------------------ | ------------ | -------------- | --------------------- |
  | One 32 MiB file over 128 s                 | 92%          | 98%            | 102%                  |
  | Two users at once                          | 83%          | 75%            | 88%                   |
  | Six 4–6 MB files from one user, 3–5 s each | 9%           | 26%            | 26%                   |

- **`totalSpeed` misses short files**, because it only sees files running at a recount and past their first second.
  It read 0 in 22 of 24 samples while one of the six files was downloading, and never registered files of 2–3 s.
- `totalSpeed` climbs in 5 s steps, taking 15–20 s to reach a steady rate, and holds its last value until the recount
  after the last transfer ends. When one of two transfers ends it halves the excess every 5 s, overstating for about
  20 s.
- With two transfers, `averageSpeed` swings between their two speeds rather than following the mean.
- `completed.bytes` only rises as a file completes. A rate from it was right over the six short files (91%) but reads
  0 through a long one.

## Logs

- `/hub/logs` sends `BUFFER` to a client as it connects, then `LOG` to every client for each record. `GET /logs` returns
  the same buffer with nulls omitted. Both are open to any authenticated caller (`Core/API/Hubs/LogsHub.cs`,
  `Core/API/Controllers/LogsController.cs`).
- The buffer is the last 100 records, held in memory (`Program.cs`, `LogBuffer`), so a restart empties it. It's in the
  order the records were added, oldest first.
- A record is `{timestamp, context, subContext, level, message}` (`Common/Logging/LogRecord.cs`, filled in by the
  `DelegatingSink` in `Program.cs`):
  - `timestamp` is the server's local time with its offset, with up to 7 fractional digits and trailing zeros dropped
    (`"2026-09-25T11:52:29.833777+00:00"`).
  - `context` is Serilog's `SourceContext`, a full type name like `slskd.Shares.SqliteShareRepository`. Soulseek.NET's
    diagnostics are logged as `slskd.Application` with the Soulseek.NET class's full name in `subContext`
    (`Application.cs`, `Client_DiagnosticGenerated`). Nothing else sets `subContext`.
  - `level` is Serilog's level name: `Verbose`, `Debug`, `Information`, `Warning`, `Error` or `Fatal`. The minimum is
    `Debug` with `debug` on and `Information` otherwise, so `Verbose` never arrives.
  - `message` is the rendered template, which puts string values in quotes. When there's an exception, its whole
    `ToString()` is appended after `": "`, stack trace and all, over several lines.
- Neither the buffer nor the pushes are in timestamp order: records are added and pushed from whichever thread logged
  them, and each push is fired without being awaited (`Application.cs`, `LogEmitted`). Observed: 156 of 813 pushes had
  an earlier timestamp than the push before.
- A record logged while a client connects can reach it twice, in `BUFFER` and as a `LOG`, and the `LOG` can arrive
  first: SignalR adds the connection to the broadcast list before it calls the hub's `OnConnectedAsync`
  (ASP.NET Core's `HubConnectionHandler.cs`). Not observed. Every reconnect sends the whole buffer again.
- Pushes can be frequent. Observed: 54 a second on the dev instance while logged in to Soulseek with no share scan,
  each one a `no such table: filenames` warning with a 7-line stack trace (see [Endpoints](#endpoints-1) under Search).

## Events

Paths are relative to `Events/` unless they start with another directory.

- `GET /events?offset=&limit=` (`API/EventsController.cs`) returns records **newest first by `timestamp`, with no
  tiebreaker** (`EventService.cs`), and the total in an `X-Total-Count` header, counted in a second query.
  - `offset` defaults to 0 and `limit` to 100, with no maximum. A negative offset or a limit below 1 is a 400 with a
    JSON string. A value that isn't an integer silently becomes the default, and an offset past the end is `[]`.
  - There's no filter by type or time, no single-event GET and no way to delete one. Nothing pushes events.
- A record is `{timestamp, type, data, id}`: a GUID, the type's name, and UTC with 7 fractional digits and the `Z`.
  **`data` is a JSON string** of the event's own fields plus `version`, with nulls kept and non-ASCII unescaped
  (`Types/EventRecord.cs`).
- The types and what `data` holds (`Types/Events.cs`):
  - `SoulseekClientConnected`: nothing. `SoulseekClientDisconnected`: `message`, and `exception` as a whole .NET
    exception object (`message`, `stackTrace`, `innerException` and so on).
  - `DownloadFileComplete` and `UploadFileComplete`: `localFilename`, `remoteFilename` and the whole `transfer` record.
    Only successes raise them, a download's after it's moved into place.
  - `DownloadDirectoryComplete`: `localDirectoryName`, `remoteDirectoryName` and `username`. It's raised once the user
    has no other download left from that remote folder, so a single-file download raises one too.
  - `PrivateMessageReceived`: `message {timestamp, id, username, direction, message, isAcknowledged, wasReplayed}`,
    raised again for every replay at login.
  - `RoomMessageReceived`: `message {timestamp, username, message, roomName, direction}`, including our own echoed
    messages. `direction` is always `Out`, because `RoomMessage.FromEventArgs` never sets it
    (`Messaging/Types/RoomMessage.cs`).
  - `Noop`: only raised through `POST /events/{type}`.
- A transfer event's timestamp is the transfer's `endedAt`, not when the row was written, and a
  `DownloadDirectoryComplete` has exactly its last file's timestamp (observed 7 of 7). So offset pages can overlap, and
  a download's event can land below rows written before it.
- **Nothing is ever pruned**, and there's no retention option for events. Observed on dev: 117 rows in about 29 hours,
  about 770 B each on the wire (a file event's `data` alone is about 900 B), so 100 rows are about 76 KB.
- `POST /events/{type}` (a JSON string body, which may be empty) raises a sample and returns 201. It's buggy: the
  sample is declared as the base `Event`, so the stored copy is only `{"version":0}` and webhooks and scripts get it
  twice (from the source and a serialisation check; only `Noop` was raised). `SoulseekClientConnected` and
  `SoulseekClientDisconnected` are listed as valid but are a 500.
- Webhooks and scripts (`Integrations/`) are the only subscribers, and are configured in YAML only.

## Shares

Paths are relative to `Shares/` unless they start with another directory. Scans were observed on a throwaway instance
of the dev build sharing up to 64k files.

### Configuration

- Shares come from `shares.directories` (YAML), `-s`/`--shared` (repeatable) or `SLSKD_SHARED_DIR` (split on `;`), and
  filters from `shares.filters`, `--share-filter` or `SLSKD_SHARE_FILTER`. No endpoint adds or removes one:
  `PATCH /options` only takes the Soulseek listen address and port, so a UI can change them only through
  `PUT /options/yaml`, with `remote_configuration` on.
- An entry is an absolute path, optionally prefixed with `[Alias]`; otherwise the alias is the last segment. A leading
  `-` or `!` makes it an exclusion. Aliases must be unique (case-sensitive, exclusions included) and contain no
  separator, and a path can't have two aliases (`Core/Options.cs`).
- Filters are regexes, case-insensitive unless `flags.case_sensitive_reg_ex` is set, tested against the full local path
  of every directory and file. The documented `case_sensitive_regex` works at startup, but slskd's validator rejects
  it (see [Remote configuration](#remote-configuration)).
- `directories` and `filters` apply without a restart (unless `no_config_watch`). `cache.storage_mode` (`memory` by
  default, or `disk`) and `cache.workers` need one.

### Endpoints

Everything is in `API/Controllers/SharesController.cs`, takes a JWT or any API key with no role check, and works in
relay agent mode.

- `GET /shares` returns `{"local": Share[], "<agent>": Share[]}`, keyed by host, with the exclusions and the longest
  `localPath` first. A Share is `{id, alias, isExcluded, localPath, raw, remotePath, directories?, files?}`
  (`Types/Share.cs`).
  - `remotePath` always equals `alias`, and `id` is its SHA1 in uppercase hex, so an id belongs to an alias rather
    than a path. `GET /shares/{id}` matches it case-sensitively.
  - `raw` is the config entry, prefix included, without a trailing `/`.
  - The counts are absent until a scan or startup computes them, and **any change to `shares.directories` rebuilds
    every share without them**, a reorder included (observed). An exclusion counts 0 and 0, and `directories`
    leaves out the share's own root.
- `GET /shares/contents` returns everything shared as `[{name, fileCount, files}]`, one entry per directory, in the
  shape of a browse response: `name` is the remote path joined with `\` (`Music\Album`), and files have bare
  `filename`s and the same attributes, read with TagLib for audio and video only.
  - It's read from the share database and built in memory on each call, with no pagination or compression. Observed:
    2.47 MB for 24k tiny files, in 0.9 s. A FLAC costs about 300 B.
  - Directories come in no particular order, with their files sorted. A directory without files, such as one
    holding only folders, is listed with `files: []`.
  - Before any scan has created the database it's a 500: `"SQLite Error 1: 'no such table: directories'."`
    (observed on dev).
- `GET /shares/{id}/contents` filters the same list with `LIKE '<remotePath>\%'`, so aliases that differ only by case,
  or where `_` matches another character, merge (from the source). It leaves out the share's root unless that holds
  files, and gives `[]` for an exclusion or an unscanned share.
- `PUT /shares` scans and `DELETE /shares` cancels (see [Pending states](#pending-states)).
- A file belongs to the deepest share containing it, so a nested share's contents appear only under its own alias.
  Hidden files, dot-directories, system files and symlinks aren't shared, and neither are filtered or excluded paths,
  which are counted only in the log. A share whose path doesn't exist logs a warning and counts 0 (observed).

### Scanning

- At startup, unless `no_share_scan` is set, slskd restores the last scan's database (from the `shares.local.bak.db`
  backup in memory mode). It scans if there's none, the last one never ended, it was marked suspect, or the share
  options changed since. `force_share_scan` always scans. Connecting to Soulseek waits for that scan, while HTTP is
  already up. With `cache.retention` (minutes, at least 60) it rescans once the last good scan is older.
- With `no_share_scan`, nothing is restored and `ready` stays false, so contents are a 500 until a `PUT /shares`, which
  still works (observed).
- **A scan updates the live database in place.** During a scan, contents are the old data plus what's been scanned so
  far (observed growing from 8k to 23k directories). Stale rows are pruned at the end, and then the search index is
  rebuilt, so incoming searches use the old index throughout. Peers browsing us get `browse.cache`, which is rebuilt
  when `ready` turns true.
- `STATE.shares` during a scan (observed):
  - At the start, `scanning: true` and `ready: false`, and `directories` and `files` drop to 0.
  - Then `directories` is how many directories will be scanned, `files` how many files have been scanned so far, and
    `scanProgress` runs from 0 to 1. A push goes out only when the rounded percentage changes, about 100 per scan, so
    other changes wait for the next step.
  - At the end, `scanning: false` and then `scanPending: false`, and 200–400 ms later `ready: true` with the totals.
    The counts in `GET /shares` change only then.
- **A cancelled scan leaves a stale search index and counts as a success.**
  - The scan stops only once its directory walk has finished.
  - Nothing is pruned and the index isn't rebuilt. Observed: 64,001 files could be browsed and 24,001 searched.
  - Then `ready` turns true and `browse.cache` is rebuilt from the partial data. `cancelled` is set and `scanPending`
    cleared, and after a restart the partial scan counts as good. Only `cancelled` shows what happened, until the
    next scan or restart.
- A faulted scan keeps `scanPending` and leaves `ready` false (from the source).
- Removing a share takes it off `GET /shares` at once, but its files stay in contents, search and `browse.cache` until
  a rescan (observed).
- A peer asking for a file that's gone or changed size marks the last scan suspect
  (`Transfers/Uploads/UploadService.cs`). That makes the next startup rescan, but it never reaches `STATE`.
- `STATE.shares.hosts` lists `local` and each relay agent, and stays null with `no_share_scan`. Nothing exposes scan
  history or when the last scan ran.

## Files

Paths are relative to `Files/` unless they start with another directory. Deleting, symlinks and a big directory were
checked on a throwaway instance of the dev build.

### Endpoints

Everything is in `API/FilesController.cs` and `FileService.cs`, takes a JWT or any API key with no role check, and works
in relay agent mode.

- `GET /files/{downloads|incomplete}/directories` lists that directory, and `.../directories/{path}` a folder in it.
  `DELETE .../directories/{path}` deletes a folder with everything in it, and `DELETE .../files/{path}` a file.
- **`{path}` is standard base64 of the UTF-8 path relative to the root**, padding included.
  - `+` works raw or as `%2B`. **A `/` in the base64 can't be sent**: raw it splits the route, and `%2F` reaches the
    decoder undecoded (a 500).
  - The path is normalised first, so `./a`, `a//b` and `a/./b` mean `a` and `a/b`, and inserting them shifts the
    encoding. Some names encode with a `/` at every shift, like `Who Are You???.flac`. Observed: it could be listed with
    its folder but not deleted on its own.
- A listing is `{name, fullName, attributes, createdAt, modifiedAt, files, directories}`. Files are
  `{name, fullName, length, attributes, createdAt, modifiedAt}`, and child directories have no `files`, `directories`
  or `length`.
  - **`fullName` is relative to the folder asked for**, and a root's own `name` is its basename.
  - `attributes` is a flags string (`"Hidden, Directory"`, `"Directory, ReparsePoint"`).
  - Times are UTC. On Linux `createdAt` equals `modifiedAt` (observed).
  - Entries come in filesystem order.
- A listing is one level deep by default. `?recursive=true` (only `true` and `false` parse) flattens every descendant
  into the top-level arrays, level by level, with `fullName`s like `a/b/c.flac`. There's no paging or compression.
  Observed: 10k files in 400 folders was 2.3 MB in 0.15 s, about 230 B a file.
- **What a listing includes:**
  - System-attribute entries are skipped, but dotfiles are listed as `Hidden`.
  - A recursive listing follows directory symlinks, even outside the roots. A loop only stops when the OS gives up,
    at about 40 levels. Observed: 8 files became 358 KB.
  - A symlinked file's `length` is the length of the link's target path, and a broken link lists as a file.
  - Unreadable folders are skipped.
- **Errors:**
  - A missing folder, or a file where a folder was expected, is an empty 404.
  - Anything else is a 500 with a JSON string. That includes a path outside the roots and bad base64.
  - The check is on the resolved path, so either root's endpoint reaches the other through `..` (observed).
  - A trailing `/` in a configured directory makes everything below that root a 500.

### Deleting

- **Deleting needs `remote_file_management`** (`SLSKD_REMOTE_FILE_MANAGEMENT`, `--remote-file-management`), which is
  off by default. Without it every DELETE is an empty 403, before the path is read.
  - It's read on each request, so a change applies without a restart.
  - It can't be set through `PATCH /options`.
- `remoteFileManagement` and `directories.{downloads,incomplete}` aren't redacted in `GET /options` or `OPTIONS`, which
  is pushed again when they change (observed).
- A root can't be deleted (a 500). Deleting a folder removes symlinks rather than their targets, and leaves emptied
  parents behind. Every request deletes one path.
- Deleting a missing file is a 204 when its folder exists and a 500 when it doesn't. Deleting a missing folder is a 404.
- On Linux, deleting a file slskd is still downloading succeeds. From the source, the download keeps writing to the
  deleted file, fails to move it at the end, and most likely ends `Completed, Succeeded` with no file anywhere
  (`Transfers/Downloads/DownloadService.cs`).
- Transfer records hold no local path, so deleting finished files changes nothing in the transfer lists.
- `retention.files.{complete,incomplete}` (minutes, at least 30) deletes files by modification time every 30 minutes,
  skipping hidden ones, whatever `remote_file_management` says (`Application.cs`).
- After a download is moved, only its innermost folder in incomplete is removed, and only if it's empty, so
  `<username>/…` folders pile up. On dev, 13 of the 49 folders in incomplete held no files.
- Nothing serves a file's contents to a browser.

## Options

Paths are relative to `Core/API/Controllers/OptionsController.cs` unless they start with a directory. Remote
configuration and the debug view were checked on the dev build with `SLSKD_REMOTE_CONFIGURATION` and `SLSKD_DEBUG`.

### Reading

- `GET /options` is the current options, redacted, with nulls omitted (3.3 KB on dev). The application hub pushes the
  same object as `OPTIONS` (see [Application hub](#application-hub)), with nulls kept and four placeholder keys that
  are always null: `permissions`, `global`, `groups` and `integration`. `GET /options/startup` is the object bound once
  at startup, so it only differs after a live reload.
- Keys are camelCase, while the file's are snake_case.
- Redaction (`Common/Redactor.cs`) replaces every non-null `[Secret]` string with `"*****"`, so `*****` means set and a
  missing key means unset. Webhook headers and URLs, `logger.loki` and usernames aren't secrets.
- The keys of `relay.agents`, `transfers.groups.user_defined`, `web.authentication.api_keys`, `integrations.webhooks`
  and `integrations.scripts` are names the user chose. They come back lowercased with `_` and `-` dropped, like every
  key slskd reads from YAML (observed: a group `My_Group` came back as `mygroup`), and JSON leaves them alone, since no
  `DictionaryKeyPolicy` is set.
- `2147483647` (`int.MaxValue`) is the default of `transfers.upload.speed_limit`, `transfers.download.slots` and
  `speed_limit`, and each group's `upload.slots` and `speed_limit`, where it means no limit (`Core/Options.cs`).
  Elsewhere it's only a range maximum, so a value there means what it says.

### Remote configuration

- `GET /options/yaml`, `GET /options/yaml/location`, `POST /options/yaml/validate`, `PUT /options/yaml` and
  `PATCH /options` need **the current `remote_configuration`** (`SLSKD_REMOTE_CONFIGURATION`,
  `--remote-configuration`), and are otherwise a 403 with an empty body.
- `GET /options/debug` also needs `debug` on **at startup** (`SLSKD_DEBUG`, `-d`, the YAML, or an attached debugger),
  which `GET /options/startup` shows. Stock checks the current `debug` instead.
- YAML travels as a JSON string both ways: `text/plain` is a 415, and a body that isn't a JSON string is a 400
  `"Value cannot be null. (Parameter 's')"`. `GET /options/yaml` is the file's text, unredacted, and
  `GET /options/yaml/location` its path. A missing or unreadable file is a 500 with the message.
- `POST /options/yaml/validate` is a 200 either way: an empty body with no content type when valid, and a JSON string
  when not. **It never gives a line or column.** A parse error is one line, such as
  `While scanning a plain scalar value, found invalid mapping.`, and rule failures are an indented tree under
  `Invalid configuration:`. slskd logs each failure as a warning that does carry YamlDotNet's line and column
  (observed).
- **The validator and the runtime disagree** (observed). The validator is YamlDotNet with `UnderscoredNamingConvention`
  (`Common/CommonExtensions.cs`), which puts `_` before every capital of the property's name:
  - It wants `log_s_q_l` and `case_sensitive_reg_ex`, and rejects the documented `log_sql` and `case_sensitive_regex`,
    as well as camelCase and hyphenated keys. The runtime lowercases keys and drops `_` and `-`, so it takes them all.
    A file with a rejected spelling can't be saved through `PUT`, which validates too.
  - It passes duplicate keys, `yes`/`no`/`on`/`off` for booleans, and a document that's empty or only comments.
- `PUT /options/yaml` validates the text alone (env and the command line aren't merged in), copies the file to
  `<file>.bak` (replacing the last one and keeping its mode), writes the text verbatim and not atomically, and returns
  200 with an empty body, or 400 with the validator's message. There's no check that the file changed since it was
  read.
  - With the config watch on, slskd reloads about 250 ms later. It sets `pendingRestart`, `pendingReconnect` or
    `scanPending`, and pushes `OPTIONS`, only if an effective value changed. Observed: a comments-only edit pushed
    nothing, and a new `instance_name` was pushed within 300 ms and set `pendingRestart`.
  - With `no_config_watch` it sets `pendingRestart` whatever changed, and nothing reloads.
- **What the validator lets through breaks slskd** (observed):
  - Duplicate keys: the reload fails silently and every YAML value is dropped (`instanceName` went back to `default`
    and `soulseek.username` disappeared), while running services keep their old options.
  - `debug: yes`: every request that reads the options is a 500 (`"Failed to convert configuration value 'yes' at
'slskd:Debug' to type 'System.Boolean'."`), `GET` and `PUT /options/yaml` included, so the file can only be fixed
    on disk. slskd won't start with it (`Program.cs`).
  - An empty document drops every YAML setting, the Soulseek login included.
- `GET /options/debug` is a JSON string of `IConfigurationRoot.GetDebugView()`: an indented `key=value (Provider)` line
  per key, such as `username=… (YamlConfigurationProvider for 'slskd.yml' (Optional))`, with the keys lowercased and
  `_` and `-` dropped, **secrets in plain text**, and the provider whose value won. 9.4 KB and 179 lines on dev.
- Sources layer defaults < env < YAML < command line < the `PATCH /options` overlay (`Program.cs`). A YAML value the
  command line also sets has no effect, and lists merge by index across sources, so a YAML list can't shorten one
  from env (checked against the dev build's binder). Only the debug view shows where a value came from.
- `PATCH /options` takes only `{soulseek: {listenIpAddress, listenPort}}`. It goes into an in-memory overlay that a
  restart loses and that never drops a key once set (`Core/OptionsOverlay.cs`).

## Telemetry reports

Paths are relative to `Telemetry/`. Stock's dashboard (`components/Dashboard/`) is built on these; we have no
dashboard yet.

- `GET /telemetry/reports/transfers/{summary,histogram,leaderboard,exceptions,exceptions/pareto,directories}`
  (`API/ReportsController.cs`, `ReportsService.cs`) only read SQLite, never Soulseek, and need no option. Stock
  sends its nine requests when the page opens and when the range changes, and never polls.
- Each request runs raw SQL, uncached. The window filters on `EndedAt`, which no index covers without a username, so
  every request reads every finished row, and recent exceptions sort them all before the limit. Observed 2–50 ms
  over 154 finished rows; not measured at scale. An unparseable `start` or `end` silently becomes the default.
- Only finished transfers count, and **removed records are included**, so a retried file counts as a failure and a
  success.
- `summary` is `{Download: {<state>: stats}, Upload: {...}}`, keyed by the final state without `Completed`
  (`Succeeded`, `Errored`, ...). Stats are `{totalBytes (SUM(size)), count, distinctUsers, averageSpeed, averageWait, averageDuration}`,
  with durations in whole seconds. `histogram` gives the same per bucket, keyed by the bucket start. Starts align to
  multiples of the width since 1970, so it can return `buckets + 1` entries, and a `start` before 2020-12-30 means
  the oldest record.
- `GET /telemetry/reports/transfers/users/{u}` gives one user's history, all time by default: `{Upload, Download}`, each
  `{summary, statistics: {total, successful, errored, cancelled}, exceptions}`. `summary` is keyed like the one
  above, and `exceptions` is the top 25 of `exceptions/pareto`, `[{exception, count, distinctUsers}]`, cancellations
  included. `errored` only counts the keys `Errored`, `TimedOut`, `Rejected` and `Aborted` exactly. The username
  matches exactly, and one with a dot in it works (observed). Stock never calls it.
- `summary` and `leaderboard` average each transfer's speed, while `histogram` divides total bytes by total seconds
  (observed 16.7 against 3.39 MB/s over one window).
- `leaderboard` counts successes only, and its `sortBy` (`Count|TotalBytes|AverageSpeed`) and `sortOrder` are
  case-sensitive. `directories` counts successful **uploads** only. `exceptions` covers every other final state,
  cancelled included, keeps only the message after the first `": "`, and returns dates without the `Z`. Neither
  `leaderboard` nor `exceptions` caps `limit`.
- Stock's numbers inherit all this. "Downloaded" sums the full size of failed and cancelled transfers (on dev,
  1.4 GB of them against 709 MB that succeeded), "Distinct peers" adds the two directions' counts, and "Recent
  errors" times are shifted by the browser's UTC offset.

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
  directory** (`AppContext.BaseDirectory`); an absolute path fails validation at startup, and so does a missing
  directory. `devenv.nix` creates `dist` and computes the relative path.
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
- A dynamic `import()` becomes its own chunk in `static/`, and loads from beside the main chunk, so it follows the url
  base with nothing rewritten (observed: `/slskd/static/YamlEditor-….js`).
- An inline classic `<script>` in `index.html` survives both: Vite 8's build only scans it for `import()`, and slskd
  serves it unchanged (observed). slskd sends no `Content-Security-Policy`.
- A non-root `url_base` is additive: slskd answers at both `/api/...` and `/slskd/api/...`. At root,
  `GET /slskd/api/...` returns the SPA HTML with a 200 (other methods get 404), so a hardcoded path can hide.

## Search

Paths below are relative to `Search/` unless they start with another directory. `SN:` paths are Soulseek.NET
10.0.2, the version slskd pins.

### Records

- A search is
  `{id, searchText, token, state, isComplete, startedAt, endedAt?, responseCount, fileCount, lockedFileCount, responses}`
  (`Types/Search.cs`). Both dates are UTC **with** the `Z`. REST omits `endedAt` while it's null. `searchText` is
  stored normalised, with exclusions moved to the end (`"a -b c"` becomes `"a c -b"`).
- The states written are `Requested`, `Queued`, `InProgress` and
  `Completed, TimedOut|ResponseLimitReached|FileLimitReached|Cancelled|Errored` (`SN:SearchStates.cs`). A search ends:
  - when it goes idle: the timeout restarts on every accepted response, and total duration has no cap
    (`SN:SearchInternal.cs`)
  - at the response limit, or at the unlocked-file limit. Both are checked after a response is added, so the last
    one can overshoot. Locked files aren't capped.
  - on `PUT` (`Cancelled`), on any exception (`Errored`), and on a Soulseek disconnect (also `Errored`)
- A response is
  `{username, fileCount, files, lockedFileCount, lockedFiles, hasFreeUploadSlot, queueLength, uploadSpeed, token}`,
  with nothing null. A file is
  `{filename (full remote path), size, code, extension, bitRate?, bitDepth?, sampleRate?, length?, isVariableBitRate?, isLocked}`
  (`Types/File.cs`).
  - **`isLocked` is always `false`**, even in `lockedFiles`. Whether a file is locked is which list it's in.
  - The optional attributes are omitted when the peer didn't send them. `length` is seconds, `bitRate` kbps, and
    `sampleRate` the peer's raw value (Hz in practice). `uploadSpeed` is the peer's raw number, which stock
    shows as bytes per second.
  - Observed across 2,280 real result files from 37 users (the dev account's stored searches):
    - 1,536 files were lossless (bit depth and sample rate), but only 112 of those had a `bitRate`.
    - 125 had no attributes at all: mostly jpg, txt and nfo, but also 31 mp3 and 2 flac from peers that send none.
    - 311 of the 731 files with a `bitRate` had no `isVariableBitRate`.
    - Every file had either a quality attribute and a `length`, or neither.
  - Results aren't checked against the blacklist.

### Endpoints

- `POST /searches` takes
  `{id?, searchText, searchTimeout?, responseLimit?, fileLimit?, filterResponses?, minimumResponseFileCount?, minimumPeerUploadSpeed?, maximumPeerQueueLength?}`.
  A missing field gets Soulseek.NET's default, **not** what slskd's doc comments say: `searchTimeout` 15000 (**milliseconds**, idle),
  `responseLimit` 250, `fileLimit` 25000, `filterResponses` true, `minimumResponseFileCount` 1,
  `minimumPeerUploadSpeed` 0 and `maximumPeerQueueLength` `int.MaxValue` (`SN:Options/SearchOptions.cs`).
  - With `filterResponses`, a response is dropped before it's counted or stored if it has fewer files than the
    minimum, is slower than the minimum speed, or has a queue at or above the maximum.
  - It returns the record at once (usually `Queued` or `InProgress`) and runs the search in the background.
  - The errors are JSON strings: 400 for validation, including
    `"Search query must contain at least one non-exclusion term"`; 409 when not logged in to Soulseek; and **429
    while another POST is being handled** (`API/Controllers/SearchesController.cs`, a `SemaphoreSlim(1,1)` held for
    the whole request). Observed: three POSTs sent at once got three 429s between them before all three were created.
  - On a 400 or 409 the search is still stored and broadcast, as `Completed, Errored` with `endedAt = startedAt`
    and no responses (observed for 409).
- **At most two searches run at once** (`maximumConcurrentSearches: 2`, `Program.cs`). The rest wait in `Queued`,
  where the timeout isn't running yet.
- `GET /searches` returns every stored search with `responses: []`, with no pagination, filter or `ORDER BY`.
- `GET /searches/{id}/responses` (or `GET /searches/{id}?includeResponses=true`) returns the responses, **but only
  once the search has been finalised. Until then it returns `[]`.** They're held in memory while the search runs
  and written as one JSON blob at the end, so there are no partial results, except that stopping keeps
  what arrived. There's no pagination or compression, so a search at the limits is several MB.
- `PUT /searches/{id}` stops the search: 200 with an empty body, or 404.
- **`DELETE /searches/{id}` doesn't stop a running search** (`SearchService.cs`, `DeleteAsync`). It deletes the row
  and broadcasts `DELETE`, but the search keeps running and holds a slot until it goes idle, and its finalisation
  then fails. Stop first. Observed: a PUT, then waiting for the update that sets `endedAt`, then a DELETE logs no
  error, and the search is gone. There's no bulk delete.
- Searches persist across restarts in SQLite. Any that were running become `Completed, TimedOut` with zero
  counts, with no broadcast. `retention.search` (YAML only, minutes, minimum 5, off by default) prunes them every
  5 minutes by `endedAt`, broadcasting a `DELETE` for each. With it off, the list grows forever.
- Once logged in, other peers' searches arrive constantly. If no share scan has ever run (`no_share_scan`), each
  one logs a `no such table: filenames` warning, about 3,600 in the first two minutes (observed).

### Search hub

- On connect the caller gets `LIST`: every stored search, with `responses: []`. `CREATE`, `UPDATE` and `DELETE`
  carry the whole record without responses, keep nulls, and go to every client (`API/Hubs/SearchHub.cs`).
- A search sends `CREATE` as `Requested`, then an `UPDATE` on every state change and one as the POST returns.
  While responses arrive, the counts go out at most every 250 ms, and a pending one can be dropped at the end.
  The final `UPDATE` comes after the responses are saved (`SearchService.cs`, `StartAsync`).
- **The `Completed` state-change `UPDATE` arrives before the responses are saved, with `endedAt: null`**, so
  fetching then can return `[]`. `endedAt` is set only by finalisation, so "`isComplete` and `endedAt` set" means
  the responses are there, on every path (normal, stopped, errored at start, restart cleanup). The state-change
  broadcasts aren't awaited, so treat `Completed` as sticky rather than relying on order.

## Users

Paths are relative to `Users/`, and Soulseek.NET 10.0.2's source is `SN:`. `info` and `directory` ask the peer, `status`
and `endpoint` ask the server, and all of them are Soulseek actions. Not being logged in to Soulseek gives a 500 with the
message as a JSON string. A blacklisted user gets an empty 404 from all of them, `status` included, before anything is
asked. The blacklist check is by name only.

- `POST /users/{u}/directory {directory}` asks the peer for one folder. It waits up to 5 s, and that includes the
  endpoint lookup and connecting (a 500 when it expires). An offline user gets a 404 with a JSON string. It returns
  `[{name, fileCount, files: [{filename, size, code, extension, bitRate?, length?, ..., attributeCount, attributes}]}]`,
  usually with one entry. The file names are bare, so the full path is `directory + '\' + filename`. There's no locked
  section, and slskd peers send exactly one directory with no subfolders (`Application.cs`, `Shares/ShareService.cs`),
  so it can't rebuild the tree beneath a folder.
- `GET /users/{u}/info` returns `{description, hasFreeUploadSlot, hasPicture, picture?, queueLength, uploadSlots}`, and
  nothing caches it.
  - **One 5 s wait covers the endpoint lookup, connecting and the reply**: slskd never sets Soulseek.NET's 5 s message
    timeout, and the wait starts before the lookup (`SN:SoulseekClient.cs`, `SN:Common/Waiter.cs`). Expiring is a 500,
    `"The wait timed out after 5000 milliseconds"`.
  - A peer neither side can connect to is a 500, `"Failed to retrieve information for user X: Failed to establish a
direct or indirect message connection to X (ip:port)"`. An offline user is a 404 with a JSON string (observed:
    `"User X appears to be offline"`).
  - `picture` is the raw bytes as base64, with no type and no size limit, and is left out when there's none. Observed:
    our own username answers, with an 800×800 JPEG that Chromium draws from `data:image;base64,…`.
- `GET /users/{u}/endpoint` returns `{addressFamily, address, port}` (observed `"InterNetwork"`, always IPv4). A
  successful lookup is cached for 60 s and shared with browsing and transfers (`Common/UserEndPointCache.cs`). An
  offline user is a 404 with a JSON string.
- `GET /users/{u}/status` asks the server on every call, and returns `{isPrivileged, presence}` with `presence`
  `Online`, `Away` or `Offline`. An offline user is a 200 `Offline` rather than a 404, and so is a made-up name
  (observed), so the server can't tell them apart.
- Nothing else about other users is exposed. `UserService` has statistics, groups, watching and gifting privileges, but
  no route calls them, and `STATE.users` is never populated. The server's pushed status changes aren't exposed either
  (`Application.cs` leaves the handler a stub), so a user's online state can't be shown without a Soulseek action.

## Browse

Paths are relative to `Users/` unless they start with `SN:` (Soulseek.NET 10.0.2) or another directory. The
observations come from browsing one real peer: 168,159 files in 21,852 directories.

### Records

- `GET /users/{u}/browse` returns Soulseek.NET's `BrowseResponse` as is:
  `{directories, directoryCount, lockedDirectories, lockedDirectoryCount}` (`API/Controllers/UsersController.cs`,
  `SN:BrowseResponse.cs`). Its `ProducesResponseType` is wrong.
  - A directory is `{name, fileCount, files}`. A file is
    `{filename, size, code, extension, bitRate?, bitDepth?, sampleRate?, length?, isVariableBitRate?, attributeCount, attributes: [{type, value}]}`,
    the same attributes as a search file but with no `isLocked`. A locked file is one inside `lockedDirectories`.
  - The list is flat and in the peer's order, and Soulseek.NET adds nothing, so the tree is built client-side.
  - slskd peers (`Shares/ShareService.cs`) send `name` as the full path joined with `\`, a bare `filename`, an entry
    for every intermediate folder, an arbitrary order, and never any locked directories. Other clients can differ,
    which can't be checked from source.
- Observed:
  - `extension` was `""` on every file, so file types come from `filename`. `code` was always 1.
  - Directories, and the files within 2,232 of them, arrived unsorted.
  - The 9 roots were plain names (`tidal rips`, `CD Rips`), not drive letters or `@@` aliases.
  - One directory name ended in `\`, and its parent without the trailing `\` was missing.
  - 2,813 directories have a path segment starting with a space. Their parents exist, so it's real nesting and
    names mustn't be trimmed.
  - 43 pairs of directories differ only by case, and one pair only by Unicode normalisation. Key nodes by exact path,
    and give a collator sort a tie-break.
  - 41% of files had no attributes (mostly lrc and jpg). Every flac had them.
  - The biggest directory held 572 files, one held 1,489 subfolders, and the median held 3 files.

### Behaviour

- It's always a fresh request for the whole share. Nothing is cached or persisted server-side, no hub pushes anything
  about it, and there's no concurrency limit. The protocol can't list folders lazily.
- Errors:
  - A blacklisted user gets an empty 404 before any network action.
  - An offline user gets a 404 with the JSON string `"User X appears to be offline"`. For 60 s after a user goes
    offline, the cached endpoint gives a 500 connect failure instead (`Common/UserEndPointCache.cs`).
  - Not being logged in to Soulseek gives a 500.
  - **A peer that doesn't start replying gives a 500, `"The wait timed out after 60000 milliseconds"`** (observed).
    The 60 s `BrowseOptions.ResponseTimeout` covers the lookup, connecting and the peer composing its reply
    (`SN:SoulseekClient.cs`). Once data flows there's no overall cap: only 15 s without data fails it.
  - An slskd peer answers a blacklisted requester with an empty response, which looks the same as sharing nothing
    (`Application.cs`).
- **Aborting the request doesn't cancel the browse**: it's started without a cancellation token, and there's no cancel
  endpoint. The whole share is still transferred.
- **Two browses of the same user can cross results.** Soulseek.NET queues the waits per username, first in first
  out, and a failure faults the head of the queue (`SN:Common/Waiter.cs`). They also share one status entry.
- `GET /users/{u}/browse/status` returns Soulseek.NET's
  `{username, bytesTransferred, bytesRemaining, percentComplete, size}`, keyed case-sensitively by username
  (`BrowseTracker.cs`).
  - The bytes count the **zlib-compressed wire payload**. Observed: 3.0 MB on the wire became 38.9 MB of JSON.
  - It's an empty 404 until the reply starts arriving: 2.5 s in the successful browse, and the whole 60 s for the peer
    that never replied. It's a 404 again 5 s after success. **After a failure the entry is never removed**, so a later
    browse of that user shows the stale status until its own first update.
  - Progress events are raised on thread-pool tasks, so the percent can go backwards.
- The response has no compression and no `Content-Length` (it's chunked). The JSON escapes every non-ASCII character
  as `\uXXXX`, so the text is pure ASCII. An audio file costs about 240 bytes plus its name.
- Observed timeline: a 404 for 2.5 s, 100% at 9.5 s, the headers within 0.4 s of that, and the 38.9 MB body 169 ms
  later over localhost.
- Measured in headless Chromium 153 on that share: `JSON.parse` takes 146 ms, and the parsed data takes 37 MiB of
  heap (the text takes as much again while it's kept). Building the tree with recursive counts and sizes and a
  collator sort takes 23 ms.
- Stock caches browse results in IndexedDB (`slskd-browse` / `browse`) and `localStorage['slskd-browse-state']`.
  We share an origin with stock, so use different names.

## Rooms

Paths are relative to `Messaging/` unless they start with `SN:` (Soulseek.NET 10.0.2) or another directory. The
observations come from one throwaway room created on the dev account.

### Endpoints

Everything is under `/rooms` (`API/Controllers/RoomsController.cs`), returns 403 in relay agent mode, and takes its
body as a bare JSON string. The room name is a path segment, so encode it with `encodeURIComponent` (`%2F` works).
404s are empty, and every other failure is a 500 carrying the message as a JSON string. There's no concurrency limit
and no 429.

- `GET available` asks the Soulseek server every time, with no cache, and gives up after 5 s. It returns
  `[{name, userCount, isPrivate, isOwned, isModerated}]`, where `isModerated` means we're an operator. Observed: about
  700 rooms and 64 KB in 0.5–1 s, sorted case-sensitively by name (so every uppercase name before every lowercase
  one), with 0 to 1,328 users, and 433 rooms with 2 users or fewer.
- `GET joined` returns the tracked names as a bare `string[]`. `GET joined/{room}` returns
  `{name, isPrivate, operatorCount?, operators?, owner?, users, messages}`, and `GET joined/{room}/messages` and
  `.../users` return just the lists. They only read local state, and an untracked room is a 404.
- `POST joined` with the name is a Soulseek action that waits up to 5 s for the server.
  - It returns 201 with the room, whose `messages` is empty and whose `users` come from the server's reply, including
    ourselves with `self`. Observed: about 1.5 s. A room that's already tracked gets a 200 with an empty body.
  - **Joining a name that doesn't exist creates a public room** (observed), which then shows in `GET available`.
    slskd never sets the private flag, so it can't create a private room.
  - A refused join is a 500 (`"The server rejected the request to join room X"`): the 403 branch tests the inner
    exception, but Soulseek.NET throws it directly. No reply within 5 s is a 500 that says the room is probably
    already joined. Not being logged in and a blank name are 500s too.
- `DELETE joined/{room}` is a Soulseek action that waits up to 5 s, and returns 204, or 404 when it isn't tracked. The
  room is only untracked once the server acknowledges, so **while disconnected, or without a reply, it's a 500 and
  the room stays joined**.
- `POST joined/{room}/messages` with the text writes to the server without waiting, and returns an empty 201. An empty
  string is a 500, but whitespace passes. There's no length limit in slskd or Soulseek.NET.
- `POST joined/{room}/ticker` sets our ticker, and `POST joined/{room}/members` adds a user to a private room. Tickers
  can't be read (slskd subscribes to no ticker event), a ticker can't be cleared, and nothing else about private room
  membership or operators is exposed.

### Records

- A message is `{timestamp, username, message, roomName, self?}`, oldest first, with **no id**. `self` is `true` or
  omitted, from an exact comparison with our username.
- `timestamp` is when slskd handled the message (`DateTime.UtcNow`, with the `Z`), because the server sends none.
  Soulseek.NET raises each message on its own task, so messages arriving close together may be stored out of order
  (inferred).
- **Our own messages aren't stored as they're sent.** They arrive when the server echoes them back: observed after
  1–1.5 s, with `self: true`, in the order sent.
- A user is
  `{username, status ("Online"|"Away"|"Offline"), countryCode, averageSpeed, fileCount, directoryCount, uploadCount, slotsFree, self?}`.
  **The values are a snapshot** from the join reply or from that user's join notification, and nothing updates them.
  Another user joining or leaving only adds or removes them. Nothing is recorded as a message.

### Lifetime

- Rooms live in memory (`RoomTracker.cs`), keyed case-sensitively, and **each keeps its last 250 messages**
  (`Program.cs:772`). A restart loses them, and only the `rooms` option (`--rooms`, `SLSKD_ROOMS`) is joined again.
  `MessagingDbContext.RoomMessages` exists but is never used.
- Every received message not from a blacklisted user is also written to `events.db` as a `RoomMessageReceived` event,
  which is never pruned. `GET /events` can't filter by type.
- A Soulseek disconnect clears nothing: the rooms, messages and users stay, and the GETs keep working. On every login
  slskd joins the `rooms` option and then rejoins every tracked room (`RoomService.cs`), and failures are only logged.
  - The rejoin doesn't refresh the users, so users who left meanwhile stay listed and newcomers are missing.
  - A rejoin that fails leaves a room that can't be left until a restart (inferred).
- The blacklist only drops incoming messages; blacklisted users are still listed.
- The only push is `STATE.rooms` on the application hub: the joined names, updated on the server's join and leave
  notifications and not on disconnect. Observed: it still listed a room a few seconds after its DELETE returned, while
  `GET joined` was right at once.

## Private messages

Paths are relative to `Messaging/` unless they start with `SN:`. Everything is under `/conversations`
(`API/Controllers/ConversationsController.cs`), returns 403 in relay agent mode, and takes its body as a bare JSON
string. The username is a path segment.

### Records

- A conversation is `{username, isActive, unAcknowledgedMessageCount, hasUnAcknowledgedMessages, messages?}`, and a
  message is `{timestamp, id, username, direction ("In"|"Out"), message, isAcknowledged, wasReplayed}`. `username` is
  always the other party.
- Everything is kept in SQLite (`messaging.db`) with no retention, cap or delete. **Every endpoint returns at most the
  newest 100 messages**, oldest first, and there's no pagination, so older history can't be reached
  (`ConversationService.cs`).
- Incoming timestamps are the server's, in whole seconds, while sent ones are slskd's clock to 100 ns. Messages sort by
  timestamp alone, so a quick reply can sort above the message it answers, and messages that waited on the server
  while slskd was offline land by their original time.
- A sent message is stored after it's written to the server, with `id: 0`, `direction: "Out"` and
  `isAcknowledged: true`. So a key needs more than the id: `direction`, `id` and `timestamp` together work.
- Usernames compare case-sensitively. `.` and `..` can't be reached through any endpoint.
- Messaging our own username works: the server echoes it back within a second as an unread `In` message, next to the
  `Out` copy. Observed: the echo's whole-second timestamp sorted it above the message it echoed.

### Endpoints

- `GET /conversations` lists the active conversations, sorted case-sensitively by username, with no last-message time
  and no preview. `includeInactive` and `unAcknowledgedOnly` filter it. It loads every unread message in the database
  to count them, so it's cheap only while few are unread.
- `GET /conversations/{u}` (with messages unless `includeMessages=false`) and `GET /conversations/{u}/messages` only
  read local state, include closed conversations, and are an empty 404 when there's none. The unread count from
  `GET /conversations/{u}` only covers its 100 messages, so it can disagree with the list.
- `POST /conversations/{u}` sends.
  - It returns an empty 201 once the message is stored, so the next GET has it.
  - **It returns an empty 200 when the user is blacklisted, having sent and stored nothing.**
  - An empty body is a 400, but whitespace passes. Not being logged in is a 500.
  - Nothing comes back from the server, so sending to an offline or nonexistent user also gets a 201. There's no
    delivery or online status.
  - It activates the conversation before sending, so a failed send leaves an active conversation with no messages.
- `PUT /conversations/{u}` acknowledges all of its unread messages, `PUT /conversations/{u}/{id}` one, and
  `DELETE /conversations/{u}` acknowledges all and then closes it. Their 404s never fire, because the lookup isn't
  awaited, so an unknown user or id succeeds.

### Acknowledging

- slskd turns off Soulseek.NET's automatic acknowledgement, so a message stays unread until a UI acknowledges it.
  **Each acknowledgement sends MessageAcked to the server**, one per message. The server re-delivers a message at
  every login until it's acknowledged. The sender gets no read receipt.
- Acknowledging needs a Soulseek login: a PUT or DELETE with anything unread is a 500 while logged out.
- Acknowledging all also covers messages that arrived after the UI's last fetch.
- **Acknowledging a sent message by id fails**: they all have id 0, so with two or more of them the lookup throws a
  500 (`"Sequence contains more than one element"`).
- A re-delivered message matches its stored copy on `(username, id, timestamp)` and is set unread again, with
  `wasReplayed`, instead of being duplicated. It raises `PrivateMessageReceived` again, so the event log and webhooks
  get a duplicate at each login.
- Messages from blacklisted users are dropped before they're stored, with no event.

### Lifetime

- Closing only sets `isActive: false`. The history is kept, and an incoming message or a send reopens it. No endpoint
  opens a conversation without sending.
- Nothing is pushed, and `STATE` has nothing about conversations.

## Stock UI

Paths are relative to `slskd/src/web/src`.

- Routes, all under `urlBase` (`components/App.jsx:582`): `/dashboard`, `/searches/:id?`, `/browse`, `/users`,
  `/chat`, `/rooms`, `/uploads`, `/downloads` and `/system/:tab?` (`info`, `options`, `shares`, `files`, `data`,
  `events`, `logs`). Everything else, `/` included, redirects to `/dashboard`. Browse and users take their
  user from router state or localStorage, not the URL.
- The nav's connection item disconnects on a single click with no confirmation, and connects on a click while
  disconnected. There are no count badges; the footer shows transfer counts and `inProgress.averageSpeed` from the
  metrics hub.
- Theme: localStorage `slskd-theme` (`dark`/`light`), falling back to `prefers-color-scheme`. It never sets
  `document.title`.
- System (`components/System/`): `/system` redirects to `/system/info`, and every tab is always shown.
  - Info is a read-only YAML dump of the whole `STATE` with four buttons. Check for Updates ignores the response and
    shows no error. Get Privileges opens `http://www.slsknet.org/qtlogin.php?username=` with the name unencoded.
    Shut Down and Restart confirm, then fire and forget. Restart turns yellow while `pendingRestart`.
  - The nav reaches System through a cogs item on the right. A "Pending Action" item appears for `pendingRestart`,
    `pendingReconnect` or `shares.scanPending` and links to `/system/info` even for a rescan. A "New Version!" item
    opens a modal linking to the releases list.
  - After Restart or Shut Down, the hub's reconnecting replaces the whole app with "Lost connection to slskd", and
    after about 32 s of retries it asks for a refresh.
  - Logs keeps the newest 500 records, newest first, and each `BUFFER` replaces them. It shows the time (`HH:mm:ss` in
    the browser's time zone), the level and the message, with no source and no filter, and keys rows by timestamp.
  - Shares has two tables: the shares (host, local path, directories, files, alias, remote path), and the excluded
    paths. While a scan runs, both are replaced by a loader with the percentage.
    - Rescan turns yellow while `scanPending`, and Cancel replaces it during a scan. `cancelled`, `faulted`, the
      filters and the hosts are never shown.
    - It fetches `GET /shares` on mount and whenever `scanPending` or `scanning` changes.
    - A share's contents open in a modal as plain text, with no error handling. Names are built by string
      replacement, which mixes separators, and an alias that starts a file name removes it from the name.
  - Files has Downloads and Incomplete sub-tabs, and lists one level at a time with a `..` row. It shows name,
    modified time and size, and fetches on each navigation, with no polling.
    - While remote file management is on, each row has a trash icon with a confirmation.
    - Paths are encoded with `btoa` and not URL-encoded. So a character above U+00FF throws and the loader spins
      forever, Latin-1 accents send the wrong bytes (a 404), and a `/` in the base64 breaks the request.
    - After deleting it calls `window.fetch()` instead of refreshing, which throws.
  - Options shows `YAML.stringify` (`yaml` 1.10) of the hub's `OPTIONS` in a read-only CodeMirror, so its camelCase
    keys can't be pasted into the file.
    - Edit is disabled unless `remoteConfiguration`. It opens the file in a modal and validates on every keystroke,
      with no debounce and nothing against out-of-order answers. Save validates, PUTs and closes.
    - Debug View shows while the current `debug` and `remoteConfiguration` are on, although slskd checks `debug` at
      startup.
  - Data has two buttons that clear completed uploads or completed downloads.
  - Events shows 10 rows a page, counted from `X-Total-Count`, with the page in component state. The data is
    `JSON.stringify(…, null, 2)` in a cell that collapses its whitespace. There's no polling, filter or error handling.
- Transfers (`components/Transfers/`): one card per user, then one table per remote directory, all expanded,
  unsorted except by file name within a directory, with no filtering or virtualisation. Selection is per user
  card, with a select-all per directory. Per-file actions are a click on the state (retry when failed, queue
  position when queued), and bulk Retry/Cancel/Remove act on the selection or on "all errored/queued/succeeded"
  from the header. Nothing asks for confirmation. Retry sends one obsolete per-user POST per file in parallel,
  so most get 429 beyond two files. Uploads show a Retry for failed selections that would download the file
  from the peer instead.
- Search (`components/Search/`):
  - One route, `/searches/:id?`. The list comes only from the search hub. It shows every search newest first, with a
    state icon, text, files, locked, responses, the end time (time only), and Stop (running) or Delete (finished).
    There's no bulk action and no list filter.
  - Creating sends `{id: uuidv4(), searchText}` and nothing else. Enter stays on the list, and the search button
    opens the results. The box is disabled while the server is disconnected.
  - Results are fetched once, 500 ms after `isComplete`, which works around the race in
    [Search hub](#search-hub).
  - Results show one card per user, with a table per folder. The cards are sorted by upload speed (the default)
    or by queue length, and revealed 5 at a time without virtualisation.
  - Toggles: hide locked (on by default), hide no free slot, and fold. A ✕ hides a user.
  - Selection is per card, and a filter change drops it.
  - Downloading POSTs the obsolete `downloads/{username}` once per card, without `searchId` or a destination.
  - "Search for Additional Files in This Directory" sends `POST users/{u}/directory`, keeps element `[0]`, and
    prepends `directory\` to its bare file names. The fetched files bypass the filter.
  - Nothing is stored in localStorage.
- Browse (`components/Browse/`):
  - It's reached from the nav, or from a Rooms message's context menu through router state. The user is never in the
    URL.
  - Only the last user is cached, in IndexedDB under the key `current`, with no age shown. Refreshing means clearing
    and typing the name again. There's no cancel, and leaving mid-browse loses the result.
  - The tree takes its separator from the first unlocked directory name and makes orphans roots. It's virtualised
    and unsorted. Its filter matches folder leaf names only.
  - The file pane lists child folders (with recursive totals), then the folder's files. A selection is capped at
    5,000 files.
  - Download groups the selection by first-level subfolder, one batch each with `destination = <selected>/<child>`,
    so deeper levels are flattened. The folder's own files go through the obsolete per-user POST.
- Rooms (`components/Rooms/`):
  - Joined rooms are tabs. It polls `GET rooms/joined` at 2 Hz, and the open room's messages and then its users at
    1 Hz, without waiting for the previous request. The open room is kept in sessionStorage `slskd-active-room`.
  - Joining is only from the available list, in a modal, so a room can't be created or typed. A failed list leaves
    the modal spinning. Leaving has no confirmation.
  - The user list shows a flag and the name. Right-clicking a message offers Reply, User Profile and Browse Shares,
    which pass the user through router state on paths that ignore `urlBase`.
  - Nothing handles errors or the Soulseek connection.
- Chat (`components/Chat/`): it polls `GET conversations` every 5 s and, on the same tick, acknowledges the open
  conversation if it has unread messages and then fetches it. Tabs show unread counts, and there's no nav badge.
  Starting a conversation takes a username and a first message together. The open conversation is kept in
  sessionStorage `slskd-active-chat`.
- Users (`components/Users/`):
  - It's reached from the nav, or from a Rooms message's User Profile through router state. The user is never in the
    URL.
  - A username box. Submitting sends `info`, `status` and `endpoint` together, and any one failing fails the whole
    lookup with "Failed to retrieve information for X".
  - It shows the picture (`data:image;base64,…`), presence, free slot, upload slots, queue length, IP, port and the
    description. The free slot always shows a tick, because `hasFreeUploadSlot` is passed as a bare JSX prop, which
    means `true`.
  - The last user is kept in localStorage `slskd-active-user` and looked up again whenever the page mounts.

### Search filter syntax

Stock's result filter (`lib/searches.js:40-190`). We replaced it with a Filters popover (see
[Search](design.md#search)):

- The text is lowercased and split on single spaces. Numeric tokens are found anywhere in the text, with no word
  boundary, and only the first match counts:
  - `minbr:`/`minbitrate:` (kbps)
  - `minbd:`/`minbitdepth:`
  - `minfs:`/`minfilesize:` (bytes, although the placeholder suggests otherwise)
  - `minlen:`/`minlength:` (seconds)
  - `minfif:`/`minfilesinfolder:`
- `isvbr`, `iscbr`, `islossless` and `islossy` are substring tests too, so `-isvbr` also turns `isvbr` on.
- Every other term is an include, or an exclude with a leading `-`. Any term containing `:` is dropped silently.
  There are no quoted phrases, no OR and no escaping. `iscbr|isvbr` in the placeholder sets both flags and adds a
  literal include term.
- The filter applies per file, separately to `files` and `lockedFiles`:
  - Include terms are ANDed and exclude terms are ORed, as substrings of the lowercased **full path**. The
    username isn't matched.
  - A lone `-` makes an empty exclude term, which hides everything. A double space makes an empty include term,
    which matches everything.
  - Numeric minimums pass a file that lacks the attribute.
  - `isvbr`/`iscbr` reject a file whose `isVariableBitRate` is missing. `islossless` needs both `sampleRate` and
    `bitDepth`, and `islossy` needs neither.
- `minfif:` counts the whole response, not a folder. When it rejects a response, it leaves the counts alone, so
  the user still shows as an empty card.

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
  - `<Link search>` and `navigate` are typed from the schema's _input_, so a param is only optional for them if
    it's optional in the input. With Valibot that's `v.optional(v.fallback(schema, d), d)`; `v.fallback` alone
    leaves it required. ArkType has no fallback for invalid values, so `?show=bogus` renders the error page.
  - The router writes validated defaults into the URL (a Link to `/downloads` lands on `/downloads?show=all…`)
    unless the route has `search: { middlewares: [stripSearchParams(defaults)] }`, which also drops invalid
    values on load. The middleware has to be written inline in `createRoute` for its type to be inferred.
  - The validator also runs on its own output, so a transform would be applied twice; keep outputs valid
    inputs (sort values stay strings like `size.desc`).
- `head` + `<HeadContent />` sets `document.title` in a client-only SPA. The title goes in
  `meta: [{ title }]`, and the deepest match wins.
- A redirect thrown from `beforeLoad` replaces the history entry.
- `useMatchRoute()` defaults to `fuzzy: false`. `<Link>` `activeOptions` default to a segment-prefix match
  with `includeSearch: true`.
- Unmatched paths render `defaultNotFoundComponent` or the nearest route's `notFoundComponent`
  (`notFoundMode: 'fuzzy'`); leaf routes can't handle not-found. Without either you get `<p>Not Found</p>`.
- Preloading and scroll restoration are off by default, but `window` scrolls to the top on navigation.
- `lazyRouteComponent(importer, name)` gives a component with a `preload`, which the router awaits as it loads the
  match, so the page being left stays up until the chunk is in (`lazyRouteComponent.tsx`, router-core's
  `load-client.ts`). An import that fails as a missing module, as after a newer build replaced it, reloads the page
  once, remembered in sessionStorage by the error's message. Any other failure goes to the route's error component.

## Radix Themes

Checked against the `@radix-ui/themes` 3.3.0 package source.

- `appearance` is `'inherit' | 'light' | 'dark'`. There's no system mode, and no Radix CSS uses
  `prefers-color-scheme`. `inherit` with no `.dark` ancestor is light.
- An explicit appearance puts `light`/`dark` on the `Theme` element and sets `color-scheme` on `:root` through
  `:has([data-is-root-theme='true'])`, so only once React has rendered. Portalled content (menus, tooltips,
  popovers, dialogs) is wrapped in a nested `Theme` and inherits the appearance.
  - That rule is `:root:where(:has(...))`, so it outranks `<meta name="color-scheme">`, which only applies while the
    root's `color-scheme` is `normal`. Observed: with the meta rewritten to `light`, picking dark made the root dark.
    An inline style on `<html>` would outrank the rule instead.
  - The root `Theme` keeps `appearance` in state and copies a changed prop over in a `useEffect`, so the first render
    uses the prop as given and a change lands one render later (`components/theme.js`).
- `TabNav.Link asChild active` is the documented way to render router links. `active` sets `data-active` and
  `aria-current="page"`. The child's children are wrapped in inner spans and **the label renders twice** (once
  hidden, to reserve its bold width), so keep stateful components and `id`s out of it. A `Badge` inside works
  but needs its own margin.
- The root `Theme` provides a `Tooltip.Provider` with a 200 ms delay.
- `DropdownMenu.Trigger` and `Dialog.Trigger` always render with `asChild`, so their child must be one element that
  takes a ref.
- `SegmentedControl.Item` always passes `disabled: false`, so an item can't be disabled, and its label renders twice
  like `TabNav.Link`'s. **A `Tooltip` around an item breaks the selection**: the trigger's own `data-state` replaces
  the item's `on`, so no item looks selected (observed). The tooltip has to go inside.
- A `DropdownMenu.CheckboxItem` or `RadioItem` closes the menu when picked unless its `onSelect` calls
  `preventDefault()`. A radio item still changes the value then (`@radix-ui/react-menu` 2.1.24 runs its own handler
  with `checkForDefaultPrevented: false`).
- The breakpoints are min-width queries: xs 520, sm 768, md 1024, lg 1280 and xl 1640 px (`styles/breakpoints.css`).
  Responsive props take an object keyed by them, mobile first.
- **`Popover.Content` has a default `maxWidth` of 480 px** (`popover.props.tsx`), and nothing caps a popover to the
  screen, while menus and selects are capped to the available height. The primitive sets
  `--radix-popover-content-available-width` and `-height` on the content element (observed: 340 px on a 360 px screen,
  with the 10 px collision padding).
- Its own hover styles are inside `@media (hover: hover)`, so a tap doesn't leave one stuck.
- The `TabNav` list scrolls sideways with its scrollbar hidden (`_internal/base-tab-list.css`), and nothing scrolls the
  active tab into view.
- `DropdownMenu.Item` takes `asChild`, but `DropdownMenu.RadioItem` doesn't.
- Text fields of size 1, 2 and 3 are 24, 32 and 40 px high with 12, 14 and 16 px text. Menu and select items are 24 px
  at size 1 and 32 px at size 2, through `--base-menu-item-height` and `--select-item-height`.
- **Tooltips never open from touch** (`@radix-ui/react-tooltip` 1.2.16, `TooltipTrigger`): a touch pointer's move is
  ignored, focus that follows a pointer press doesn't open it, and a click closes it.
- next-themes 0.4.6, which the Radix docs recommend, is mostly unmaintained. Its anti-flash script does nothing
  when rendered client-side only (React 19 doesn't run rendered `<script>`s) and logs a warning in dev.

## TanStack Table

Checked against `@tanstack/react-table`/`table-core` 9.2.4 (stable since August 2026) from the package source
and its bundled docs (`skills/`).

- `useTable({ features, columns, data, ... })` replaces `useReactTable`. Every feature and row model is
  registered in `tableFeatures({...})` (row models are "slots" next to their feature), otherwise its state and
  methods don't exist.
- Row models memoise on their inputs by identity: the core model on `data`, sorted on `[sorting, input]`,
  expanded on `[expanded, input]`. **Any new `data` array rebuilds every `Row` object**; there's no reuse by
  `getRowId`, which only keeps id-keyed state (selection, expansion) stable. So memoise row components on
  `row.original`, not `row`. Measured (Node, 20k rows, one row changed): about 9 ms with no sorting, 25 ms
  sorting numbers, 41–91 ms sorting strings with the built-in `text`/`alphanumeric` functions.
- One table takes one `data` array; two arrays mean two tables (or a concatenation that rebuilds on either).
- `getSubRows` gives parent rows with their own `original`; sorting sorts each level by the column's accessor.
- **The expanded row model returns its input unexpanded while the `expanded` state is empty**, and
  `getIsRowExpanded` isn't one of its memo inputs. "Expanded by default" therefore needs every id spelled out
  in the state (observed: groups showed as expanded with no children). Expansion auto-resets whenever the core
  model changes unless `autoResetExpanded: false`.
- `row.getToggleSelectedHandler(opts)(event)` reads `event.target.checked` and, for Shift, `event.shiftKey`
  (`isRowRangeSelectionEvent`). A Shift event selects the inclusive range from the table's last handled row in
  display order, and `selectChildren` (default true) includes collapsed children. `toggleAllRowsSelected` only
  adds or deletes the table's own row ids and leaves any other ids in the state alone.
  `getIsSomeRowsSelected()` means "at least one", including when all are. It counts the ids in the state, so it
  stays true after the selected rows leave `data` (observed after deleting them), while `getSelectedRowModel()`
  only returns rows still in the model.
- `useTable` returns a new table object whenever its options object changes, which in practice is every render.

## TanStack Virtual

Checked against `@tanstack/react-virtual` 3.14.13 / `virtual-core` 3.17.11.

- With fixed row heights, give exact sizes in `estimateSize` and don't use `measureElement`. Measurements are
  recomputed when `count` or `getItemKey`'s identity changes, not when `estimateSize` changes.
- Observed in dev under StrictMode: a `scrollToIndex` in a layout effect on mount, guarded by a ref so it runs only
  once, left the list at the top. Keyed on what it reveals, so StrictMode's second pass runs it again, it scrolls.
- `rangeExtractor` can force extra indexes into the rendered range, which is how a sticky header is kept
  rendered after it scrolls past (render it `position: sticky` instead of absolutely positioned).

## IndexedDB

Measured in headless Chromium 153 with an on-disk profile (Playwright's `launchPersistentContext`) on a synthetic
share of 200k files in 15k directories (54 MB of JSON), with `idb` 8.0.3. "Blocks" is the longest main-thread task.

- Chromium Snappy-compresses values of 64 KB or more synchronously inside `put()`, but not Blobs
  (`idb_value_wrapping.cc`).

  | Stored as                                      | Write blocks         | Read (with parse) blocks | On disk |
  | ---------------------------------------------- | -------------------- | ------------------------ | ------- |
  | The parsed object graph                        | 330 ms               | ~400 ms, one task        | 7.7 MB  |
  | A Latin-1 JSON string                          | 102 ms               | 214–239 ms               | 8.4 MB  |
  | A Blob, read with `blob.text()` + `JSON.parse` | 0 ms                 | 174–319 ms               | 54 MB   |
  | One record per directory                       | ~1 s (3 s to commit) | 254–275 ms               | 21 MB   |

  Building a Blob from a string costs 200–290 ms, but `response.blob()` doesn't block.

- Private windows (and Playwright's default `newContext()`) keep IndexedDB in SQLite in memory: nothing is compressed,
  and `put()` fails above 133,169,152 bytes (`idb_transaction.cc`). Chromium is also rolling SQLite out on disk
  (`IdbSqliteOnDiskRollout`). Firefox caps a structured clone at 1042 MB.
- Quota ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)):
  Chrome allows 60% of the disk, and Firefox's best effort is 10% of the disk or 10 GiB. Eviction deletes an origin's
  data all at once, least recently used first, so it takes stock's data with ours. `navigator.storage.persist()` is
  decided by engagement in Chrome (it returned `false` headless), prompts in Firefox, and is decided automatically
  in Safari.
- `idb` 8.0.3 (May 2025) is 1.4 KB, with a typed `DBSchema` and manual upgrades. `idb-keyval` allows only one store
  per database. Dexie 4.4.6 is 32.6 KB.

## Browser APIs

- Chromium keeps a failed dynamic `import()` in its module map: importing the same URL again fails at once, without a
  request (observed in Chromium 153).
- Web Locks (`navigator.locks`) needs a secure context
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)), so a plain-HTTP LAN install can't use it.
  `BroadcastChannel` doesn't.
- Since Chrome 108 the on-screen keyboard resizes only the visual viewport, so the layout and viewport units such as
  `dvh` keep their size. `interactive-widget=resizes-content` in the viewport meta makes it resize the layout viewport
  and the units again. Safari only ever resizes the visual viewport
  ([Chrome](https://developer.chrome.com/blog/viewport-resize-behavior),
  [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport)).
- A pseudo-element sticking out of a button counts toward its scroll container's overflow. Observed: a hit area 6 px
  past a ghost button near the edge made the chat sidebar scroll sideways by 2 px.

## Headless Tree

Checked against `@headless-tree/core`/`react` 1.7.0 (May 2026). It has no virtualiser of its own and is built to sit
on `@tanstack/react-virtual`. It provides the ARIA tree pattern with keys. With proxied instances it rebuilds its flat
list on every expand or collapse: 36 ms at 17k nodes in Node 24. It declares any React version, but its own docs
run React 18.

## yaml

Checked against `yaml` 2.9.1.

- `parseDocument` collects every error in `document.errors` without throwing. Each has a `code` and `pos: [start, end]`
  offsets. `prettyErrors: false` keeps the message to one line, and a `LineCounter` gives 1-based lines and columns.
  A repeated key is a `DUPLICATE_KEY` error by default.
- `visit` walks nodes in document order and says whether a scalar is a pair's `'key'` or `'value'`. A parsed scalar's
  `range` is `[start, valueEnd, nodeEnd]`, and its `type` is `'PLAIN'` when it's unquoted.
- With `version: '1.1'`, stringify quotes strings that YAML 1.1 would read as something else, such as `"on"` and
  timestamps. `lineWidth: 0` stops long strings from folding. A comment set on a node's `comment` is written after its
  value on the same line.
- Stringify and parse together come to about 94 kB minified and 34 kB gzipped.

## CodeMirror

Checked against `@codemirror/view` 6.43.13, `lang-yaml` 6.1.3, `lint` 6.9.7 and `search` 6.7.2.

- **Only the lines near the viewport are in the DOM**, so the browser's own find can't reach the rest. Observed: 54
  lines of a 335-line file were rendered, and `window.find` missed the last one. `@codemirror/search` searches the
  document.
- CodeMirror leaves Tab to the browser unless it's bound. With `indentWithTab`, Escape then Tab still moves focus out
  (the Tab example in its docs).
- `lang-yaml` tags keys `definition(propertyName)`, quoted strings `string` and every unquoted value `content`, so
  numbers and booleans can't be coloured apart from plain strings.
- `setDiagnostics` sets lint results from outside the editor, with no `linter` source.
- `EditorView.theme` takes CSS variables, so the editor can use Radix's tokens. Its `dark` option only adds
  `EditorView.darkTheme.of(true)`, which picks the base themes' `&dark` rules over `&light`. That facet in a
  `Compartment` switches them in an open editor (observed).
- The editor, the YAML mode, lint and search come to about 123 kB gzipped.

## filesize

Checked against `filesize` 11.0.24. `{ base: 2, standard: 'iec', round: 1 }` gives `"3.2 MiB"` and rolls over at
unit boundaries (`1048575` → `"1 MiB"`). `output: 'exponent'` returns the unit exponent, and `exponent` forces
one, which is how `"3.2 / 10.5 MiB"` is built.
