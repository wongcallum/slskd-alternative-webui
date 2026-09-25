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

**One hand-rolled live store**, with no TanStack Query, SWR or RTK Query. This is an exception to "prefer
established dependencies". Those libraries either assume refetching is cheap (TanStack Query's
structural sharing deep-allocates over the whole payload every tick) or assume the server emits deltas.

- **An update equal to the current data keeps the old snapshot and notifies nobody.** Hub payloads are mapped
  at ingestion to flat objects holding only the fields we read, so a shallow compare is enough. `updatedAt` is
  kept out of the snapshot and only freshness displays re-render on a clock, so identical pushes and polls cost
  nothing.
- **The poll interval is floored at 10× the last tick's main-thread cost** (parse plus merge). That keeps it to
  about 10% of the main thread, where stock polls at 1 Hz whatever the cost. Freshness thresholds use the
  effective interval.
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

**Arrays must keep their identity.** TanStack Table's core row model memoises on the identity of the `data`
array, and a fresh array rebuilds every row (9–91 ms at 20k rows depending on the sort, see the facts). So we
**split transfers on mutability**: active rows and terminal (`Completed, *`) rows live in separate arrays, each
in its own table, and are never concatenated. Each poll is merged into the existing arrays rather than replacing
them.

A terminal transfer almost never changes, but it can (auto-retry reuses the id, failures flip states, and a
failed move adds an `exception`; see the facts). So the merge doesn't assume immutability: it reuses the old row
only when no field that can still change has changed. Computed fields aren't mapped, because `elapsedTime`
changes on every poll. In practice the terminal array's identity changes rarely, and a poll with no changes
returns the same snapshot, so nothing renders.

### Session

**Only a REST 401 ends the session.** Hub disconnects are connectivity signals only.

- There's no login route: the session gate renders login in place of the app at whatever URL you're on, so deep
  links survive.
