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
import { useResource } from '../lib/store'
import { type ResultsSearch, resultsSearch, resultsSearchDefaults } from '../search/results/params'
import { ResultsPage } from '../search/results/ResultsPage'
import { searches } from '../search/searches'
import { type SearchesSearch, SearchesPage, searchesSearch, searchesSearchDefaults } from '../search/SearchesPage'
import { SessionGate } from '../session/SessionGate'
import { InfoPage } from '../system/InfoPage'
import { type LogsSearch, LogsPage, logsSearch, logsSearchDefaults } from '../system/LogsPage'
import {
  TransfersPage,
  type TransfersSearch,
  transfersSearch,
  transfersSearchDefaults,
} from '../transfers/TransfersPage'
import { NotFound, RouteError } from './pages'
import { Shell } from './Shell'

const title = (name: string) => ({ meta: [{ title: `${name} · slskd` }] })

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
    systemRoute.addChildren([systemIndexRoute, systemInfoRoute, systemLogsRoute]),
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
