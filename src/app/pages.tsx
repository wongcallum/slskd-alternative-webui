import { Box, Heading, Link, Text } from '@radix-ui/themes'
import { type ErrorComponentProps, Link as RouterLink } from '@tanstack/react-router'
import { describeError } from '../lib/api'
import { ErrorCallout } from '../ui/status'

export function NotFound() {
  return (
    <Box p="5">
      <Heading mb="2">Page not found</Heading>
      <Text as="p" color="gray" mb="3">
        There's no page at this address.
      </Text>
      <Link asChild>
        <RouterLink to="/searches" activeOptions={{ exact: true }}>
          Go to Search
        </RouterLink>
      </Link>
    </Box>
  )
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  return <ErrorCallout onRetry={reset}>This page crashed: {describeError(error)}</ErrorCallout>
}
