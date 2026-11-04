import { Cross2Icon } from '@radix-ui/react-icons'
import { Box, Button, Callout, Flex, Heading, IconButton, Link, Spinner, Text } from '@radix-ui/themes'
import { Link as RouterLink } from '@tanstack/react-router'
import { type ReactNode, useEffect, useState } from 'react'

import { describeError } from '../lib/api'
import { formatAge, formatTime, useAgo } from '../lib/format'
import { type Atom, isStale, type Resource, useAtom, useFreshness, useResource, useWatchedResource } from '../lib/store'
import { ActionButton, type Color, Tip } from './controls'
import { stopPropagation } from './table'

export function StatusDot({ color }: { color: Color }) {
  return (
    <span
      style={{
        display: 'inline-block',
        flexShrink: 0,
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: `var(--${color}-9)`,
      }}
    />
  )
}

// Marks an icon button, which must be positioned, as having something to look at.
export function CornerDot({ color }: { color: Color }) {
  return (
    <Box position="absolute" top="0" right="0" style={{ lineHeight: 0 }}>
      <StatusDot color={color} />
    </Box>
  )
}

export function DelayedSpinner() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300)
    return () => clearTimeout(timer)
  }, [])
  return visible && <Spinner size="3" />
}

export function Loading() {
  return (
    <Flex justify="center" p="6">
      <DelayedSpinner />
    </Flex>
  )
}

export function Polling({ what, error }: { what: string; error: unknown }) {
  if (error === undefined) return <Loading />
  return (
    <ErrorCallout>
      Can't load {what}: {describeError(error)}. Retrying.
    </ErrorCallout>
  )
}

// For data loaded on demand, which a failure leaves to be asked for again. The children say what failed.
export function Fetching({ error, onRetry, children }: { error: unknown; onRetry: () => void; children: ReactNode }) {
  if (error === undefined) return <Loading />
  return (
    <ErrorCallout onRetry={onRetry}>
      {children}: {describeError(error)}
    </ErrorCallout>
  )
}

export function ErrorCallout({ onRetry, children }: { onRetry?: () => void; children: ReactNode }) {
  return (
    <Box p="4">
      <Callout.Root color="red">
        <Callout.Text>{children}</Callout.Text>
      </Callout.Root>
      {onRetry !== undefined && (
        <Button mt="3" variant="soft" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Box>
  )
}

// The link isn't active on a search's own page, which is under /searches.
export function Missing({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box p="4">
      <Heading size="4" mb="2">
        {title}
      </Heading>
      <Text as="p" color="gray" mb="3">
        {children}
      </Text>
      <Link asChild>
        <RouterLink to="/searches" activeOptions={{ exact: true }}>
          Go to Search
        </RouterLink>
      </Link>
    </Box>
  )
}

export function Empty({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <Flex align="center" gap="3" p="4" wrap="wrap">
      <Text color="gray">{children}</Text>
      {actions}
    </Flex>
  )
}

export function Ago({ time }: { time: number }) {
  return <span title={formatTime(time)}>{useAgo(time)}</span>
}

function UpdateFailed({ error }: { error: unknown }) {
  if (error === undefined) return null
  return (
    <Tip content={describeError(error)}>
      <Text size="1" color="red">
        Update failed
      </Text>
    </Tip>
  )
}

// Until the first data arrives, the page says why it's missing. Without an interval, it's read again only when it
// changes, so it's never stale.
export function Freshness({
  resource,
  interval,
  live,
}: {
  resource: Resource<unknown>
  interval?: number
  live?: boolean
}) {
  const { data, error } = useWatchedResource(resource)
  const age = useFreshness(resource)
  const stale = interval !== undefined && isStale(age, resource.getInterval() ?? interval)
  return (
    <Flex align="center" gap="2">
      {data !== undefined && <UpdateFailed error={error} />}
      <Text size="1" color={live || !stale ? 'gray' : 'amber'}>
        {live ? 'Live' : age === undefined ? 'Not loaded yet' : `Updated ${formatAge(age)} ago`}
      </Text>
    </Flex>
  )
}

export function DismissibleText({
  color = 'red',
  title,
  onDismiss,
  children,
}: {
  color?: Color
  title: string
  onDismiss: () => void
  children: ReactNode
}) {
  return (
    <Flex align="center" gap="1" minWidth="0">
      <Text size="2" color={color} truncate title={title}>
        {children}
      </Text>
      <IconButton
        size="1"
        variant="ghost"
        color="gray"
        aria-label="Dismiss"
        onClick={(event) => {
          stopPropagation(event)
          onDismiss()
        }}
      >
        <Cross2Icon />
      </IconButton>
    </Flex>
  )
}

// Why an action failed, or else why it can't be done yet.
export function ActionNote({
  error,
  gate,
  size,
  mt,
}: {
  error?: string
  gate?: string
  size: '1' | '2'
  mt?: '1' | '2'
}) {
  const text = error ?? gate
  if (text === undefined) return null
  return (
    <Text as="p" size={size} mt={mt} color={error === undefined ? 'gray' : 'red'}>
      {text}
    </Text>
  )
}

export function Busy({ children }: { children: ReactNode }) {
  return (
    <Flex align="center" gap="2" minWidth="0">
      <Spinner size="1" />
      <Text size="2" color="gray" truncate>
        {children}
      </Text>
    </Flex>
  )
}

// For data that's loaded on demand rather than polled.
export function Fetched({
  fetchedAt,
  error,
  loading,
  label = 'Refresh',
  gate,
  onRefresh,
}: {
  fetchedAt?: number
  error?: unknown
  loading: boolean
  label?: string
  gate?: string
  onRefresh: () => void
}) {
  return (
    <Flex align="center" gap="3">
      <UpdateFailed error={error} />
      {fetchedAt !== undefined && (
        <Text size="1" color="gray">
          Updated <Ago time={fetchedAt} />
        </Text>
      )}
      <ActionButton label={label} loading={loading} gate={gate} onClick={onRefresh} />
    </Flex>
  )
}

export function FetchedResource({
  resource,
  loading,
  label,
}: {
  resource: Resource<{ fetchedAt: number }>
  loading: Atom<boolean>
  label?: string
}) {
  const { data, error } = useResource(resource)
  return (
    <Fetched
      fetchedAt={data?.fetchedAt}
      error={data === undefined ? undefined : error}
      loading={useAtom(loading)}
      label={label}
      onRefresh={resource.refresh}
    />
  )
}
