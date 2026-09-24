import { Box, Button, Callout, Heading, Link, Text } from '@radix-ui/themes'
import { type ErrorComponentProps, Link as RouterLink } from '@tanstack/react-router'
import { describeError } from './api'

export function Placeholder({ title }: { title: string }) {
  return (
    <Box p="5">
      <Heading mb="2">{title}</Heading>
      <Text color="gray">Not built yet.</Text>
    </Box>
  )
}

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
  return (
    <Box p="5">
      <Callout.Root color="red" mb="3">
        <Callout.Text>This page crashed: {describeError(error)}</Callout.Text>
      </Callout.Root>
      <Button variant="soft" onClick={reset}>
        Try again
      </Button>
    </Box>
  )
}
