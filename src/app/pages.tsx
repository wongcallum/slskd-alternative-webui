import type { ErrorComponentProps } from '@tanstack/react-router'

import { describeError } from '../lib/api'
import { ErrorCallout, Missing } from '../ui/status'

export function NotFound() {
  return <Missing title="Page not found">There's no page at this address.</Missing>
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  return <ErrorCallout onRetry={reset}>This page crashed: {describeError(error)}</ErrorCallout>
}
