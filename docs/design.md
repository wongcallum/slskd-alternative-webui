# Design

An alternative web UI for slskd, shipped as a drop-in replacement for its `wwwroot` and run against
stock slskd. Verified behaviour of slskd and the libraries we rely on is in [facts.md](facts.md). This file keeps the
rules that span features and the decisions the code can't show: rejected alternatives, accepted gaps, and reasons that
aren't in a comment.

## Architecture

### Live store

**One hand-rolled live store**, with no TanStack Query, SWR or RTK Query. This is an exception to "prefer
established dependencies". Those libraries either assume refetching is cheap (TanStack Query's
structural sharing deep-allocates over the whole payload every tick) or assume the server emits deltas.

- Payload types are hand-written and cover only the fields we read, since OpenAPI is a poor source (see the facts).
  Payloads are mapped at ingestion to flat objects, so the store's shallow compare can skip an identical push or poll.
- The work stays on the main thread; a one-off check at 20k rows didn't justify more. If it ever does, a worker
  fetches, parses and diffs, and posts only the changes.
- List polls have no timeout: uncompressed, a heavy list takes about 10 s over a 3 Mbit/s link. Other requests
  keep ky's 10 s.

### Array identity

**Arrays must keep their identity.** TanStack Table's core row model memoises on the identity of the `data`
array, and a fresh array rebuilds every row (9–91 ms at 20k rows depending on the sort, see the facts). So we
**split transfers on mutability**: active rows and terminal (`Completed, *`) rows live in separate arrays, each
in its own table, and are never concatenated. Each poll is merged into the existing arrays rather than replacing
them.

A terminal transfer can still change (see the facts), so the merge reuses a row only when no field that can change
has changed. Computed fields aren't mapped, because `elapsedTime` changes on every poll.

### Session

**Only a REST 401 ends the session.** Hub disconnects are connectivity signals only.

- **A 401 ends the session only if the request carried the current token.** That rule alone stops a burst of 401s
  from ending it more than once, including late 401s from before a re-login.
- Accepted gaps:
  - A token that expires while its hub stays up looks logged in until the next REST call.
  - If auth is turned off across a restart, the tab stays "logged in" until it's reloaded.
- Rejected: stock's Remember Me, which keeps the token in `sessionStorage` when unticked. That token stays in its own
  tab, so every other tab would ask to log in again. Stock ticks it by default, so its default matches ours.

### Soulseek actions

**Never trigger a Soulseek action automatically.** Browsing a user, searching, downloading and looking
up a user happen only on an explicit user gesture. They never happen on mount, navigation, reload or a timer.
That includes queue-position lookups and retries. Show stored results instead (slskd persists searches,
and we cache browsed shares and lookups in IndexedDB), show when each result was fetched, and re-fetch only on request.

The one exception is acknowledging private messages while their conversation is on screen.

### Routing

**The router is a matcher.** There are **no route loaders**: data comes from the store.

- **The router is always mounted.** Its root route renders `<SessionGate><Shell /></SessionGate>`, so the shell,
  pages, polls and hubs unmount when the session ends while the router keeps following the URL, and login shows at
  whatever URL you're on. Remounting `<RouterProvider>` can render a stale page (see the facts).
- Paths match stock's.
- slskd 404s a deep link whose last path segment contains a dot, so free-form values (usernames, folder paths, search
  text) go in search params or non-final segments.

### Storage

- We share an origin with stock, so everything we persist (localStorage keys, the IndexedDB database and the
  `BroadcastChannel`) is prefixed `slskd-alt`.
- Browsed shares and user lookups survive the session ending.
- We store a share's folders and files as columns of JSON, gzipped. That's about 18 times smaller than slskd's
  response and quicker to read back (see the facts). Packing yields after each column, and a browsed share shows
  before it's packed.
  - Rejected: storing the response Blob as is. It cost nothing to write, but took 45 MB for a big share and was
    slower to read. Gzipping it unchanged made reads slower still.
  - Rejected: packing in a worker, which parses the response a second time and took 11–12 s on a throttled CPU.
  - Rejected: brotli, which Chrome's `CompressionStream` lacks.
- There's no `navigator.storage.persist()`, because Firefox would prompt for it.
- A browse response and a stored share are parsed with json-ext as they stream in, because a big share's JSON can be
  longer than V8's longest string (see the facts).
  - Rejected: parsers that tokenise in JavaScript (`@streamparser/json`, `jsonriver`, `stream-json`), which held the
    main thread for the whole parse, 32–33 s for a 611 MB share in Chrome.
  - Accepted gap: in Firefox, json-ext freezes the page for the whole parse, so a mid-sized share freezes it longer
    than `response.json()` did (1.4 s against 0.7 s for 75 MB). Yielding between chunks didn't help.

