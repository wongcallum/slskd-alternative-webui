import './controls.css'
import { Cross2Icon, InfoCircledIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons'
import {
  AlertDialog,
  Box,
  Button,
  Checkbox,
  DataList,
  Flex,
  type FlexProps,
  IconButton,
  Popover,
  Select,
  Text,
  TextField,
  type TextProps,
  Tooltip,
} from '@radix-ui/themes'
import {
  cloneElement,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useDeferredValue,
  useRef,
  useState,
} from 'react'

import { type Actions, dismissOutcome, type Progress } from '../lib/actions'
import { formatBytes } from '../lib/format'
import { useFrom, useTouch } from '../lib/media'
import { type Atom, useAtom } from '../lib/store'
import { focusList, returnToList } from './focus'
import { displayKey } from './keys'
import { useRowTabIndex } from './listNav'
import { stop } from './table'

export type Color = NonNullable<TextProps['color']>

export const toolbarStyle = { boxShadow: 'inset 0 -1px 0 0 var(--gray-a5)' }

// Below sm, selection actions take a line of their own under the rest.
export function Toolbar({
  gap = '3',
  py = '2',
  children,
}: {
  gap?: FlexProps['gap']
  py?: FlexProps['py']
  children: ReactNode
}) {
  return (
    <Flex className="toolbar" align="center" gap={gap} wrap="wrap" px="4" py={py} flexShrink="0" style={toolbarStyle}>
      {children}
    </Flex>
  )
}

export function ToolbarEnd({ children }: { children: ReactNode }) {
  return (
    <Flex ml="auto" align="center" gap="4" flexShrink="0">
      {children}
    </Flex>
  )
}

// Disabled actions stay focusable so their tooltip can say why. Radix disables a button while it's loading unless told
// otherwise, which would drop the focus of whoever pressed it.
export const disabledProps = (disabled: boolean) => ({
  disabled: false,
  'aria-disabled': disabled || undefined,
  'data-disabled': disabled || undefined,
})

// A tooltip that a tap opens too, for what can't be learned elsewhere: why an action is disabled, or what went wrong.
// Radix's tooltips never open from touch. A control's label or key isn't worth a tap, which then goes straight to the
// control. A control keeps its tooltip while it has nothing to say, since swapping the wrapper would remount it and
// lose its focus.
export function Tip({ content, tap = true, children }: { content?: ReactNode; tap?: boolean; children: ReactElement }) {
  const touch = useTouch()
  const tabIndex = useRowTabIndex() ?? 0
  const [open, setOpen] = useState(false)
  // Text that explains something is made focusable, so the keyboard reaches what it says too.
  const trigger =
    typeof children.props === 'object' && children.props !== null && 'onClick' in children.props
      ? children
      : cloneElement(children as ReactElement<{ tabIndex?: number }>, { tabIndex })
  if (!touch || !tap || content === undefined) {
    return (
      <Tooltip
        content={<span style={{ whiteSpace: 'pre-line' }}>{content}</span>}
        open={open && content !== undefined}
        onOpenChange={setOpen}
      >
        {trigger}
      </Tooltip>
    )
  }
  return (
    <Popover.Root>
      <Popover.Trigger onClick={stop}>{trigger}</Popover.Trigger>
      <Popover.Content size="1" maxWidth="320px" onClick={stop}>
        <Text as="p" size="2" style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
          {content}
        </Text>
      </Popover.Content>
    </Popover.Root>
  )
}

export function GateTip({ gate, label, children }: { gate?: string; label: string; children: ReactElement }) {
  return (
    <Tip content={gate ?? label} tap={gate !== undefined}>
      {children}
    </Tip>
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
  const button = (
    <IconButton
      size="1"
      variant="ghost"
      color={color}
      aria-label={label}
      tabIndex={useRowTabIndex()}
      {...disabledProps(gate !== undefined)}
      onClick={() => gate === undefined && onClick()}
    >
      {children}
    </IconButton>
  )
  return (
    <GateTip gate={gate} label={label}>
      {button}
    </GateTip>
  )
}

// A key in the list that does what the button does, which its tooltip names.
export type Shortcut = { key: string; name: string }

// While there's progress, the button counts it after its busy label.
type ActionButtonProps = {
  label: string
  busy?: string
  progress?: Progress
  loading?: boolean
  gate?: string
  color?: 'red' | 'amber'
  shortcut?: Shortcut
  onClick: () => void
}

export function ActionButton({ label, busy, progress, loading, gate, color, shortcut, onClick }: ActionButtonProps) {
  const disabled = gate !== undefined || progress !== undefined || loading === true
  const button = (
    <Button
      size="1"
      variant="soft"
      color={color}
      loading={loading}
      aria-keyshortcuts={shortcut?.key}
      {...disabledProps(disabled)}
      onClick={() => !disabled && onClick()}
    >
      {progress === undefined
        ? label
        : `${busy ?? label} ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`}
    </Button>
  )
  let tip = gate
  if (progress !== undefined) tip = undefined
  else if (gate === undefined && shortcut !== undefined) tip = `${shortcut.name} (${displayKey(shortcut.key)})`
  return (
    <Tip content={tip} tap={gate !== undefined}>
      {button}
    </Tip>
  )
}

type ConfirmProps = {
  title: string
  description: string
  action: string
  color?: 'red' | 'amber'
  onConfirm: () => void
}

// Radix returns focus to a dialog's trigger, but some dialogs have none: a gated button mustn't open one, and a key
// opens one from a list. Focus goes back to wherever it was when the dialog opened, or to the list it was in if the
// dialog's action removed it.
export function useReturnFocus() {
  const opener = useRef<Element | null>(null)
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault()
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus()
      else returnToList()
    },
  }
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  color,
  onConfirm,
}: ConfirmProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Content maxWidth="440px" {...useReturnFocus()}>
        <AlertDialog.Title>{title}</AlertDialog.Title>
        <AlertDialog.Description size="2">{description}</AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Back
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color={color} onClick={onConfirm}>
              {action}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  )
}

