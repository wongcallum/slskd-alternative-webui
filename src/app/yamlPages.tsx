import { getRouteApi } from '@tanstack/react-router'

import { EventsPage } from '../system/EventsPage'
import { OptionsPage } from '../system/options/OptionsPage'
import { useSearchProps } from './search'

const optionsRoute = getRouteApi('/system/options')

export function Options() {
  return <OptionsPage {...useSearchProps(optionsRoute.useSearch(), optionsRoute.useNavigate())} />
}

const eventsRoute = getRouteApi('/system/events')

export function Events() {
  return <EventsPage {...useSearchProps(eventsRoute.useSearch(), eventsRoute.useNavigate())} />
}
