import {
  createRootRoute,
  createRoute,
  createRouter,
  HeadContent,
  redirect,
  stringifySearchWith,
  stripSearchParams,
} from '@tanstack/react-router'
import { NotFound, Placeholder, RouteError } from './pages'
import { SessionGate } from './SessionGate'
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
  // TODO: phase 5 replaces this placeholder with the search pages.
  component: () => <Placeholder title="Search" />,
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
  head: () => title('Browse'),
  // TODO: phase 6 replaces this placeholder with the browse pane.
  component: () => <Placeholder title="Browse" />,
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, searchesRoute, downloadsRoute, uploadsRoute, browseRoute]),
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
