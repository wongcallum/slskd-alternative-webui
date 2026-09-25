import { Box, Button, Callout, Flex, Spinner, Text, Tooltip } from '@radix-ui/themes'
import { type ReactNode, useEffect, useState } from 'react'

import { describeError } from '../lib/api'
import { formatAge, formatTime, useAgo } from '../lib/format'
import { isStale, type Resource, useFreshness } from '../lib/store'
import type { Color } from './controls'

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

export function Empty({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <Flex align="center" gap="3" p="5" wrap="wrap">
      <Text color="gray">{children}</Text>
      {actions}
    </Flex>
  )
}

export function Ago({ time }: { time: number }) {
  return <span title={formatTime(time)}>{useAgo(time)}</span>
}

export function Freshness({
  resource,
  interval,
  error,
  live,
}: {
  resource: Resource<unknown>
  interval: number
  error: unknown
  live?: boolean
}) {
  const age = useFreshness(resource)
  const stale = isStale(age, resource.getInterval() ?? interval)
  return (
    <Flex align="center" gap="2">
      {error !== undefined && (
        <Tooltip content={describeError(error)}>
          <Text size="1" color="red">
            Last poll failed
          </Text>
        </Tooltip>
      )}
      <Text size="1" color={live || !stale ? 'gray' : 'amber'}>
        {live ? 'live' : age === undefined ? 'not loaded yet' : `updated ${formatAge(age)} ago`}
      </Text>
    </Flex>
  )
}