export function ConfirmButton({
  title,
  description,
  action,
  onConfirm,
  ...button
}: Omit<ActionButtonProps, 'onClick'> & ConfirmProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <ActionButton {...button} onClick={() => setOpen(true)} />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        action={action}
        color={button.color}
        onConfirm={onConfirm}
      />
    </>
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

// ↓ and Escape go to the list the field filters, to the row the keyboard was last on. In a dialog, Escape closes it
// first.
export const toList = (list?: string) =>
  list === undefined
    ? undefined
    : (event: KeyboardEvent) => {
        if (event.key !== 'ArrowDown' && event.key !== 'Escape') return
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        if (focusList(list)) event.preventDefault()
      }

// The page's main field is the one / focuses.
export const mainField = (main?: boolean) => ({ 'data-main-field': main || undefined })

// Given a width, the field has it from sm and fills its line below.
export function FilterField({
  placeholder,
  value,
  onChange,
  width,
  style,
  main,
  list,
  onEnter,
}: {
  placeholder: string
  value: string
  onChange: (value: string) => void
  width?: string
  style?: CSSProperties
  main?: boolean
  list?: string
  onEnter?: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const field = (
    <TextField.Root
      ref={input}
      size="2"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || onEnter === undefined || event.nativeEvent.isComposing) toList(list)?.(event)
        else {
          event.preventDefault()
          onEnter()
        }
      }}
      style={style}
      {...mainField(main)}
    >
      <TextField.Slot>
        <MagnifyingGlassIcon />
      </TextField.Slot>
      {value !== '' && (
        <TextField.Slot side="right">
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            aria-label="Clear filter"
            onClick={() => {
              onChange('')
              input.current?.focus()
            }}
          >
            <Cross2Icon />
          </IconButton>
        </TextField.Slot>
      )}
    </TextField.Root>
  )
  if (width === undefined) return field
  return (
    <Box flexGrow={{ initial: '1', sm: '0' }} flexBasis={{ initial: '160px', sm: width }} minWidth="0">
      {field}
    </Box>
  )
}

export type Choices<V extends string> = readonly (readonly [V, string, ...unknown[]])[]

export function ChoiceSelect<V extends string>({
  choices,
  value,
  onChange,
  id,
  label,
  size,
  soft,
}: {
  choices: Choices<V>
  value: V
  onChange: (value: V) => void
  id?: string
  label?: string
  size?: '1' | '2'
  soft?: boolean
}) {
  return (
    <Select.Root size={size} value={value} onValueChange={(next) => onChange(next as V)}>
      <Select.Trigger
        id={id}
        variant={soft ? 'soft' : undefined}
        color={soft ? 'gray' : undefined}
        aria-label={label}
      />
      <Select.Content>
        {choices.map(([choice, text]) => (
          <Select.Item key={choice} value={choice}>
            {text}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
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
  const sm = useFrom('sm')
  return (
    <Flex className="toolbar-selection" align="center" gap="2" wrap="wrap">
      {count !== undefined && (
        <Text size="2" color="gray">
          {count.toLocaleString()} selected
        </Text>
      )}
      {!sm && (
        <IconButton size="1" variant="ghost" color="gray" aria-label="Clear selection" onClick={onClear}>
          <Cross2Icon />
        </IconButton>
      )}
      {children}
      {sm && (
        <Button size="1" variant="ghost" color="gray" onClick={onClear}>
          Clear selection
        </Button>
      )}
    </Flex>
  )
}

export type Detail = [string, ReactNode]

export const fileDetails = (file: { username: string; directory: string; name: string; size: number }): Detail[] => [
  ['User', file.username],
  ['Folder', file.directory],
  ['File', file.name],
  ['Size', `${formatBytes(file.size)} (${file.size.toLocaleString()} bytes)`],
]

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
        <IconButton size="1" variant="ghost" color="gray" aria-label="Details" tabIndex={useRowTabIndex()}>
          <InfoCircledIcon />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content width="480px">{children}</Popover.Content>
    </Popover.Root>
  )
}
