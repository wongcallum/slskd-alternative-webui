import {
  createRootRoute,
  createRoute,
  createRouter,
  HeadContent,
  lazyRouteComponent,
  redirect,
  stringifySearchWith,
  stripSearchParams,
  useRouter,
} from '@tanstack/react-router'
import { useEffect } from 'react'

import { BrowsePage } from '../browse/BrowsePage'
import { browseSearch, browseSearchDefaults } from '../browse/params'
import { SharePage } from '../browse/share/SharePage'
import { unreadCount } from '../chat/ChatBadge'
import { ChatPage } from '../chat/ChatPage'
import { ConversationView } from '../chat/ConversationView'
import { chatSearch, chatSearchDefaults, roomsSearch, roomsSearchDefaults } from '../chat/params'
import { RoomView } from '../chat/RoomView'
import { DashboardPage, loadChart } from '../dashboard/DashboardPage'
import { dashboardSearch, dashboardSearchDefaults } from '../dashboard/params'
import { useSearchProps } from '../lib/params'
import { onSessionEnd } from '../lib/session'
import { useResource } from '../lib/store'
import { searchesSearch, searchesSearchDefaults } from '../search/params'
import { resultsSearch, resultsSearchDefaults } from '../search/results/params'
import { ResultsPage } from '../search/results/ResultsPage'
import { searches } from '../search/searches'
import { SearchesPage } from '../search/SearchesPage'
import { SessionGate } from '../session/SessionGate'
import { FilesPage } from '../system/files/FilesPage'
import { filesSearch, filesSearchDefaults } from '../system/files/params'
import { InfoPage } from '../system/InfoPage'
import { LogsPage } from '../system/LogsPage'
import { optionsSearch, optionsSearchDefaults } from '../system/options/params'
import { eventsSearch, eventsSearchDefaults, logsSearch, logsSearchDefaults } from '../system/params'
import { sharesSearch, sharesSearchDefaults } from '../system/shares/params'
import { SharesPage } from '../system/shares/SharesPage'
import { transfersSearch, transfersSearchDefaults } from '../transfers/params'
import { TransfersPage } from '../transfers/TransfersPage'
import { trackHistory } from '../ui/focus'
import { usersSearch, usersSearchDefaults } from '../users/params'
import { ProfilePage } from '../users/ProfilePage'
import { UsersPage } from '../users/UsersPage'
import { NotFound, RouteError } from './pages'
import { Shell } from './Shell'

const loadYamlPages = () => import('./yamlPages')

// Loaded soon after the app starts rather than on first use, when a browser that failed to load them once never tries
// again, and slskd may be restarting or have replaced them with a newer build.
setTimeout(() => {
  void loadYamlPages().catch(() => {})
  void loadChart().catch(() => {})
}, 3000)

function title(name: string) {
  const unread = unreadCount()
  return { meta: [{ title: `${unread > 0 ? `(${unread}) ` : ''}${name} – slskd` }] }
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
    throw redirect({ to: '/dashboard' })
  },
})

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'dashboard',
  head: () => title('Dashboard'),
  validateSearch: dashboardSearch,
  search: { middlewares: [stripSearchParams(dashboardSearchDefaults)] },
  component: function Dashboard() {
    return <DashboardPage {...useSearchProps(dashboardRoute.useSearch(), dashboardRoute.useNavigate())} />
  },
})

const searchesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'searches',
  head: () => title('Search'),
  validateSearch: searchesSearch,
  search: { middlewares: [stripSearchParams(searchesSearchDefaults)] },
  component: function Searches() {
    return <SearchesPage {...useSearchProps(searchesRoute.useSearch(), searchesRoute.useNavigate())} />
  },
})

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'searches/$id',
  head: ({ params }) => {
    const text = searches.getSnapshot().data?.byId.get(params.id)?.text
    return title(text === undefined ? 'Search' : `${text} – Search`)
  },
  validateSearch: resultsSearch,
  search: { middlewares: [stripSearchParams(resultsSearchDefaults)] },
  component: function SearchResults() {
    const { id } = searchRoute.useParams()
    const router = useRouter()
    const props = useSearchProps(searchRoute.useSearch(), searchRoute.useNavigate())
    // The title comes from the search list, which usually arrives after the route has loaded.
    const text = useResource(searches).data?.byId.get(id)?.text
    useEffect(() => {
      void router.invalidate({ filter: (match) => match.routeId === searchRoute.id })
    }, [router, text])
    return <ResultsPage key={id} id={id} {...props} />
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
        {...useSearchProps(downloadsRoute.useSearch(), downloadsRoute.useNavigate())}
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
      <TransfersPage direction="upload" {...useSearchProps(uploadsRoute.useSearch(), uploadsRoute.useNavigate())} />
    )
  },
})

const browseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'browse',
  head: ({ match }) => title(match.search.user === '' ? 'Browse' : `${match.search.user} – Browse`),
  validateSearch: browseSearch,
  search: { middlewares: [stripSearchParams(browseSearchDefaults)] },
  component: function Browse() {
    const props = useSearchProps(browseRoute.useSearch(), browseRoute.useNavigate(), 'path')
    if (props.search.user === '') return <BrowsePage />
    return <SharePage key={props.search.user} {...props} />
  },
})

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'users',
  head: ({ match }) => title(match.search.user === '' ? 'Users' : `${match.search.user} – Users`),
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
  head: ({ match }) => title(match.search.room === '' ? 'Chat' : `${match.search.room} – Chat`),
  validateSearch: roomsSearch,
  search: { middlewares: [stripSearchParams(roomsSearchDefaults)] },
  component: function Rooms() {
    return <RoomView room={roomsRoute.useSearch().room} />
  },
})

const conversationRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: 'chat',
  head: ({ match }) => title(match.search.user === '' ? 'Chat' : `${match.search.user} – Chat`),
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

// Stock's Data tab only cleared finished transfers, which Clear finished does on the transfer pages.
const systemDataRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: 'data',
  beforeLoad: () => {
    throw redirect({ to: '/downloads' })
  },
})

const systemInfoRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: 'info',
  head: () => title('Info – System'),
  component: InfoPage,
})

const systemOptionsRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: 'options',
  head: () => title('Options – System'),
  validateSearch: optionsSearch,
  search: { middlewares: [stripSearchParams(optionsSearchDefaults)] },
  component: lazyRouteComponent(loadYamlPages, 'Options'),
})

const systemSharesRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: 'shares',
  head: () => title('Shares – System'),
  validateSearch: sharesSearch,
  search: { middlewares: [stripSearchParams(sharesSearchDefaults)] },
  component: function Shares() {
    return <SharesPage {...useSearchProps(systemSharesRoute.useSearch(), systemSharesRoute.useNavigate(), 'path')} />
  },
})

const systemFilesRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: 'files',
  head: () => title('Files – System'),
  validateSearch: filesSearch,
  search: { middlewares: [stripSearchParams(filesSearchDefaults)] },
  component: function Files() {
    return <FilesPage {...useSearchProps(systemFilesRoute.useSearch(), systemFilesRoute.useNavigate(), 'path')} />
  },
})

const systemEventsRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: 'events',
  head: () => title('Events – System'),
  validateSearch: eventsSearch,
  search: { middlewares: [stripSearchParams(eventsSearchDefaults)] },
  component: lazyRouteComponent(loadYamlPages, 'Events'),
})

const systemLogsRoute = createRoute({
  getParentRoute: () => systemRoute,
  path: 'logs',
  head: () => title('Logs – System'),
  validateSearch: logsSearch,
  search: { middlewares: [stripSearchParams(logsSearchDefaults)] },
  component: function Logs() {
    return <LogsPage {...useSearchProps(systemLogsRoute.useSearch(), systemLogsRoute.useNavigate())} />
  },
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    dashboardRoute,
    searchesRoute,
    searchRoute,
    downloadsRoute,
    uploadsRoute,
    browseRoute,
    usersRoute,
    chatRoute.addChildren([roomsRoute, conversationRoute]),
    systemRoute.addChildren([
      systemIndexRoute,
      systemDataRoute,
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

// Titles come from snapshots the session's end clears, like a search's text, so they're read again once every
// listener has run.
onSessionEnd(() => queueMicrotask(() => void router.invalidate()))

trackHistory(router.history)

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
