# Build plan

An alternative web UI for slskd, shipped as a drop-in replacement for its `wwwroot` and run against
stock slskd. `../slskd` is read-only. We reimplement the stock UI's functionality one piece at a time.
Verified behaviour of slskd and the libraries we rely on is in [facts.md](facts.md).

Stack (fixed): React, strict TypeScript, Vite, Radix Themes, ky, `@microsoft/signalr`, TanStack Table v9,
TanStack Virtual v3, TanStack Router. Smaller helpers: Valibot (search params), `filesize`, `p-map`, `idb` and
Radix Icons. Each dependency is added in the phase that first uses it.

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

- We share an origin with stock, so everything we persist is prefixed `slskd-alt`: the localStorage keys
  `slskd-alt-token` and `slskd-alt-result-filters`, the IndexedDB database `slskd-alt` (see [Browse](#browse)), and
  the `BroadcastChannel` `slskd-alt`.

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
  as soon as it's visible again. The next tick is only scheduled once the last one finishes, so network time
  paces the loop by itself.
- **The poll interval is floored at 10× the last tick's main-thread cost**: each tick times its synchronous work
  (`JSON.parse` of `response.text()` plus the merge) and waits `max(interval, 10 × cost)`. That caps it at
  about 10% of the main thread, where stock out-polls it. Freshness thresholds use the effective interval.
- The work stays on the main thread; a one-off check at 20k rows didn't justify more. If it ever does, a worker
  fetches, parses and diffs, and posts only the changes.
- List polls have no timeout: uncompressed, a heavy list takes about 10 s over a 3 Mbit/s link. Unmounting
  aborts them. Other requests keep ky's 10 s.
- A failed tick keeps the last good data and never blanks the screen.
- A stopped resource keeps its snapshot, so coming back to a page shows the last data with its age at once.
  Every resource snapshot and module-level atom is cleared when the session ends.
- `refresh()` polls at once; actions call it when they settle. `watch` reads a resource without starting it.
- Hub pushes (application `STATE`, search metadata, metrics) feed the same store. The hubs use
  `@microsoft/signalr`.
- Hubs send their snapshot (`STATE`, `LIST`) only as they connect, and stay connected for 2 s after their last
  subscriber leaves. So a resource that starts while its hub is still connected (after a quick log out and in, or
  when leaving the search pages and coming back) fetches the same snapshot over REST: `GET /application` or
  `GET /searches`.
- Soulseek server state is one resource: `STATE` while the application hub is connected, otherwise
  `GET /server` every 2 s, including during the initial connect.
- Payload types are hand-written and cover only the fields we read. OpenAPI is a poor source (see the facts).

### Array identity

**Array identity is load-bearing.** TanStack Table's core row model memoises on the identity of the `data`
array, and a fresh array rebuilds every row (9–91 ms at 20k rows depending on the sort, see the facts). So we
**split transfers on mutability**: active rows and terminal (`Completed, *`) rows live in separate arrays.
Each poll is merged into the existing arrays rather than replacing them.

Correction to the original premise: a terminal transfer *almost* never changes, but it can (auto-retry
reuses the id, failures flip states, and a failed move adds an `exception`; see the facts). So the merge
doesn't assume immutability. It compares each incoming row with the existing one on every field that can
still change (`state, attempts, exception, enqueuedAt, startedAt, endedAt, bytesTransferred, averageSpeed,
placeInQueue`) and reuses the old object when nothing changed. Computed fields aren't mapped, because
`elapsedTime` changes on every poll. Rows are grouped by folder · user within each array, and a group object is
reused when its files are, an array when its groups are, and the whole snapshot when both arrays are. A row that
leaves `Completed` moves back to the active array. In practice the terminal array's identity changes rarely, and
a poll with no changes returns the same snapshot, so nothing renders.

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
- Paths match stock's: `/searches`, `/searches/$id`, `/downloads`, `/uploads` and `/browse`. `/` redirects to
  `/searches` from `beforeLoad`, replacing the history entry.
- Search params are plain strings (`URLSearchParams` both ways), validated with Valibot:
  `v.optional(v.fallback(schema, default), default)`, so Links can omit them and invalid values fall back.
  Routes add `stripSearchParams(defaults)`, which keeps defaults and invalid values out of the URL. Params that
  change as you type or click replace the history entry.
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
  and by up to a whole batch while it's being enqueued (see the facts). While the downloads list is fresh (the
  Downloads page is open), the badge shows the list's exact count instead and drops "About".
- The Soulseek indicator shows unknown / connected as the user / connecting / retrying at a time /
  disconnected. Its popover has the server address, the data source and its age, the last poll error, a
  `pendingReconnect` note, and Connect, Retry now + Stop trying, or Disconnect. Connect is only offered while
  disconnected, because `PUT /server` while connected leaves slskd's retry timer running.
- Hub health has no indicator of its own in the bar, since two status dots side by side looked wrong. The
  Soulseek popover lists each hub with its retry count; the search hub only runs on the search pages and reads
  "not in use" elsewhere. At a glance, the badge grays while the metrics hub is
  down, and the popover's source line reads "hub down, polling" while the application hub is.
- Log out has no confirmation and is hidden on open instances.

### Transfers

Downloads and Uploads are one page component, parameterised by direction.

- **Layout.** One virtualised scroll: an Active section (anything not `Completed`) above a Finished section.
  Each has a sticky, collapsible header with its counts, section actions and column headers, and each is its own
  TanStack table, so the two arrays are never concatenated. One virtualizer maps its indexes onto both tables'
  row models. Rows have a fixed height and `contain: strict`, which makes scrolling far cheaper (see phase 5).
- **Groups.** Rows are grouped by folder · user (the list's own grouping), one level deep: groups are parent
  rows with the files as sub-rows. A folder with both live and finished files appears in both sections, and its
  status counts the whole folder ("8/12 done · 1 failed"). Active groups start expanded and finished ones
  collapsed, and toggles are kept in memory.
- **Columns.** Checkbox, Name, User, Status, Size, Speed (Active only), Requested or Ended, then per-row actions
  and an ⓘ popover with every field. Group rows add Browse user. States are coloured like stock (blue in progress, green succeeded, gray
  queued, amber once retried, red failed), with the exception on hover. Sizes are IEC (KiB, MiB).
- **Sorting.** Clicking a header sorts in the column's natural direction first (text A→Z, numbers and times
  largest or newest first), then reversed, then back to the default order: newest group first, files by name.
  One column at a time, per section. Groups sort by their aggregate and files within their group; names sort
  naturally. Sorts re-apply on every poll.
- **URL.** `q` (the filter: a case-insensitive substring of user + full path), `show` (`all`, `succeeded` or
  `failed`, Finished only), `activeSort` and `finishedSort` (like `size.desc`).
- **Selection.** Checkboxes on files and groups, Shift ranges, a select-all per section, and a click on a file
  row toggles it. It spans both sections and is lost when you leave the page. The toolbar acts on it: Retry N
  (failed downloads), Cancel N (active) and Remove N (finished).
- **Section shortcuts.** Cancel all, Retry failed, and Clear finished (`DELETE all/completed`). They act on the
  whole section, whatever the filter, and they're the only actions that ask for confirmation.
- **Retry** enqueues one batch per user and old batch, copying the old batch's `searchId` and `destination`,
  one POST at a time. A 429 is resent every second for up to 30 s, because slskd did nothing. The outcome is
  reported per user (offline, not logged in, per-file failures).
- **Queue positions** are looked up per row, or per group one file at a time, and shown with their age.
- **Running actions** send DELETEs at most 4 at a time, mark their rows pending, show progress on their button,
  poll as soon as they settle, and leave one dismissable outcome line in the toolbar. They run at module level,
  so they survive navigation, and ending the session aborts them.
- **Uploads** have no retry, queue positions or attempts, and no badge.

### Search

`/searches` has the search box and the list of searches. `/searches/$id` is one search's results at full width.

- **The list** comes from the search hub: `LIST` on connect, then `CREATE`, `UPDATE` and `DELETE`. While the hub
  isn't connected, it polls `GET /searches` every 2 s instead, like the Soulseek resource. Records are mapped to flat
  objects, and an update reuses the unchanged ones. Each toolbar shows the list's freshness, and Stop and Delete are
  gated on the list being known: the hub is connected, or the last poll is within the amber threshold.
- **Creating.** Enter POSTs `{searchText}` with slskd's defaults and no options, then opens the results. slskd picks
  the id, because `crypto.randomUUID` needs a secure context and plain-HTTP LAN installs aren't one. The returned
  record goes straight into the list, which would otherwise miss it until the next poll while the hub is down. A
  429 means another POST held slskd's lock, so it's resent every second for up to 30 s. It's gated on Soulseek, and
  errors show inline under the box, keeping the text. The results page has Search again, which creates a new search.
- **The list page.** Columns: state, text (a link to the results), responses, files (+ locked) and started. Newest
  first, with `q` filtering the text. Stop while running, and Delete always. A DELETE alone leaves the search
  running and holding one of slskd's two search slots, so Delete stops a running search first. Delete N acts on
  a selection, 4 at a time.
- **Results** load once, on the first update with both `isComplete` and `endedAt` set, because the `Completed`
  update arrives before the responses are saved. They never change afterwards. The parsed results of the 3 most
  recently opened searches stay in memory. While the search runs, the page shows its state, its live counts and Stop.
  An unknown id shows "No such search" once the list is known.
- **Table.** One virtualised TanStack table grouped by folder · user, collapsed by default, with Expand all.
  Columns: checkbox, Name (a group shows its folder's last two segments), User, Files, Size, Quality, Length, Speed
  and Queue, then Download, Get full folder, Browse user (groups only) and ⓘ.
- **Sorting** works like Transfers: groups sort by their value and files within their group, so groups never
  interleave. A group's Quality is its worst file's among those with attributes (cover art has none), lossless
  ranks above lossy, and a file with no attributes ranks lowest. Queue reads "free" for a free upload slot,
  otherwise the queue length, and sorts a free slot first whatever the queue length says. The default order is
  Queue, then fastest, then folder name.
- **Filtering.** The text box ANDs whitespace-separated terms, each a case-insensitive substring of user + full
  path, and `-term` excludes, as in the search box. Everything else is in a Filters popover whose button counts
  the active ones:
  - quality at least: Any, 128–320 kbps, Lossless or 24-bit lossless, on the Quality ranking
  - min file size (MiB), min length (minutes) and min files per folder, as number fields
  - Free slot only

  Stock packs these criteria into the text box as a syntax (see the facts). We dropped it, because its keywords
  collide with path text and can't be discovered. Criteria judge files that have attributes. Files without
  attributes (cover art, logs, and everything from peers that send none) ride along while their folder still shows
  a file that has them: a quality filter keeps an album's cover but hides a folder of attribute-less mp3s. Min
  files counts a folder · user group's shown files that have attributes. A group that lost files to the filter
  reads "10 of 12" in Files, so a partial album never looks whole.
- **URL.** `q`, `sort`, `locked=show`, and the popover's `quality`, `size`, `length`, `files` and `free=only`. Locked
  files are hidden by default, and when shown they're dimmed and can't be selected. The popover's values are saved
  to localStorage whenever they change. A results page opened with none of them in its URL gets the saved values
  written in, replacing the history entry, so a quality preference carries over. Clear resets them and forgets the
  saved values.
- **Downloading.** Select anything, then press Download N (size). It sends one `POST transfers/downloads/batches` per
  user, carrying `searchId`, one POST at a time, with the same 429 resend as retry. It's gated on Soulseek. The action
  runs at module level, per search, and leaves an outcome line reporting each user's failures. Rows show Enqueued or
  Failed from the responses, and their own Download buttons wait while one runs. We never read the downloads list
  here.
- **Get full folder** sends `POST users/{u}/directory` on click. The folder's other files join its group marked "not
  matched". They bypass the filter but count towards min files, and they're kept with the search's cached results. A
  failure shows on the group row.

### Browse

`/browse` is the landing page. `/browse?user=X` is one user's share, with `path` (the selected folder's full remote
path), `q` and `sort`.

- **The landing page** has the username box, Browse and the bytes stored. Running browses come first with their
  progress, then the cached shares, newest fetch first: User (a link), Folders, Files, Size, Locked and Fetched, with
  Re-browse and Delete (no confirmation, no bulk). A failed browse of a user with no cache stays as a row with its
  error and Browse again until it's dismissed. The Browse tab always lands here.
- **Opening a user.** Enter or Browse opens the cached share at once, and only browses when there's no cache. Re-browse
  is the only way to refetch. A share page loaded from the URL without a cache (a reload, Back, a pasted link) shows
  "Not browsed yet" and a Browse button. Changing user pushes a history entry, and folder, filter and sort changes
  replace it. The title is "X · Browse · slskd".
- **Browse user** is an icon on the group rows of search results and both transfer pages. It opens the share at the
  row's folder, and the click counts as the gesture, so it browses a user who isn't cached. The icon is never gated;
  the page's Browse button is.
- **Browsing.** A browse runs at module level, so it survives navigation, and ending the session abandons it. There's
  no Cancel, because aborting doesn't stop slskd (see the facts). A tab runs at most one browse per user ("Already
  browsing X"), and different users run in parallel. Two tabs browsing the same user at once is an accepted gap,
  although slskd can cross their results. Browsing is gated on Soulseek; viewing a cached share isn't.
- **Progress** has four phases: waiting for the peer (while `browse/status` is a 404, up to 60 s), receiving from the
  peer (compressed bytes with a bar, polled every 500 ms), loading from slskd (bytes so far, since there's no
  `Content-Length`) and processing. A status equal to the one read just before starting is ignored, because a failed
  browse leaves its last status behind. Progress replaces the tree when nothing is cached, sits above a cached tree
  while re-browsing (the tree stays usable), and shows on the landing page's row.
- **Outcomes.** A success replaces the cache and any open page. `path` stays (or falls back to its nearest ancestor),
  expansion stays where the folders still exist, the filter stays, and the selection is dropped. A failure keeps the
  old tree and shows the error inline: "X appears to be offline" (404) or "X didn't respond within 60 s" (the timeout
  500). An empty share reads "X shares nothing (or has blocked you)".
- **The tree** is built from the flat list. The separator is `\` unless the share's paths use `/`. Missing parents are
  synthesised, where stock makes orphans roots. Locked directories join the same tree, dimmed with a lock icon, and
  their files can't be selected. Nodes are keyed by exact path and names are never trimmed (see the facts for why).
  Folders sort naturally by name with an exact tie-break. Files are sorted only where they're shown, because sorting
  all of them took longer than the rest of the build. File types come from the file name. Each folder carries
  its recursive file count, size, total length and worst quality (as for search groups), computed once.
- **Layout.** The toolbar has the username box and Browse, "N files · size · N locked", and on the right the fetch age
  and Re-browse. Below it:
  - A fixed-width tree pane (long names end in an ellipsis, with the full name on hover) with the filter, expand all
    and collapse all over a tree of folders showing their recursive file counts. Each root opens down through any
    single-child chain, everything else starts collapsed, and expansion is kept in memory per user. It's TanStack
    Table's expanding rows in `VirtualTable`, with `role="tree"`, `treeitem`, `aria-level` and `aria-expanded` added
    by hand.
  - The folder pane: a breadcrumb (starting with the user, for the share's top) with "· N files" and Download N
    (size), over a table of checkbox, Name, Files, Size, Quality and Length. Subfolder rows come first with their
    recursive totals.
- **Navigating.** Clicking a subfolder row opens it, and its checkbox selects its subtree. Clicking a file row toggles
  it, and Shift-click selects ranges. The breadcrumb goes up. An unknown `path` selects its nearest ancestor, and the
  folder pane says "Not in this share as fetched X ago" by Re-browse.
- **Sorting.** The tree always sorts by name. The folder pane defaults to subfolders, then files, both by name. Headers
  cycle like Transfers', and subfolders stay above files, sorted by their totals.
- **Filtering** is text only. Terms work like the results filter: ANDed, `-term` excludes, each a case-insensitive
  substring of the full path. The tree prunes to folders that lead to a match, fully expanded, and its counts become
  matching files. Clearing the filter restores the previous expansion. The folder pane flattens every match under the
  selected folder, with a relative Folder column, so at the share's top it lists every match.
- **Selection** lasts while you stay in the folder. A filter change keeps it, but only shown rows count. Changing
  folder or user drops it. There's no cap.
- **Downloading** sends one batch per remote folder, without `searchId`, one POST at a time with the 429 resend, gated
  on Soulseek. Each batch's `destination` is the folder's path from the folder you're in, inclusive: from `Album` it's
  `Album/CD1`, from `Artist` it's `Artist/Album/CD1`. That overrides slskd's own pattern, which keeps only the last
  folder name (see the facts). There's no confirmation. It leaves one outcome line, and file rows show Enqueued or
  Failed, kept per user until the next Re-browse.
- **Storage.** `idb` over the `slskd-alt` database. `shares` holds a small record per user (fetched and opened times,
  counts, size and stored bytes), which is all the landing page reads. `trees` holds the raw response Blob from
  `response.blob()`, which costs the main thread nothing to write. Opening reads `blob.text()`, parses, builds and
  renders on the main thread, split into three tasks: about 250, 180 and 100 ms for 168k files.
  - Stored bytes are capped at 1 GiB, evicting the least recently opened share first, but never one that's open or in
    memory.
  - There's no `navigator.storage.persist()`, because Firefox would prompt for it.
  - The cache survives the session ending.
  - If a write fails (the quota, or a private window's cap), the share opens from memory with "Not cached: reason",
    and the landing page lists it only while it's in memory.
  - A `BroadcastChannel` tells other tabs the cache changed, and their open pages re-read it.
- **Memory.** The two most recently opened parsed shares stay in memory, plus any running browse.

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
4. **Transfers.** *Done:* the Downloads and Uploads pages (see [Transfers](#transfers)), the live store's cost
   floor, `refresh` and session-end clearing, the exact badge, and retry through the batches endpoint. We checked
   these in headless Chromium against `pnpm dev`, and the URL handling against the `--dist` build:
   - selection counts and gate reasons, Shift ranges and group checkboxes
   - sorting, the filter and Show in the URL, reloads, invalid params, and the Downloads tab resetting them
   - a bulk action surviving navigation, the kept snapshot on return, the hidden-tab pause, and the session
     ending during a bulk action
   - Cancel all and Clear finished confirming with their counts, and Retry gated while Soulseek is disconnected

   With a real account we checked a batch moving from Active to Finished, the badge matching the toolbar, cancel,
   retry keeping its batch's destination and search, the 429 resend, and a queue lookup timing out at the peer.
   At scale (a real instance's 2.5k finished uploads, and once 20k rows of throwaway synthetic data, both on the
   `--dist` build) idle polls rendered nothing, scrolling while polling stayed around the 50 ms long-task mark at
   worst, and CPU throttling
   stretched the poll interval without the freshness going amber. Active rows at scale went untested.
5. **Search.** *Done:* the search box and list, the results page, downloading and Get full folder (see
   [Search](#search)), the search hub with its polling fallback, and the REST catch-up for hubs that stayed
   connected. We checked these in headless Chromium against `pnpm dev`, and deep links, reloads and params against
   the `--dist` build:
   - sort cycles, the filter, Locked and Free slot only in the URL, reloads, invalid params and an unknown id
   - Shift ranges, group checkboxes, and locked files that can't be selected, including by select-all
   - the search hub blocked: polling every 2 s, then "live" with no polling once it connects
   - the session ending during a download, and a quick log out and in, which found the catch-up gap (the Soulseek
     indicator stayed unknown too)
   - a search created while away from the search pages showing up on return

   With a real account we checked:
   - live counts and Stop
   - three searches created at once: the 429s were resent and the third waited in `Queued`
   - Delete N on running searches, with a clean slskd log
   - downloading a folder and a selection spanning users, with every batch carrying `searchId`
   - Get full folder adding 18 unmatched files to an album with one match

   A peer timeout on Get full folder never happened, so that error path is untested. The dev account couldn't
   reach the result limits (a search for "remix" got 2 responses), so scale was measured on a production build fed
   throwaway synthetic responses: 25k files in 21k folders.
   - Parsing and grouping is a one-off long task of about 200 ms, and sorts take 60–120 ms.
   - Scrolling in 1,500 px jumps went from 28 long tasks in 30 jumps to 0–4 once rows got `contain: strict`.

   The Filters popover then replaced the plain filter (see [Search](#search)). We checked it in headless Chromium
   against `pnpm dev`, on the dev account's stored results:
   - ten combinations of terms and criteria, each matching an independent implementation of the rules over the
     same responses
   - cover art riding along with a 320 album that it drops out of under Lossless, and "N of M" on partial folders
   - fast typing in the text box and the number fields, including the "3." on the way to "3.5"
   - remembered filters written into a newly opened results page without adding a history entry, Clear forgetting
     them, and invalid params stripped

   Filters combined with Get full folder went untested, because fetching a folder needs Soulseek.
6. **Browse.** *Done:* the landing page and the share page (see [Browse](#browse)), the IndexedDB cache, and Browse
   user on search-result and transfer group rows. We checked these in headless Chromium against `pnpm dev`, and URLs,
   reloads and the session against the `--dist` build, on a cache seeded with a real 168k-file share:
   - the tree, breadcrumb and folder navigation, deep links and reloads revealing their folder, and an unknown path
     falling back to its nearest ancestor
   - the filter pruning the tree and flattening matches, and clearing it restoring the expansion
   - sorting with subfolders kept on top, Shift ranges, and the download label
   - an uncached user never browsing by itself
   - logging out and in with the cache kept, the Browse tab, and Back
   - deleting in one tab emptying the other's page, and a share stored in one tab showing up in the other
   - Browse user from a stored search result opening the share at the result's folder

   With a real account we checked:
   - a browse going through waiting, receiving, loading and processing (10 s for 168k files)
   - Re-browse over a cached tree that stayed usable, keeping a folder chosen while it ran
   - downloading a folder with a nested subfolder: one batch per folder (`DOWNFORCE/Airfoil e.p_` and
     `DOWNFORCE/Airfoil e.p_/Scans`), and a finished file landing in the first. The peer failed the other six ("Download
     reported as failed by remote client").

   Opening a 168k-file share that isn't in memory costs about 500 ms of main-thread work in three tasks, and
   reopening one that is costs nothing. The 60 s timeout message went untested, because the peer that had timed out
   answered this time.

Later: dashboard, rooms, chat, users, then the config editor. Once the dashboard exists, decide whether `/`
redirects there instead. After the plan:
- proper responsiveness
- keyboard handling: ↵ into a folder and ⌫ up in Browse, `/` to focus a filter, `d` to download, `?` for the keys.
  Weigh `@headless-tree` for Browse's tree then, since it brings an ARIA tree with keys.
- filter criteria (quality, size) for Browse
