import { Cross2Icon, InfoCircledIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons'
import {
  AlertDialog,
  Button,
  Checkbox,
  DataList,
  Flex,
  IconButton,
  Popover,
  Text,
  TextField,
  type TextProps,
  Tooltip,
} from '@radix-ui/themes'
import { type CSSProperties, type ReactNode, useDeferredValue, useState } from 'react'

import { type Actions, dismissOutcome, type Progress } from '../lib/actions'
import { type Atom, useAtom } from '../lib/store'

export type Color = NonNullable<TextProps['color']>

export const toolbarStyle = { boxShadow: 'inset 0 -1px 0 0 var(--gray-a5)' }

// Disabled actions stay focusable so their tooltip can say why.
export const disabledProps = (disabled: boolean) => ({
  'aria-disabled': disabled || undefined,
  'data-disabled': disabled || undefined,
})

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
        {...disabledProps(gate !== undefined)}
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
  color?: 'red' | 'amber'
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
      {...disabledProps(disabled)}
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

// The field shows what's typed, and follows the URL only when it changes from elsewhere, such as on Back.
export function useFilterText(q: string, onChange: (q: string) => void) {
  const [text, setText] = useState(q)
  const [urlText, setUrlText] = useState(q)
  if (q !== urlText) {
    setUrlText(q)
    setText(q)
  }
  return {
    text,
    query: useDeferredValue(text),
    change: (value: string) => {
      setText(value)
      setUrlText(value)
      onChange(value)
    },
  }
}

export function FilterField({
  placeholder,
  value,
  onChange,
  style,
}: {
  placeholder: string
  value: string
  onChange: (value: string) => void
  style: CSSProperties
}) {
  return (
    <TextField.Root
      size="2"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={style}
    >
      <TextField.Slot>
        <MagnifyingGlassIcon />
      </TextField.Slot>
    </TextField.Root>
  )
}

export function CheckboxField({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}) {
  return (
    <Text as="label" size="2">
      <Flex gap="2" align="center">
        <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
        {children}
      </Flex>
    </Text>
  )
}

export function SelectionActions({
  count,
  onClear,
  children,
}: {
  count?: number
  onClear: () => void
  children: ReactNode
}) {
  return (
    <Flex align="center" gap="2">
      {count !== undefined && (
        <Text size="2" color="gray">
          {count.toLocaleString()} selected
        </Text>
      )}
      {children}
      <Button size="1" variant="ghost" color="gray" onClick={onClear}>
        Clear selection
      </Button>
    </Flex>
  )
}

export type Detail = [string, ReactNode]

export function DetailList({ rows }: { rows: Detail[] }) {
  return (
    <DataList.Root size="1">
      {rows.map(([label, value]) => (
        <DataList.Item key={label}>
          <DataList.Label minWidth="120px">{label}</DataList.Label>
          <DataList.Value style={{ wordBreak: 'break-word' }}>{value}</DataList.Value>
        </DataList.Item>
      ))}
    </DataList.Root>
  )
}

export function DetailsButton({ children }: { children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger>
        <IconButton size="1" variant="ghost" color="gray" aria-label="Details">
          <InfoCircledIcon />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content width="480px">{children}</Popover.Content>
    </Popover.Root>
  )
}