### Health

- Each surface shows its freshness in its own toolbar. There are no global banners or toasts.
- Keep three things separate and never collapse them into one "connected" flag: REST poll health, hub
  health, and slskd's own connection to the Soulseek server.
- Actions disable with a reason:
  - Every action is gated on REST poll health. The shell has no poll of its own, so its actions are gated
    on the Soulseek server state being known: the hub is connected and has sent `STATE`, or the last
    `GET /application` is fresh.
  - Actions that need Soulseek (search, browse, download, user lookup) are also gated on slskd being
    logged in to the Soulseek server (`server.isLoggedIn`).
  - Hub health never gates anything.

### Confirmation

Only the Cancel menu, Retry failed and Clear finished (which act on the whole section whatever the filter), Restart,
Shut down and deleting files ask for confirmation.

### Keyboard

The whole app works from the keyboard, for sighted keyboard users first. `?` lists the keys.

- **Each list is one Tab stop**: the row the keyboard is on. Tab goes through that row's own controls and then
  leaves the list, since the other rows' controls are out of the Tab order. When every row was a Tab stop, Tab had to
  walk the whole list, because focusing a row scrolls the list and the virtualiser renders the next rows (see the
  facts).
- A virtualised list always renders the keyboard's row, wherever it's scrolled, so neither focus nor the Tab stop
  is lost when the row scrolls out of view.
- **Keys that act on rows (`d`, `r`, Delete, ⌫) only work while focus is in their list**, so a letter can't set them
  off from elsewhere (WCAG 2.1.4). `/`, `?` and the `g` sequences work anywhere except in a text field, a menu or a
  dialog.
- There's no type-ahead, since it would take the letters the row keys use, and `/` filters the whole tree rather than
  the rows on screen.
- In the folder tree, the arrows only move focus and Enter opens the folder, since opening one adds a history entry
  and remounts the folder pane.
- After a navigation takes focus away, it goes to the list that had it, or else the page's main list, or else the
  first control on the page that isn't a text field. A field that focuses itself on mount keeps focus. Back returns
  to the row the keyboard was on in each list.
- The tree is built by hand over `VirtualTable`, like the lists. This is an exception to "prefer established
  dependencies". Rejected:
  - Headless Tree, whose defaults would mostly need working around at our size (see the facts).
  - react-aria's Tree, which is 56 KB with its own virtualiser.
- `d` downloads without asking, as the Download buttons do. **Accepted risk:** `d` on a top folder in the tree
  queues the whole share.
- **Accepted gap:** nothing is tested with a screen reader. Lists are grids, treegrids and a tree made of rows, but
  their cells have no roles, since the linter wants table elements there.

### Layout

- Toolbars are 48px high, whatever they hold, and tab bars keep their tabs' 40px. A field in a toolbar is size 2, as
  is the button that submits it, and every other control in a toolbar is size 1.
- Toolbars, lists and empty states share a 16px inset, so a list's checkboxes and first column line up with the field
  above them.
- The title of what's open (a search, a room, a conversation or a user) is a size 4 heading. Freshness is size 1 and
  counts are size 2.
- Rejected: a larger search box on Dashboard and Search. It was the only control of its size, and it moved the line
  under the first bar from page to page.

### Columns

- A column is resized by dragging its edge in the header, or with Shift+← and Shift+→ on its sort button. A
  double-click on the edge resets it. Widths are kept in localStorage for each kind of table, whatever the layout, and
  the transfer sections share theirs so their columns stay in line.
- The name column, or whichever column grows, takes what the others leave. So the edge that moves is the one on its
  side, and the name column gives or takes what the resized column does, which keeps the edge under the pointer. Once
  the row is wider than the list, the name column is at its minimum, so the minimum moves instead.
  - Rejected: TanStack Table's column resizing, whose handler only changes the dragged column (see the facts), so
    beside a growing name column the edge would drift from the pointer.
- A menu at the end of the header hides columns other than the name, checkbox and actions columns, and they're kept
  like widths. A column a layout drops stays dropped, and stacked layouts ignore the choice.
- **Accepted gaps:**
  - Columns don't resize by touch, since a handle would catch swipes along the header.
  - Columns whose header doesn't sort, on the list of searches, Shares, Events and Logs, can't be resized from the
    keyboard.
  - The Users and Browse lists don't resize. A column grows on each side of the others, so no edge between them could
    follow the pointer.
  - Only Transfers, search results and folder panes hide columns.
  - The folder pane gives up 40px at the end of its rows for the menu, since it has no actions column. Below md,
    Quality narrows to make room beside the tree, which cuts a folder's range of qualities short.

