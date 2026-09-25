import { getRouteApi } from '@tanstack/react-router'

import { EventsPage } from '../system/EventsPage'
import { OptionsPage } from '../system/options/OptionsPage'
import type { OptionsSearch } from '../system/options/params'
import type { EventsSearch } from '../system/params'
import { useSearchChange } from './search'

const optionsRoute = getRouteApi('/system/options')

export function Options() {
  return (
    <OptionsPage
      search={optionsRoute.useSearch()}
      onSearchChange={useSearchChange<OptionsSearch>(optionsRoute.useNavigate())}
    />
  )
}

const eventsRoute = getRouteApi('/system/events')

export function Events() {
  return (
    <EventsPage
      search={eventsRoute.useSearch()}
      onSearchChange={useSearchChange<EventsSearch>(eventsRoute.useNavigate())}
    />
  )
}
