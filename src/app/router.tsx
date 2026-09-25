import {
  createRootRoute,
  createRoute,
  createRouter,
  HeadContent,
  redirect,
  stringifySearchWith,
  stripSearchParams,
  useRouter,
} from '@tanstack/react-router'
import { useCallback, useEffect } from 'react'

import { BrowsePage } from '../browse/BrowsePage'
import { type BrowseSearch, browseSearch, browseSearchDefaults } from '../browse/params'
import { SharePage } from '../browse/share/SharePage'
import { unreadCount } from '../chat/ChatBadge'
import { ChatPage } from '../chat/ChatPage'
import { ConversationView } from '../chat/ConversationView'
import { chatSearch, chatSearchDefaults, roomsSearch, roomsSearchDefaults } from '../chat/params'
import { RoomView } from '../chat/RoomView'
import { useResource } from '../lib/store'
import { type ResultsSearch, resultsSearch, resultsSearchDefaults } from '../search/results/params'
import { ResultsPage } from '../search/results/ResultsPage'
import { searches } from '../search/searches'
import { type SearchesSearch, SearchesPage, searchesSearch, searchesSearchDefaults } from '../search/SearchesPage'
import { SessionGate } from '../session/SessionGate'
import { type EventsSearch, EventsPage, eventsSearch, eventsSearchDefaults } from '../system/EventsPage'
import { FilesPage } from '../system/files/FilesPage'
import { type FilesSearch, filesSearch, filesSearchDefaults } from '../system/files/params'
import { InfoPage } from '../system/InfoPage'
import { type LogsSearch, LogsPage, logsSearch, logsSearchDefaults } from '../system/LogsPage'
import { OptionsPage } from '../system/options/OptionsPage'
import { type OptionsSearch, optionsSearch, optionsSearchDefaults } from '../system/options/params'
import { type SharesSearch, sharesSearch, sharesSearchDefaults } from '../system/shares/params'
import { SharesPage } from '../system/shares/SharesPage'
import {
  TransfersPage,
  type TransfersSearch,
  transfersSearch,
  transfersSearchDefaults,
} from '../transfers/TransfersPage'
import { usersSearch, usersSearchDefaults } from '../users/params'
import { ProfilePage } from '../users/ProfilePage'
import { UsersPage } from '../users/UsersPage'
import { NotFound, RouteError } from './pages'
import { Shell } from './Shell'

function title(name: string) {
  const unread = unreadCount()
  return { meta: [{ title: `${unread > 0 ? `(${unread}) ` : ''}${name} · slskd` }] }
}

// Params that filter or sort replace the history entry. Changing a navigation param pushes one, so Back returns to it.
function useSearchChange<T extends object>(
  navigate: (options: { search: (previous: T) => T; replace: boolean }) => Promise<void>,
  navigation?: keyof T,
) {
  return useCallback(
    (patch: Partial<T>) =>
      navigate({
        search: (previous) => ({ ...previous, ...patch }),
        replace: navigation === undefined || !(navigation in patch),
      }),
    [navigate, navigation],
  )
}

const rootRoute = createRootRoute({
  // Every page route sets its own title, so only unmatched paths are left with this one.
  head: () => title('Page not found'),
  component: Root,
})

function Root() {
  return (
    <>
      <HeadContent />
      <SessionGate>
        <Shell />
      </SessionGate>
    </>
  )
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/searches' })
  },
})

const searchesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'searches',
  head: () => title('Search'),
  validateSearch: searchesSearch,
  search: { middlewares: [stripSearchParams(searchesSearchDefaults)] },
  component: function Searches() {
    return (
      <SearchesPage
        search={searchesRoute.useSearch()}
        onSearchChange={useSearchChange<SearchesSearch>(searchesRoute.useNavigate())}
      />
    )
  },
})

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'searches/$id',
  head: ({ params }) => title(searches.getSnapshot().data?.byId.get(params.id)?.text ?? 'Search'),
  validateSearch: resultsSearch,
  search: { middlewares: [stripSearchParams(resultsSearchDefaults)] },
  component: function SearchResults() {
    const { id } = searchRoute.useParams()
    const router = useRouter()
    const onSearchChange = useSearchChange<ResultsSearch>(searchRoute.useNavigate())
    // The title comes from the search list, which usually arrives after the route has loaded.
    const text = useResource(searches).data?.byId.get(id)?.text
    useEffect(() => {
      void router.invalidate({ filter: (match) => match.routeId === searchRoute.id })
    }, [router, text])
    return <ResultsPage key={id} id={id} search={searchRoute.useSearch()} onSearchChange={onSearchChange} />
  },
})

const downloadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'downloads',
  head: () => title('Downloads'),
  validateSearch: transfersSearch,
  search: { middlewares: [stripSearchParams(transfersSearchDefaults)] },
  component: function Downloads() {
    return (
      <TransfersPage
        direction="download"
        search={downloadsRoute.useSearch()}
        onSearchChange={useSearchChange<TransfersSearch>(downloadsRoute.useNavigate())}
      />
    )
  },
})

const uploadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'uploads',
  head: () => title('Uploads'),
  validateSearch: transfersSearch,
  search: { middlewares: [stripSearchParams(transfersSearchDefaults)] },
  component: function Uploads() {
    return (
      <TransfersPage
        direction="upload"
        search={uploadsRoute.useSearch()}
        onSearchChange={useSearchChange<TransfersSearch>(uploadsRoute.useNavigate())}
      />
    )
  },
})

const browseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'browse',
  head: ({ match }) => title(match.search.user === '' ? 'Browse' : `${match.search.user} · Browse`),
  validateSearch: browseSearch,
  search: { middlewares: [stripSearchParams(browseSearchDefaults)] },
  component: function Browse() {
    const search = browseRoute.useSearch()
    const onSearchChange = useSearchChange<BrowseSearch>(browseRoute.useNavigate(), 'path')
    if (search.user === '') return <BrowsePage />
    return <SharePage key={search.user} search={search} onSearchChange={onSearchChange} />
  },
})

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'users',
  head: ({ match }) => title(match.search.user === '' ? 'Users' : `${match.search.user} · Users`),
  validateSearch: usersSearch,
  search: { middlewares: [stripSearchParams(usersSearchDefaults)] },
  component: function Users() {
    const { user } = usersRoute.useSearch()
    if (user === '') return <UsersPage />
    return <ProfilePage key={user} username={user} />
  },
})

// The rooms and conversations share one page, whose sidebar stays mounted while switching between them.
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'chat',
  component: ChatPage,
})

const roomsRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: 'rooms',
  head: ({ match }) => title(match.search.room === '' ? 'Chat' : `${match.search.room} · Chat`),
  validateSearch: roomsSearch,
  search: { middlewares: [stripSearchParams(roomsSearchDefaults)] },
  component: function Rooms() {
    return <RoomView room={roomsRoute.useSearch().room} />
  },
})

const conversationRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: 'chat',
  head: ({ match }) => title(match.search.user === '' ? 'Chat' : `${match.search.user} · Chat`),
  validateSearch: chatSearch,
  search: { middlewares: [stripSearchParams(chatSearchDefaults)] },
  component: function Conversation() {
    return <ConversationView user={conversationRoute.useSearch().user} />
  },
})

const systemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'system',
})

const systemIndexRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/system/info' })
  },
})

const systemInfoRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: 'info',
  head: () => title('System'),
  component: InfoPage,
})

const systemOptionsRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: 'options',
  head: () => title('Options · System'),
  validateSearch: optionsSearch,
  search: { middlewares: [stripSearchParams(optionsSearchDefaults)] },
  component: function Options() {
    return (
      <OptionsPage
        search={systemOptionsRoute.useSearch()}
        onSearchChange={useSearchChange<OptionsSearch>(systemOptionsRoute.useNavigate())}
      />
    )
  },
})

const systemSharesRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: 'shares',
  head: () => title('Shares · System'),
  validateSearch: sharesSearch,
  search: { middlewares: [stripSearchParams(sharesSearchDefaults)] },
  component: function Shares() {
    return (
      <SharesPage
        search={systemSharesRoute.useSearch()}
        onSearchChange={useSearchChange<SharesSearch>(systemSharesRoute.useNavigate(), 'path')}
      />
    )
  },
})

const systemFilesRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: 'files',
  head: () => title('Files · System'),
  validateSearch: filesSearch,
  search: { middlewares: [stripSearchParams(filesSearchDefaults)] },
  component: function Files() {
    return (
      <FilesPage
        search={systemFilesRoute.useSearch()}
        onSearchChange={useSearchChange<FilesSearch>(systemFilesRoute.useNavigate(), 'path')}
      />
    )
  },
})

const systemEventsRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: 'events',
  head: () => title('Events · System'),
  validateSearch: eventsSearch,
  search: { middlewares: [stripSearchParams(eventsSearchDefaults)] },
  component: function Events() {
    return (
      <EventsPage
        search={systemEventsRoute.useSearch()}
        onSearchChange={useSearchChange<EventsSearch>(systemEventsRoute.useNavigate())}
      />
    )
  },
})

const systemLogsRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: 'logs',
  head: () => title('Logs · System'),
  validateSearch: logsSearch,
  search: { middlewares: [stripSearchParams(logsSearchDefaults)] },
  component: function Logs() {
    return (
      <LogsPage
        search={systemLogsRoute.useSearch()}
        onSearchChange={useSearchChange<LogsSearch>(systemLogsRoute.useNavigate())}
      />
    )
  },
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    searchesRoute,
    searchRoute,
    downloadsRoute,
    uploadsRoute,
    browseRoute,
    usersRoute,
    chatRoute.addChildren([roomsRoute, conversationRoute]),
    systemRoute.addChildren([
      systemIndexRoute,
      systemInfoRoute,
      systemOptionsRoute,
      systemSharesRoute,
      systemFilesRoute,
      systemEventsRoute,
      systemLogsRoute,
    ]),
  ]),
  basepath: window.urlBase,
  // A route with children and no notFoundComponent of its own renders this one for its unmatched paths.
  defaultNotFoundComponent: NotFound,
  defaultErrorComponent: RouteError,
  parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
  stringifySearch: stringifySearchWith(String),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
