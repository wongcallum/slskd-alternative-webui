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
- Shares are stored as the response Blob, which costs the main thread nothing to write (see the facts).
- There's no `navigator.storage.persist()`, because Firefox would prompt for it.

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

Only Cancel all, Retry failed and Clear finished (which act on the whole section whatever the filter), Restart, Shut
down and deleting files ask for confirmation.

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

### Responsiveness

**Accepted gaps:**

- Safari ignores `interactive-widget=resizes-content` and pans the page for the keyboard rather than shrinking the
  layout, so the composer can end up under it.
- Names cut short keep their full text in `title` attributes only, which touch can't reach (Details has it for
  transfers and results).
- The sort strip scrolls with no visible hint.

### Transfers

- Rows have `contain: strict`, which makes scrolling far cheaper: scrolling 25k search results in 1,500 px jumps went
  from 28 long tasks in 30 jumps to 0–4.

### Search

- slskd picks a new search's id, because `crypto.randomUUID` needs a secure context and plain-HTTP LAN installs
  aren't one.
- Stock packs filter criteria into the text box as a syntax (see the facts). We dropped it for a Filters popover,
  because its keywords collide with path text and can't be discovered.
- The results page never reads the downloads list. Rows show Enqueued or Failed from the batch responses.
- **A folder's full contents come from the user's whole share**, the one Browse caches, rather than a request for
  the folder. slskd peers answer that request with files from other folders under bare names, so some listed paths
  don't exist (see the facts), and old slskds will stay on the network long after a fix. A cached share is read
  without asking the peer, and getting the folder again browses afresh.
  - Rejected: trusting the answer, telling slskd peers apart by what they send, and dropping the button for the
    row's Browse.

### Browse

- Two tabs browsing the same user at once is an accepted gap, although slskd can cross their results.

### Users

- Profile in a name's menu always looks the user up, unlike Browse, which opens a cached share. A lookup is one server
  request and one small message to the peer, and a stale presence or queue length is what would mislead.
- Names have a menu (Profile, Message, Browse) wherever they appear, leaving out the page it's on.

### Chat

- The open room's users are polled every 30 s, since they only change as people join and leave, and a busy room's
  list is hundreds of KB.

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
- Test events aren't offered: slskd stores them without their data, sends them to webhooks twice, and can't delete them.

### Options

- Units aren't noted in Effective, since that would take a list of keys to keep up with slskd.
- `PATCH /options` isn't used: its change is lost on restart, and editing the file covers it.
