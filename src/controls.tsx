import { ArrowDownIcon, ArrowUpIcon, Cross2Icon } from '@radix-ui/react-icons'
import { AlertDialog, Button, Flex, IconButton, Popover, Text, Tooltip } from '@radix-ui/themes'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type Key, type ReactNode, useRef, useState } from 'react'
import { type Actions, dismissOutcome, type Progress } from './actions'
import { describeError } from './api'
import { formatAge, formatTime, useAgo } from './format'
import { type Atom, isStale, type Resource, useAtom, useFreshness } from './store'

// Clicks on controls inside a row mustn't also select or expand it, and React bubbles clicks out of portals too.
export const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

export const preventShiftSelection = (event: { shiftKey: boolean; preventDefault: () => void }) => {
  if (event.shiftKey) event.preventDefault()
}

export function Ago({ time }: { time: number }) {
  return <span title={formatTime(time)}>{useAgo(time)}</span>
}

export const toolbarStyle = { boxShadow: 'inset 0 -1px 0 0 var(--gray-a5)' }

export function SortButton({
  label,
  sorted,
  onClick,
}: {
  label: string
  sorted: false | 'asc' | 'desc' | undefined
  onClick?: (event: unknown) => void
}) {
  return (
    <button type="button" className="table-sort table-label" onClick={onClick}>
      {label}
      {sorted === 'asc' ? <ArrowUpIcon /> : sorted === 'desc' ? <ArrowDownIcon /> : null}
    </button>
  )
}

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

export const rowHeight = 36

export const columnsHeight = 32

// Rows have a fixed height, and the column header sticks to the top while scrolling with the rows sideways.
export function VirtualTable({
  minWidth,
  header,
  count,
  getItemKey,
  renderRow,
}: {
  minWidth: number
  header: ReactNode
  count: number
  getItemKey: (index: number) => Key
  renderRow: (index: number) => ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey,
    overscan: 10,
    scrollMargin: columnsHeight,
  })
  return (
    <div ref={scrollRef} className="table-scroll">
      <div className="table-head" style={{ minWidth, height: columnsHeight }}>
        {header}
      </div>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth }}>
        {virtualizer.getVirtualItems().map((virtual) => (
          <div
            key={virtual.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: virtual.size,
              transform: `translateY(${virtual.start - columnsHeight}px)`,
              contain: 'strict',
            }}
          >
            {renderRow(virtual.index)}
          </div>
        ))}
      </div>
    </div>
  )
}