## Features

### Shell

- Hub health has no indicator of its own in the bar, since two status dots side by side looked wrong. The
  Soulseek popover lists each hub instead.
- System is a gear on the right rather than a tab, since it's visited rarely.
- The new-version link can't be dismissed: it goes once you update, and `no_version_check` is the opt-out.
- While a direction's list is polled, its speed in the bar is the bytes moved between polls, because slskd's
  per-transfer speeds read far too low for short files (see the facts), and an album of short files is the everyday
  case.
- **Accepted gap:** while no list is polled, the speed comes from the metrics hub, which during an album of short files
  shows about a quarter of the real rate. Only the Downloads or Uploads page is exact.
- Speeds stay out of the page title, since one that changes every second is noise in the tab strip.
- A privileged account has a star by its name in the bar. How long is left is in the Soulseek popover, since a tooltip
  inside the popover's button couldn't be reached.
- While not logged in, the Soulseek popover shows why the last connection attempt failed, which slskd only logs (see the
  facts), with a link to the log. It's slskd's own text, and the bar keeps its short label, since the messages are long
  and carry addresses. The log is followed only while that popover is open.
  - Rejected: `SoulseekClientDisconnected` events, which miss a missing username and failed DNS lookups.
  - **Accepted gap:** once the failure has left slskd's 100-record buffer, there's no reason to show.

### Relay agents

- On a relay agent, slskd refuses everything Soulseek (see the facts), so the nav has only System, the landing page is
  System's, and the other paths say it's an agent rather than redirecting. The nav and pages wait for the first state,
  since until then they can't tell whether they'd only get 403s.
- The Soulseek popover shows the controller's connection instead, and Info leaves out the account, searches and
  distributed network. A Relay card on Info shows the controller, or on a controller the connected agents, since
  nothing else shows an agent dropping.
  - Rejected: stock's Controller button. Connecting hangs forever when already connected, and an agent's UI only
    exists while it's connected, so disconnecting would cut it off with no reliable way back.
- The VPN integration's state is in the Soulseek popover, since waiting for the VPN is why slskd isn't connecting.
  - Rejected: `server.ipEndPoint`, the server's resolved address, which says nothing a user acts on.

### Responsiveness

**Accepted gaps:**

- Safari ignores `interactive-widget=resizes-content` and pans the page for the keyboard rather than shrinking the
  layout, so the composer can end up under it.
- Names cut short keep their full text in `title` attributes only, which touch can't reach (Details has it for
  transfers and results).
- The sort strip scrolls with no visible hint.

### Dashboard

- It's the landing page, as stock's is, with Search's box on top. A search opens its results as it does from Search,
  since there's no toast to say it started.
- The figures are our own, from slskd's totals per final state. Transferred counts successes only, failed is
  `Errored`, `TimedOut`, `Rejected` and `Aborted`, and cancelled counts as neither. Users are counted per direction
  and never added together.
  - Rejected: stock's totals, which add up every final state at full size, and add the two directions' users.
- The errors table shows slskd's groups as they come, cancellations included, since they can't be filtered by state.
  - **Accepted gap:** a message with an IP address and port turns into a fragment (see the facts).
  - Rejected: repairing the fragments, which would be code keyed to one slskd bug.
  - Rejected: stock's view of both directions' groups together, since the figures keep the directions apart.
- Bars follow the local calendar. Hours, six hours and days are made of slskd's hourly buckets, and months of its UTC
  days, since a year of hours is megabytes. The totals cover exactly the bars' span.
  - **Accepted gaps:** the edges of months are off by the UTC offset, and in zones with a :30 or :45 offset so are
    the edges of days.
  - Rejected: stock's 90-day and 180-day ranges. They fit neither unit: days make too many bars, and a span that
    isn't whole months has ragged ends in months.
- It loads again when the metrics hub counts a finished transfer, since nothing else changes the reports, at most once
  a minute and not while the tab is hidden. The hub doesn't count a cancelled download, which the figures leave out
  anyway.
- The chart library loads with the chart, since it's about 100 kB gzipped.
- Rejected: stock's tabs, its list of recent errors (the transfer lists filter to failures), its 12 chart series,
  custom date ranges, the share ratio's colours, whose thresholds are arbitrary, and rank columns, since the order is
  the rank.

### Transfers

- Rows have `contain: strict`, which makes scrolling far cheaper: scrolling 25k search results in 1,500 px jumps went
  from 28 long tasks in 30 jumps to 0–4.

### Search

