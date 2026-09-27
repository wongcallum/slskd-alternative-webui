import { ArrowDownIcon } from '@radix-ui/react-icons'
import { Box, Button } from '@radix-ui/themes'
import {
  createContext,
  memo,
  type ReactNode,
  type RefObject,
  type UIEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { formatTime } from '../lib/format'
import { useListKeys } from '../ui/keys'
import { LinkedText } from '../ui/LinkedText'
import { rowAttributes, RowScope, useListNav } from '../ui/listNav'
import type { Message } from './messages'

type PendingLine = { id: number; text: string; sentAt: number; unconfirmed: boolean }

const clock = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' })

const dayOf = (time: number) => new Date(time).toDateString()

type Props = {
  messages: readonly Message[]
  pending?: readonly PendingLine[]
  ownName?: string
  newFrom?: string
  note?: string
  empty: string
  renderName?: (username: string, onReply?: () => void) => ReactNode
  onReply?: (message: Message) => void
}

const none: readonly PendingLine[] = []

const messageKey = (message: Message) => message.key

// The log's scroller, which the composer scrolls with PageUp and PageDown.
export const LogScroll = createContext<RefObject<HTMLDivElement | null> | undefined>(undefined)

// The log sticks to the newest message at the bottom. Once scrolled up it holds still, and counts what arrives.
// The keyboard starts on the newest message, and a line's name and links are reached from it.
export function MessageLog({ messages, pending = none, ownName, newFrom, note, empty, renderName, onReply }: Props) {
  const ownRef = useRef<HTMLDivElement>(null)
  const scrollRef = useContext(LogScroll) ?? ownRef
  const contentRef = useRef<HTMLDivElement>(null)
  const nav = useListNav({
    name: 'messages',
    items: messages,
    itemKey: messageKey,
    label: 'Messages',
    start: 'last',
    scrollRef,
  })
  const { containerRef } = nav
  const setContent = useCallback(
    (element: HTMLDivElement | null) => {
      contentRef.current = element
      containerRef.current = element
    },
    [containerRef],
  )
  const stop = nav.stop
  useListKeys(
    nav.containerRef,
    onReply === undefined
      ? []
      : [
          {
            hotkeys: ['R'],
            name: 'Reply',
            run: () => {
              const message = nav.focused()
              if (message !== undefined && !message.self) onReply(message)
            },
          },
        ],
  )
  // The key of the newest message when the log was scrolled up, or undefined while it follows the bottom.
  const [away, setAway] = useState<string>()
  const following = useRef(true)
  const lastKey = messages.at(-1)?.key ?? ''

  // Resize observers run after layout and before paint, so new lines never show off the bottom first.
  useEffect(() => {
    const scroller = scrollRef.current
    const content = contentRef.current
    if (scroller === null || content === null) return
    const observer = new ResizeObserver(() => {
      if (following.current) scroller.scrollTop = scroller.scrollHeight
    })
    observer.observe(scroller)
    observer.observe(content)
    return () => observer.disconnect()
  }, [scrollRef])

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 2
    if (following.current) {
      if (away !== undefined) setAway(undefined)
    } else if (away === undefined) setAway(lastKey)
  }

  const unseen = useMemo(() => {
    if (away === undefined) return 0
    const index = messages.findIndex((message) => message.key === away)
    return messages.slice(index + 1).filter((message) => !message.self).length
  }, [messages, away])

  const rows = useMemo(() => {
    const name = ownName ?? 'You'
    const list: ReactNode[] = []
    let day = ''
    for (const [index, message] of messages.entries()) {
      const next = dayOf(message.time)
      if (next !== day) {
        list.push(
          <div key={`day ${next}`} className="chat-divider">
            {dayFormat.format(message.time)}
          </div>,
        )
        day = next
      }
      if (message.key === newFrom) {
        list.push(
          <div key="new" className="chat-divider" data-new>
            New
          </div>,
        )
      }
      list.push(
        <MessageRow
          key={message.key}
          message={message}
          index={index}
          tabbable={index === stop}
          ownName={name}
          renderName={renderName}
          onReply={onReply}
        />,
      )
    }
    for (const line of pending) {
      list.push(<PendingRow key={`pending ${line.id}`} line={line} username={name} />)
    }
    return list
  }, [messages, pending, newFrom, ownName, renderName, onReply, stop])

  return (
    <Box position="relative" flexGrow="1" minHeight="0">
      <div ref={scrollRef} className="chat-scroll" data-following={away === undefined || undefined} onScroll={onScroll}>
        <div ref={setContent} className="chat-log" {...nav.containerProps}>
          {note !== undefined && <div className="chat-note">{note}</div>}
          {rows.length === 0 ? <div className="chat-note">{empty}</div> : rows}
        </div>
      </div>
      {unseen > 0 && (
        <Button
          className="chat-jump"
          size="1"
          radius="full"
          onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}
        >
          {unseen.toLocaleString()} new
          <ArrowDownIcon />
        </Button>
      )}
    </Box>
  )
}

const MessageRow = memo(function MessageRow({
  message,
  index,
  tabbable,
  ownName,
  renderName,
  onReply,
}: {
  message: Message
  index: number
  tabbable: boolean
  ownName: string
  renderName?: (username: string, onReply?: () => void) => ReactNode
  onReply?: (message: Message) => void
}) {
  const name = message.self ? ownName : message.username
  return (
    <div
      className="chat-line"
      data-self={message.self || undefined}
      data-mention={message.mention || undefined}
      {...rowAttributes(index, tabbable)}
    >
      <RowScope tabbable={tabbable}>
        <span className="chat-time" title={formatTime(message.time)}>
          {clock.format(message.time)}
        </span>
        <span className="chat-name" title={name}>
          {message.self || renderName === undefined ? name : renderName(name, onReply && (() => onReply(message)))}
        </span>
        <span className="chat-text">
          <LinkedText>{message.text}</LinkedText>
        </span>
      </RowScope>
    </div>
  )
})

function PendingRow({ line, username }: { line: PendingLine; username: string }) {
  return (
    <div
      className="chat-line"
      data-self
      data-pending
      title={
        line.unconfirmed
          ? "The server didn't echo it back, so it may not have arrived"
          : 'Sent, waiting for the server to echo it back'
      }
    >
      <span className="chat-time" title={formatTime(line.sentAt)}>
        {clock.format(line.sentAt)}
      </span>
      <span className="chat-name">{username}</span>
      <span className="chat-text">
        {line.text}
        {line.unconfirmed && <span className="chat-status">not confirmed</span>}
      </span>
    </div>
  )
}
