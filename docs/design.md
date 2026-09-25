# Design

An alternative web UI for slskd, shipped as a drop-in replacement for its `wwwroot` and run against
stock slskd. Verified behaviour of slskd and the libraries we rely on is in [facts.md](facts.md).

## Architecture

### URLs

- Every REST and hub URL is built from `window.urlBase` at runtime (`"/"` means root), so nothing hardcodes
  `/slskd`. Never use `window.port`.
- slskd 404s a deep link whose last path segment contains a dot, so free-form values (usernames,
  folder paths, search text) go in search params or non-final segments.

### Storage

We share an origin with stock, so everything we persist (localStorage keys, the IndexedDB database and the
`BroadcastChannel`) is prefixed `slskd-alt`.

### Live store

**One hand-rolled live store**, with no TanStack Query, SWR or RTK Query. This is a deliberate exception to
"prefer established dependencies". Those libraries either assume refetching is cheap (TanStack Query's
structural sharing deep-allocates over the whole payload every tick) or assume the server emits deltas.

- **An update equal to the current data keeps the old snapshot and notifies nobody.** Hub payloads are mapped
  at ingestion to flat objects holding only the fields we read, so a shallow compare is enough. `updatedAt` is
  kept out of the snapshot and only freshness displays re-render on a clock, so identical pushes and polls cost
  nothing.
- **The poll interval is floored at 10× the last tick's main-thread cost** (parse plus merge). That caps it at
  about 10% of the main thread, where stock out-polls it. Freshness thresholds use the effective interval.
- The work stays on the main thread; a one-off check at 20k rows didn't justify more. If it ever does, a worker
  fetches, parses and diffs, and posts only the changes.
- List polls have no timeout: uncompressed, a heavy list takes about 10 s over a 3 Mbit/s link. Other requests
  keep ky's 10 s.
- A failed tick keeps the last good data and never blanks the screen.
- A stopped resource keeps its snapshot, so coming back to a page shows the last data with its age at once.
  Every resource snapshot and module-level atom is cleared when the session ends.
- Hubs send their snapshot (`STATE`, `LIST`) only as they connect, and stay connected for 2 s after their last
  subscriber leaves. So a resource that starts while its hub is still connected (after a quick log out and in, or
  when leaving the search pages and coming back) fetches the same snapshot over REST: `GET /application` or
  `GET /searches`.
- Payload types are hand-written and cover only the fields we read. OpenAPI is a poor source (see the facts).

### Array identity

**Array identity is load-bearing.** TanStack Table's core row model memoises on the identity of the `data`
array, and a fresh array rebuilds every row (9–91 ms at 20k rows depending on the sort, see the facts). So we
**split transfers on mutability**: active rows and terminal (`Completed, *`) rows live in separate arrays, each
in its own table, and are never concatenated. Each poll is merged into the existing arrays rather than replacing
them.

A terminal transfer _almost_ never changes, but it can (auto-retry reuses the id, failures flip states, and a
failed move adds an `exception`; see the facts). So the merge doesn't assume immutability: it reuses the old row
only when no field that can still change has changed. Computed fields aren't mapped, because `elapsedTime`
changes on every poll. In practice the terminal array's identity changes rarely, and a poll with no changes
returns the same snapshot, so nothing renders.

### Session

**Only a REST 401 ends the session.** Hub disconnects are connectivity signals only.

- There's no login route: the session gate renders login in place of the app at whatever URL you're on, so deep
  links survive.
- The token is a bare string in localStorage, with no remember-me and no handling of `expires`.
- **A 401 ends the session only if the request carried the current token.** That one rule is the
  latch and suppresses the burst, including late 401s from before a re-login.
  - Ending deletes the stored token only if it's still the one that got the 401, so a stale tab can't
    wipe a newer token.
  - The app unmounts, so polls and hubs stop through their reference counts.
  - `/session/enabled` is re-checked, because auth may have been toggled across a restart.
- Logout is local only, because slskd can't revoke tokens.
- Hubs retry forever, including the initial `start()`, and every retry fires a `GET /session` probe. SignalR
  treats a negotiate 401 as an ordinary failure, and a single probe on drop would hit a slskd that is still down.
  After a restart the session ends within about 1 s of slskd coming back.
- Accepted gaps:
  - A token that expires while its hub stays up looks logged in until the next REST call.
  - If auth is turned off across a restart, the tab stays "logged in" until it's reloaded.

### Soulseek actions

**Never trigger a Soulseek action automatically.** Browsing a user, searching, downloading and looking
up a user happen only on an explicit user gesture. They never happen on mount, navigation, reload or a timer.
That includes queue-position lookups and retries. Show stored results instead (slskd persists searches,
and we cache browsed share trees in IndexedDB), show when each result was fetched, and re-fetch only on request.

- Browse user on a search result or transfer counts as the gesture, so it browses a user who isn't cached.
- slskd runs at most two enqueues at once and answers a third with a 429 having done nothing, so enqueues go one
  POST at a time and a 429 is resent every second for up to 30 s. Creating a search does the same, since a 429
  there means another POST held slskd's lock.