- slskd picks a new search's id, because `crypto.randomUUID` needs a secure context and plain-HTTP LAN installs
  aren't one.
- Stock packs filter criteria into the text box as a syntax (see the facts). We dropped it for a Filters popover,
  because its keywords collide with path text and can't be discovered.
  - Rejected: stock's VBR and CBR filters. Many files don't say whether they're VBR (see the facts), so either filter
    would hide files that match it.
- Starting a search opens its results, from the Search page too.
  - Rejected: stock's Enter, which starts a search and stays on the list while the button opens it. The difference
    can't be seen, and queueing several searches is rare.
- The results page never reads the downloads list. Rows show Enqueued or Failed from the batch responses.
- A folder shows its whole path with the part above it dimmed, cut from the start when it doesn't fit, and by default a
  user's folders are in path order. Soulseek returns a subfolder such as `Scans` as a folder of its own, and this puts
  it right below its album with the album's name in front. The name is cut from the start too, like its subfolders'
  paths, so an album and its `Scans` show the same end of the album's name.
- **A folder's full contents come from the user's whole share**, the one Browse caches, rather than a request for
  the folder. slskd peers answer that request with files from other folders under bare names, so some listed paths
  don't exist (see the facts), and old slskds will stay on the network long after a fix. A cached share is read
  without asking the peer, and getting the folder again browses afresh.
  - Rejected: trusting the answer, telling slskd peers apart by what they send, and dropping the button for the
    row's Browse.
- A download that includes a fetched folder's subfolders is sent like one from Browse, in a batch per remote folder
  rooted at that folder, which bypasses the destination pattern. Other downloads stay one batch per user with the
  search, so the pattern's `SEARCH_ID` and `SEARCH_TEXT` work.

### Browse

- Two tabs browsing the same user at once is an accepted gap, although slskd can cross their results.
- Quality, size and length judge files as Search's Filters do, alongside the text filter: files without attributes,
  such as cover art, stay while their folder still shows a file that passes.
- `d` on a folder in the filtered tree still downloads all it holds. Selecting in the filtered pane downloads only
  what's shown.
- Filters is an icon in the tree's toolbar, since a labelled button leaves the text filter too narrow below lg.
- Rejected: stock's folder counts on each tree row, which crowd the file counts, and its icons for each file type,
  which the Quality column makes redundant.

### Users

- Profile in a name's menu always looks the user up, unlike Browse, which opens a cached share. A lookup is one server
  request and one small message to the peer, and a stale presence or queue length is what would mislead.
- Names have a menu (Profile, Message, Browse) wherever they appear, leaving out the page it's on.
- Rejected: stock's placeholder for a profile without a picture, which the layout doesn't need.

### Chat

- The open room's users are polled every 30 s, since they only change as people join and leave, and a busy room's
  list is hundreds of KB.
  - Rejected: stock's online-first order and dimming of away users. slskd takes a user's status as they join and never
    updates it, so it would soon be wrong.
- Rejected: hiding a conversation with the user `..`, as stock does. slskd can't reach that user through any endpoint
  (see the facts), and hiding it would be code keyed to one slskd bug.
- Reply quotes a room message in stock's format, `[user] message --> `, so replies read the same from either UI. The
  quote goes before whatever is in the box, where stock replaces it. A quoted reply nests as it is.
  - Rejected: Reply in conversations, where it's clear what's being answered, and on our own messages.

### System

- Check for updates is manual only: slskd's forced check ignores `no_version_check`, so a timer would override that
  opt-out.

### Shares

- The contents are one tree of everything shared, as peers browse it, rather than one share at a time, because the
  per-share endpoint matches aliases with `LIKE` (see the facts). They can be tens of MB, so the list never fetches
  them.

### Files

- Both directories are listed whole with `recursive=true` rather than a level at a time. That gives folder sizes and a
  filter over everything, and listing never needs a path encoded (see the facts).
- Deleting in Incomplete only warns. Matching files to active downloads would mean reading the whole downloads list.
- A delete that touches a shared path isn't treated as a pending rescan: slskd never marks it, and a flag held by one
  tab would be less reliable than slskd's own.

### Events

- Nothing loads the whole table, which slskd never prunes (see the facts). While a filter is on, older pages load from
  a button, so a filter that matches little can't page through the whole table on its own.
  - Rejected: stock's pager, which can jump to the oldest page. Events are read newest first, and a filter finds
    older ones.
- Test events aren't offered: slskd stores them without their data, sends them to webhooks twice, and can't delete them.

### Options

- Units aren't noted in Effective, since that would take a list of keys to keep up with slskd.
- `PATCH /options` isn't used: its change is lost on restart, and editing the file covers it.