- The token is a bare string in localStorage, with no remember-me and no handling of `expires`.
- **A 401 ends the session only if the request carried the current token.** That rule alone stops
  a burst of 401s from ending it more than once, including late 401s from before a re-login.
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
- No router devtools, route code splitting or scroll restoration. The YAML editor is the one lazy chunk (see
  [Options](#options)).

### Shell

- Hub health has no indicator of its own in the bar, since two status dots side by side looked wrong. The
  Soulseek popover lists each hub instead.
- System is a gear on the right rather than a tab, since it's visited rarely and the wide tables keep the full width.
- The new-version link can't be dismissed: it goes once you update, and `no_version_check` is the opt-out.
- The version, the theme and Log out sit in a menu at the end of the bar, which keeps the bar short. On narrow
  screens the tabs, the speeds and the update notice will collapse into it too, the notice as an amber dot on its
  button.
- Each direction's speed and counts come from its list while its page polls it and the list is fresh, and otherwise
  from the metrics hub, marked "About". So the bar never disagrees with the page, and the Downloads badge follows the
  same rule.
- The list's speed is the bytes moved between polls, summed over the polls of the last 3 s. slskd's per-transfer
  speeds read far too low for short files (see the facts), and an album of short files is the everyday case. A poll
  after a gap the freshness display would call stale only sets a new baseline. The file and folder columns keep
  slskd's speeds.
- The hub's speed is the higher of `totalSpeed` and `averageSpeed`, because `totalSpeed` misses short files and taking
  the higher never double counts. **Accepted gap:** during an album of short files it still shows about a quarter of
  the real rate. Only the Downloads or Uploads page is exact.
- An idle direction shows a dimmed "0 B/s", and "–" while the hub is down and its list isn't fresh, rather than a
  frozen number. Both directions always show, at a fixed minimum width, so nothing in the bar shifts.
- Speeds stay out of the page title, since one that changes every second is noise in the tab strip.

### Theme

- System, Light or Dark, from the menu. System follows the OS as it changes. The choice is stored (System as no key at
  all) and followed across tabs, and stock's `slskd-theme` isn't read.
- Radix has no system mode, so it always gets an explicit appearance, worked out at startup.
- `index.html` declares `color-scheme: light dark`, so System paints the right background before the app loads with no
  script. An inline script rewrites it only for a stored Light or Dark. It ranks below Radix's own rule once the app
  renders, so it can go stale after a switch without harm, where an inline style on `<html>` would win.

### Transfers

- Rows have a fixed height and `contain: strict`, which makes scrolling far cheaper: scrolling 25k search results
  in 1,500 px jumps went from 28 long tasks in 30 jumps to 0–4.
- Cancel all, Retry failed and Clear finished act on the whole section whatever the filter, and ask for
  confirmation first. Elsewhere only Restart, Shut down and deleting files ask.
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

### Shares

- The contents are one tree of everything shared, as peers browse it, rather than one share at a time, because the
  per-share endpoint matches aliases with `LIKE` (see the facts). They can be tens of MB, so the list never fetches
  them.
- Cancel doesn't ask for confirmation, since a rescan undoes it.

### Files

- Both directories are listed whole with `recursive=true` rather than a level at a time. That gives folder sizes and a
  filter over everything, and listing never needs a path encoded (see the facts).
- Deleting in Incomplete only warns. Matching files to active downloads would mean reading the whole downloads list.
- A delete that touches a shared path isn't treated as a pending rescan: slskd never marks it, and a flag held by one
  tab would be less reliable than slskd's own.

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

### Events

- slskd pushes nothing, filters nothing and prunes nothing (see the facts), so the newest 100 are polled every 10 s
  and older pages load as the list is scrolled to its end. Nothing loads the whole table.
- Rows are matched by id, because offset pages overlap. A poll that shares no row with what's held means more than a
  page arrived in 10 s, so the held rows go rather than hide a gap.
- The list holds still like Logs', and older pages still arrive at its bottom meanwhile.
- The filter and the types judge only what's loaded. While either is on, older pages load from a button, so a filter
  that matches little can't page through the whole table on its own.
- Test events aren't offered: slskd stores them without their data, sends them to webhooks twice, and can't delete them.

### Options

- Effective is the redacted options as YAML with the file's keys, so a line can be copied into the file and saved:
  - Keys follow the rule slskd's validator uses (`log_s_q_l`), since `PUT` validates too. Names users chose, under
    the five maps keyed by name, stay as slskd sends them.
  - It's written as YAML 1.1, which quotes `on` and the like the way slskd would read them.
  - Nulls are left out, so it's the same pushed or polled.
  - `2147483647` is noted as unlimited only on transfer slots and speed limits, where slskd means that. Units aren't
    noted, since that would take a list of keys to keep up with slskd.
- File and Sources show secrets in plain text, so they're fetched only when opened. The draft is never persisted: it
  survives leaving the page, goes when the session ends, and a reload or closing the tab asks first.
- Save is blocked on what slskd's validator passes but then breaks on (see the facts): duplicate keys, unquoted
  yes/no/on/off, and a file with no settings. slskd's own validate is asked 500 ms after typing stops, and `yaml` adds
  the line and column slskd doesn't give.
- A save reads the file first and won't overwrite a change made since it was read. It shows the conflict
  instead, with Overwrite and Discard my changes.
- A view that becomes unavailable while it's open stays open, read-only, so a draft stays in front of whoever wrote it.
- Sources needs debug on at startup, which `GET /options/startup` says. It's read again each time the application hub
  connects, which covers a restart, rather than polled.
- `PATCH /options` isn't used: its change is lost on restart, and editing the file covers it.
- CodeMirror is lazy because most installs can't edit their file from here. Effective is coloured by `yaml` itself,
  which the main chunk has for the dump anyway. The editor has its own search, since the browser's find can't see
  lines CodeMirror hasn't drawn.

### Health

- Each surface shows its freshness in its own toolbar ("Updated 12 s ago"). It turns amber once the data is older
  than `min(3 × interval, 20s)`. There are no global banners or toasts.
- Keep three things separate and never collapse them into one "connected" flag: REST poll health, hub
  health, and slskd's own connection to the Soulseek server.
- Actions disable via `aria-disabled` and give a reason:
  - Every action is gated on REST poll health. The shell has no poll of its own, so its actions are gated
    on the Soulseek server state being known: the hub is connected and has sent `STATE`, or the last
    `GET /application` succeeded within the amber threshold.
  - Actions that need Soulseek (search, browse, download, user lookup) are also gated on slskd being
    logged in to the Soulseek server (`server.isLoggedIn`). That state is pushed through `STATE`. While
    the application hub is down, `GET /application` is polled so the gate never acts on stale state. In
    `no_connect` dev these actions are always disabled.
  - Hub health never gates anything.
