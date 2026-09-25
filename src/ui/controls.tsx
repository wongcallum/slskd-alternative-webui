import { Cross2Icon } from '@radix-ui/react-icons'
import { AlertDialog, Button, Flex, IconButton, Popover, Spinner, Text, Tooltip } from '@radix-ui/themes'
import { type ReactNode, useEffect, useState } from 'react'
import { type Actions, dismissOutcome, type Progress } from '../lib/actions'
import { describeError } from '../lib/api'
import { formatAge, formatTime, useAgo } from '../lib/format'
import { type Atom, isStale, type Resource, useAtom, useFreshness } from '../lib/store'

export function DelayedSpinner() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300)
    return () => clearTimeout(timer)
  }, [])
  return visible && <Spinner size="3" />
}

export function Ago({ time }: { time: number }) {
  return <span title={formatTime(time)}>{useAgo(time)}</span>
}

export const toolbarStyle = { boxShadow: 'inset 0 -1px 0 0 var(--gray-a5)' }

export function GatedIconButton({
  label,
  gate,
  color = 'gray',
  onClick,
  children,
}: {
  label: string
  gate?: string
  color?: 'gray' | 'red'
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip content={gate ?? label}>
      <IconButton
        size="1"
        variant="ghost"
        color={color}
        aria-label={label}
        aria-disabled={gate !== undefined || undefined}
        data-disabled={gate !== undefined || undefined}
        onClick={() => gate === undefined && onClick()}
      >
        {children}
      </IconButton>
    </Tooltip>
  )
}

type ActionButtonProps = {
  label: string
  busy: string
  progress?: Progress
  loading?: boolean
  gate?: string
  color?: 'red'
  onClick: () => void
}

export function ActionButton({ label, busy, progress, loading, gate, color, onClick }: ActionButtonProps) {
  const disabled = gate !== undefined || progress !== undefined || loading === true
  const button = (
    <Button
      size="1"
      variant="soft"
      color={color}
      loading={loading}
      aria-disabled={disabled || undefined}
      data-disabled={disabled || undefined}
      onClick={() => !disabled && onClick()}
    >
      {progress === undefined
        ? label
        : `${busy} ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`}
    </Button>
  )
  return gate === undefined || progress !== undefined ? button : <Tooltip content={gate}>{button}</Tooltip>
}

export function ConfirmButton({
  title,
  description,
  action,
  onConfirm,
  ...button
}: Omit<ActionButtonProps, 'onClick'> & { title: string; description: string; action: string; onConfirm: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <ActionButton {...button} onClick={() => setOpen(true)} />
      <AlertDialog.Content maxWidth="440px">
        <AlertDialog.Title>{title}</AlertDialog.Title>
        <AlertDialog.Description size="2">{description}</AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Back
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color={button.color} onClick={onConfirm}>
              {action}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  )
}

export function OutcomeLine<S extends Actions<string>>({ atom }: { atom: Atom<S> }) {
  const { outcome } = useAtom(atom)
  if (outcome === undefined) return null
  const color = outcome.failed ? 'red' : 'gray'
  return (
    <Flex align="center" gap="1">
      {outcome.details.length === 0 ? (
        <Text size="2" color={color}>
          {outcome.summary}
        </Text>
      ) : (
        <Popover.Root>
          <Popover.Trigger>
            <Button size="1" variant="ghost" color={color}>
              {outcome.summary}
            </Button>
          </Popover.Trigger>
          <Popover.Content width="480px" maxHeight="360px">
            <Flex direction="column" gap="1">
              {outcome.details.map((detail, index) => (
                // oxlint-disable-next-line react/no-array-index-key -- details can repeat and never reorder
                <Text key={index} size="1" style={{ wordBreak: 'break-word' }}>
                  {detail}
                </Text>
              ))}
            </Flex>
          </Popover.Content>
        </Popover.Root>
      )}
      <IconButton size="1" variant="ghost" color="gray" aria-label="Dismiss" onClick={() => dismissOutcome(atom)}>
        <Cross2Icon />
      </IconButton>
    </Flex>
  )
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
