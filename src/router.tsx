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
import { BrowsePage, type BrowseSearch, browseSearch, browseSearchDefaults } from './Browse'
import { NotFound, RouteError } from './pages'
import { useResource } from './store'
import {
  rememberedFilters,
  type ResultsSearch,
  resultsSearch,
  resultsSearchDefaults,
  SearchResultsPage,
} from './SearchResults'
import { type SearchesSearch, SearchesPage, searchesSearch, searchesSearchDefaults } from './Searches'
import { searches } from './searches'
import { SessionGate } from './SessionGate'
import { SharePage } from './Share'
import { Shell } from './Shell'
import { TransfersPage, type TransfersSearch, transfersSearch, transfersSearchDefaults } from './Transfers'

const title = (name: string) => ({ meta: [{ title: `${name} · slskd` }] })

const rootRoute = createRootRoute({
  // Every page route sets its own title, so only unmatched paths are left with this one.
  head: () => title('Page not found'),
  component: Root,
  notFoundComponent: NotFound,
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
    const navigate = searchesRoute.useNavigate()
    return (
      <SearchesPage
        search={searchesRoute.useSearch()}
        onSearchChange={(patch: Partial<SearchesSearch>) =>
          navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true })
        }
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
  beforeLoad: ({ search, params }) => {
    const filters = rememberedFilters(search)
    if (filters !== undefined) throw redirect({ to: '/searches/$id', params, search: { ...search, ...filters } })
  },
  component: function SearchResults() {
    const { id } = searchRoute.useParams()
    const navigate = searchRoute.useNavigate()
    const router = useRouter()
    // The title comes from the search list, which usually arrives after the route has loaded.
    const text = useResource(searches).data?.byId.get(id)?.text
    useEffect(() => {
      void router.invalidate({ filter: (match) => match.routeId === searchRoute.id })
    }, [router, text])
    return (
      <SearchResultsPage
        key={id}
        id={id}
        search={searchRoute.useSearch()}
        onSearchChange={(patch: Partial<ResultsSearch>) =>
          navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true })
        }
      />
    )
  },
})

const downloadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'downloads',
  head: () => title('Downloads'),
  validateSearch: transfersSearch,
  search: { middlewares: [stripSearchParams(transfersSearchDefaults)] },
  component: function Downloads() {
    const navigate = downloadsRoute.useNavigate()
    return (
      <TransfersPage
        direction="download"
        search={downloadsRoute.useSearch()}
        onSearchChange={(patch: Partial<TransfersSearch>) =>
          navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true })
        }
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
    const navigate = uploadsRoute.useNavigate()
    return (
      <TransfersPage
        direction="upload"
        search={uploadsRoute.useSearch()}
        onSearchChange={(patch: Partial<TransfersSearch>) =>
          navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true })
        }
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
    const navigate = browseRoute.useNavigate()
    const search = browseRoute.useSearch()
    const onSearchChange = useCallback(
      (patch: Partial<BrowseSearch>) => navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true }),
      [navigate],
    )
    if (search.user === '') return <BrowsePage />
    return <SharePage key={search.user} search={search} onSearchChange={onSearchChange} />
  },
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, searchesRoute, searchRoute, downloadsRoute, uploadsRoute, browseRoute]),
  basepath: window.urlBase,
  defaultErrorComponent: RouteError,
  parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
  stringifySearch: stringifySearchWith(String),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