- Long-running actions run at module level, so they survive navigation, and ending the session aborts them.

### Routing

**The router is a matcher.** There are **no route loaders**: data comes from the store.

- **The router is always mounted.** Its root route renders `<SessionGate><Shell /></SessionGate>`, so the
  shell, pages, polls and hubs unmount when the session ends while the router keeps following the URL.
  Remounting `<RouterProvider>` can render a stale page (see the facts).
- Paths match stock's.
- Invalid search params fall back to their defaults, and defaults and invalid values stay out of the URL. Params
  that filter or sort a view replace the history entry. Opening a folder in Browse pushes one, so Back returns to
  the previous folder.
- No router devtools, code splitting or scroll restoration.

### Shell

- The Downloads badge counts unfinished downloads from the metrics hub, so it's approximate: slskd's gauges
  trail the list by a few seconds and by up to a whole batch while it's being enqueued (see the facts). While
  the downloads list is fresh (the Downloads page is open), the badge shows the list's exact count instead.
- Connect is only offered while disconnected, because `PUT /server` while connected leaves slskd's retry timer
  running.
- Hub health has no indicator of its own in the bar, since two status dots side by side looked wrong. The
  Soulseek popover lists each hub instead.

### Transfers

- Rows have a fixed height and `contain: strict`, which makes scrolling far cheaper: scrolling 25k search results
  in 1,500 px jumps went from 28 long tasks in 30 jumps to 0–4.
- Cancel all, Retry failed and Clear finished act on the whole section whatever the filter, and they're the only
  actions in the app that ask for confirmation.
- `Completed, Cancelled` is an outcome of its own, not a failure: it isn't counted as failed and Retry failed skips
  it, but a selected cancelled download can still be retried. A cancel during a retry backoff ends as
  `Completed, Errored` (see the facts), so it still counts as failed.

### Search

- slskd picks a new search's id, because `crypto.randomUUID` needs a secure context and plain-HTTP LAN installs
  aren't one. The record the POST returns goes straight into the list, which would otherwise miss it until the
  next poll while the hub is down.
- A DELETE alone leaves the search running and holding one of slskd's two search slots, so Delete stops a running
  search first.
- Results load once, on the first update with both `isComplete` and `endedAt` set, because the `Completed` update
  arrives before the responses are saved. They never change afterwards.
- Stock packs filter criteria into the text box as a syntax (see the facts). We dropped it for a Filters popover,
  because its keywords collide with path text and can't be discovered.
- Criteria judge files that have attributes. Files without attributes (cover art, logs, and everything from peers
  that send none) ride along while their folder still shows a file that has them: a quality filter keeps an
  album's cover but hides a folder of attribute-less mp3s. A group that lost files to the filter reads "10 of 12"
  in Files, so a partial album never looks whole.
- The results page never reads the downloads list. Rows show Enqueued or Failed from the batch responses.

### Browse

- There's no Cancel, because aborting doesn't stop slskd (see the facts). Two tabs browsing the same user at once
  is an accepted gap, although slskd can cross their results.
- A browse status equal to the one read just before starting is ignored, because a failed browse leaves its last
  status behind.
- Tree nodes are keyed by exact path and names are never trimmed (see the facts for why). Files are sorted only
  where they're shown, because sorting all of them took longer than the rest of the build.
- Downloading sets each batch's `destination` to the folder's path from the folder you're in, inclusive: from
  `Album` it's `Album/CD1`, from `Artist` it's `Artist/Album/CD1`. That overrides slskd's own pattern, which keeps
  only the last folder name (see the facts).
- In IndexedDB, `shares` holds a small record per user, which is all the landing page reads. `trees` holds the raw
  response Blob from `response.blob()`, which costs the main thread nothing to write. Opening parses and builds on
  the main thread in three tasks: about 250, 180 and 100 ms for 168k files.
- There's no `navigator.storage.persist()`, because Firefox would prompt for it.
- The cache survives the session ending.

### Health

- Each surface shows its freshness in its own toolbar ("updated 12s ago"). It turns amber once the data is older
  than `min(3 × interval, 20s)`. There are no global banners or toasts.
- Keep three things separate and never collapse them into one "connected" flag: REST poll health, hub
  health, and slskd's own connection to the Soulseek server.
- Actions disable via `aria-disabled` and give a reason:
  - Every action is gated on REST poll health. The shell has no poll of its own, so its actions are gated
    on the Soulseek server state being known: the hub is connected and has sent `STATE`, or the last
    `GET /server` succeeded within the amber threshold.
  - Actions that need Soulseek (search, browse, download, user lookup) are also gated on slskd being
    logged in to the Soulseek server (`server.isLoggedIn`). That state is pushed through `STATE`. While
    the application hub is down, `GET /server` is polled so the gate never acts on stale state. In
    `no_connect` dev these actions are always disabled, which is expected.
  - Hub health never gates anything.
