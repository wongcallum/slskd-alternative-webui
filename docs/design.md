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

The one database holds each feature's stores, and a tab on an older build closes its connection when a newer one
needs to upgrade it, which would otherwise wait for every tab to close.

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
- Profile in a name's menu counts as the gesture too, and always looks the user up (see [Users](#users)).
- The one exception is acknowledging private messages while their conversation is on screen (see [Chat](#chat)).
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

- Hub health has no indicator of its own in the bar, since two status dots side by side looked wrong. The
  Soulseek popover lists each hub instead.
- System is a gear on the right rather than a tab, since it's visited rarely and the wide tables keep the full width.
- The new-version link can't be dismissed: it goes once you update, and `no_version_check` is the opt-out.

### Transfers

- Rows have a fixed height and `contain: strict`, which makes scrolling far cheaper: scrolling 25k search results
  in 1,500 px jumps went from 28 long tasks in 30 jumps to 0–4.
- Cancel all, Retry failed and Clear finished act on the whole section whatever the filter. They ask for
  confirmation, and so do Restart and Shut down; nothing else does.
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

### Users

- A lookup asks for `status`, `endpoint` and `info` at once. Status and address come from the server and the rest from
  the user's own client, which fails far more often (firewalled or offline peers), so each part shows on its own.
  **A part that fails keeps what the last lookup found**, with its own age, and the error shows beside it. Errors are
  held in memory only.
- Profile in a name's menu always looks the user up, unlike Browse, which opens a cached share. A lookup is one server
  request and one small message to the peer, and a stale presence or queue length is what would mislead.
- Opening a profile by link, reload or the landing list shows what's stored, and nothing is asked.
- In IndexedDB, `users` holds the small record the landing page reads, and `pictures` holds each picture as base64, so
  the list never reads the pictures. Only the newest 100 lookups are kept, since every Profile click stores one. They
  survive the session ending, like the share cache.
- Peers don't say what type a picture is, so it's shown as `data:image;base64,…` and the browser sniffs it.
- The transfer history comes from slskd's own database, not Soulseek, so it loads with the page and after each lookup
  (see the facts). Failed is everything that neither succeeded nor was cancelled, since slskd's own errored count takes
  only four exact states.
- Names have a menu (Profile, Message, Browse) wherever they appear: search results, transfers, rooms, the conversation
  header, and Browse's share header, where the name is in the box so the menu is a ⋯ button beside it. It leaves out the
  page it's on. The archive icon stays as a one-click Browse, and our own name in a room's user list has no menu.
- The server answers a made-up name the same as an offline user (see the facts), so neither is called out.

### Chat

- Rooms and private conversations share one page behind the Chat tab. `/rooms?room=` and `/chat?user=` both render
  it, so stock's paths still work, and its sidebar is a layout route, so it stays mounted while switching. The tab
  goes back to whatever was open last.
- Only the joined room names are pushed (`STATE.rooms`), so the rest is polled:
  - The open room's messages every 2 s, and the other joined rooms' every 10 s while the page is open, for their
    unread marks. The open room's users every 30 s, since they only change as people join and leave, and a busy
    room's list is hundreds of KB.
  - The conversation list every 10 s wherever the app is open, for the unread count on the Chat tab and at the start
    of the page title. The open conversation every 2 s.
- `STATE.rooms` lists a room being joined before slskd can answer for it, and keeps a left room for a few seconds
  (see the facts). So a room this tab is joining shows once the join returns, and a room it leaves goes at once.
- slskd has no read state for rooms, so the newest message time seen in each room is kept in localStorage, in slskd's
  clock. A room seen for the first time starts from what it already holds, so joining a busy room isn't 250 unread
  messages. A dot marks news, and a count marks messages that mention our username as a whole word.
- **Private messages are acknowledged while their conversation is on screen**, although that sends a packet to the
  Soulseek server. No peer sees it, and without it the server delivers every message again at each login. It
  acknowledges all at once, because acknowledging by id fails for sent messages. A "New" divider marks what was
  unread when the conversation opened.
- Our room messages only arrive when the server echoes them, a second or so after sending. So a sent message shows
  dimmed until its echo, and is marked "not confirmed" if none comes within 10 s.
- Opening a conversation sends nothing. It shows empty until the first message, and is in the sidebar only while
  it's open.
- The log sticks to the bottom, through a resize observer on its content, with scroll anchoring off meanwhile, so
  lines slskd drops from the top don't pull it up. Scrolled up, it holds still and counts what arrives.
- Only explicit web links (`http://`, `https://`, `www.`) are linked, because file talk is full of names like
  `album.fm`.
- A room's user list shows names, countries and file counts, but not status or speed: slskd takes those as a user
  joins and never updates them.
- Opening Join a room fetches the server's room list, which counts as the gesture. A typed name that isn't listed
  can be joined too, which creates the room.
- Leaving a room and closing a conversation don't ask for confirmation.

### System

- Restart is disabled while this tab has a browse running, because slskd can't restart while it's answering a
  request (see the facts). Other tabs and clients can't be guarded, so the confirmation warns instead.
- Check for updates is manual only: slskd's forced check ignores `no_version_check`, so a timer would override that
  opt-out.
- `OPTIONS` is followed like `STATE`, falling back to `GET /options`, for remote file management, the two directories
  and the share filters.

### Folder trees

- Browse, the shares' contents and Files share one tree and folder pane (`ui/tree`), built from a flat list of
  folders. Each view adds its own columns, what can be selected, and what to do with a selection.

### Shares

- The list is the top of the contents: `/system/shares` lists the shares, and `?path=` opens what's shared as one
  tree with the aliases as top folders, which is what peers browse. The per-share contents endpoint isn't used,
  because it matches aliases with `LIKE` (see the facts).
- The contents can be tens of MB, so only opening them fetches them. They're held for the session and fetched again
  only once a scan has finished since, and a scan finishing while they're open reloads them.
- The list is fetched as the page opens, when `shares.directories` changes in `OPTIONS`, and once a scan finishes,
  which is when its counts change. A scan counts as finished when `ready` turns true, or when it stops faulted.
- **A cancelled or faulted last scan counts as a pending rescan**, like `scanPending`, because slskd clears
  `scanPending` after a cancel while searches miss what the scan found (see the facts). Nothing counts as pending while
  a scan runs, since `scanPending` is unreliable then and the scan settles it anyway.
- The gear goes to Shares when a rescan is the only thing pending, and Info's callout links there. Cancel doesn't ask
  for confirmation, since a rescan undoes it.

### Files

- Both directories are listed whole, with `recursive=true`, as one tree with Downloads and Incomplete at the top. That
  gives folder sizes and a filter over everything, and listing never needs a path encoded. They're listed on every
  visit, after deleting and on Refresh, and never polled.
- Deleting takes a selection and a confirmation, and sends one DELETE at a time. Deleted items leave the held tree in
  batches as their DELETEs return, and then both directories are listed again.
- slskd takes a path as base64 in a URL segment, where a `/` can't get through, so `./` or `//` is inserted to shift
  the encoding off it (see the facts). A path that can't be encoded that way can't be deleted on its own, and the gate
  says to delete its folder instead.
- Deleting in Incomplete warns in the confirmation that a download still writing there carries on and most likely ends
  as succeeded with no file. Nothing matches files to active downloads, which would mean reading the whole downloads
  list.
- When a delete touches a shared path, the outcome says the files stay in the shares until a rescan, with a Rescan
  button. slskd never marks that as pending, and a flag held by one tab would be less reliable than slskd's own.
- Until `OPTIONS` says `remote_file_management` is on, there are no checkboxes and Delete is disabled with the reason.

### Logs

- The log follows the logs hub and polls `GET /logs` while the hub is down. Every buffer, poll and push is merged into
  what's held, and a record counts as held when its timestamp and message match exactly, because every connect resends
  the buffer and a record can arrive both ways (see the facts). The newest 1,000 are kept, sorted by timestamp. They
  outlive leaving the page and slskd restarting, and go when the session ends.
- Pushes are merged in batches every 250 ms, since slskd can push dozens a second. At 54 a second that cost about 4% of
  the main thread, with no long tasks.
- The list holds still while it's scrolled down or paused, and Resume says how many new records match the filter.
  Otherwise records arriving at the top and being dropped at the bottom would move whatever is being read.
- Rows have a fixed height and show the message's first line, with a count of the lines after it (usually a stack
  trace). Clicking a row shows the whole record in a pane below the list.
- Times are in the browser's time zone, to the millisecond, with the date when it isn't today.

### Health

- Each surface shows its freshness in its own toolbar ("updated 12s ago"). It turns amber once the data is older
  than `min(3 × interval, 20s)`. There are no global banners or toasts.
- What's loaded on demand rather than polled (a browsed share, the shares' contents, Files) shows when it was fetched
  instead, with a way to fetch it again.
- Keep three things separate and never collapse them into one "connected" flag: REST poll health, hub
  health, and slskd's own connection to the Soulseek server.
- Actions disable via `aria-disabled` and give a reason:
  - Every action is gated on REST poll health. The shell has no poll of its own, so its actions are gated
    on the Soulseek server state being known: the hub is connected and has sent `STATE`, or the last
    `GET /application` succeeded within the amber threshold.
  - Actions that need Soulseek (search, browse, download, user lookup) are also gated on slskd being
    logged in to the Soulseek server (`server.isLoggedIn`). That state is pushed through `STATE`. While
    the application hub is down, `GET /application` is polled so the gate never acts on stale state. In
    `no_connect` dev these actions are always disabled, which is expected.
  - Hub health never gates anything.
