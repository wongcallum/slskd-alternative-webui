import './chat.css'
import { Cross2Icon, PlusIcon } from '@radix-ui/react-icons'
import { Badge, Flex, IconButton, Text, Tooltip, VisuallyHidden } from '@radix-ui/themes'
import { useHotkeys } from '@tanstack/react-hotkeys'
import { Outlet, Link as RouterLink, useLocation, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { describeError } from '../lib/api'
import { plural } from '../lib/format'
import { useFrom } from '../lib/media'
import { useResource } from '../lib/store'
import { useRun } from '../lib/useRun'
import { useSoulseekGate } from '../soulseek/soulseek'
import { disabledProps, GatedIconButton } from '../ui/controls'
import { inOverlay } from '../ui/keys'
import { closeConversation, type Conversation, conversations } from './conversations'
import { JoinRoomDialog } from './JoinRoomDialog'
import type { Target } from './messages'
import { MessageUserField } from './MessageUserField'
import { leaveRoom, useJoinedRooms, useRoomNews } from './rooms'

// Below sm there's room for the list or what's open. Without a room or conversation open the list shows, rather than
// the last one opening again, so there's always a list to go back to.
export function ChatPage() {
  const sm = useFrom('sm')
  const open = useOpenTarget()
  useSwitchKeys(open)
  return (
    <Flex height="100%">
      {(sm || open === undefined) && <Sidebar />}
      {(sm || open !== undefined) && (
        <Flex flexGrow="1" minWidth="0">
          <Outlet />
        </Flex>
      )}
    </Flex>
  )
}

function useOpenTarget() {
  return useLocation({
    select: (location): Target | undefined => {
      const { room, user } = location.search as { room?: string; user?: string }
      if (location.pathname === '/rooms' && room) return { kind: 'room', name: room }
      if (location.pathname === '/chat' && user) return { kind: 'user', name: user }
      return undefined
    },
    structuralSharing: true,
  })
}

// A conversation that hasn't started yet shows while it's open.
function useConversations(openUser?: string) {
  const { data, error } = useResource(conversations)
  const list = data?.list
  const shown: readonly Conversation[] =
    list !== undefined && openUser !== undefined && !list.some((each) => each.username === openUser)
      ? [{ username: openUser, unread: 0 }, ...list]
      : (list ?? [])
  return { list, error, shown }
}

// Alt with ↑ or ↓ moves through the rooms and conversations in the sidebar's order, from the message box too.
function useSwitchKeys(open?: Target) {
  const navigate = useNavigate()
  const { rooms } = useJoinedRooms()
  const { shown } = useConversations(open?.kind === 'user' ? open.name : undefined)
  const targets: Target[] = [
    ...rooms.map((name) => ({ kind: 'room' as const, name })),
    ...shown.map(({ username }) => ({ kind: 'user' as const, name: username })),
  ]
  const at = targets.findIndex((target) => target.kind === open?.kind && target.name === open.name)
  const go = (event: KeyboardEvent, step: number) => {
    const target = targets[at < 0 ? (step > 0 ? 0 : targets.length - 1) : at + step]
    if (target === undefined || inOverlay(event)) return
    if (target.kind === 'room') void navigate({ to: '/rooms', search: { room: target.name } })
    else void navigate({ to: '/chat', search: { user: target.name } })
  }
  useHotkeys(
    [
      {
        hotkey: 'Alt+ArrowUp',
        callback: (event) => go(event, -1),
        options: { meta: { name: 'Previous room or conversation', group: 'page' } },
      },
      {
        hotkey: 'Alt+ArrowDown',
        callback: (event) => go(event, 1),
        options: { meta: { name: 'Next room or conversation', group: 'page' } },
      },
    ],
    { ignoreInputs: false },
  )
}

function Sidebar() {
  const gate = useSoulseekGate()
  const { known, rooms } = useJoinedRooms()
  const open = useOpenTarget()
  const openUser = open?.kind === 'user' ? open.name : undefined
  const { list, error, shown } = useConversations(openUser)
  return (
    <Flex
      direction="column"
      width={{ initial: '100%', sm: '220px' }}
      flexShrink="0"
      overflowY="auto"
      py="2"
      style={{ boxShadow: 'inset -1px 0 0 0 var(--gray-a5)' }}
    >
      <Section
        title="Rooms"
        action={
          <JoinRoomDialog gate={gate}>
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              aria-label="Join a room"
              {...disabledProps(gate !== undefined)}
            >
              <PlusIcon />
            </IconButton>
          </JoinRoomDialog>
        }
      >
        {rooms.map((room) => (
          <RoomItem key={room} room={room} open={open?.kind === 'room' && open.name === room} />
        ))}
        {known && rooms.length === 0 && <Hint>No rooms joined.</Hint>}
      </Section>
      <Section title="Messages">
        <MessageUserField style={{ margin: '0 var(--space-3) var(--space-1) var(--space-4)' }} />
        {list === undefined && error !== undefined && (
          <Text size="1" color="red" mx="4" my="1">
            Can't load the conversations: {describeError(error)}
          </Text>
        )}
        {shown.map((conversation) => (
          <ConversationItem
            key={conversation.username}
            conversation={conversation}
            open={conversation.username === openUser}
            started={conversation.username !== openUser || list?.includes(conversation) === true}
          />
        ))}
      </Section>
    </Flex>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Flex direction="column" mb="3">
      <Flex align="center" justify="between" minHeight="24px" pl="4" pr="3" py="1">
        <Text size="1" weight="medium" color="gray">
          {title}
        </Text>
        {action}
      </Flex>
      {children}
    </Flex>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <Text size="1" color="gray" mx="4" my="1">
      {children}
    </Text>
  )
}

function Item({
  to,
  name,
  open,
  news,
  badge,
  error,
  children,
}: {
  to: ReactNode
  name: string
  open: boolean
  news: boolean
  badge?: ReactNode
  error?: string
  children?: ReactNode
}) {
  return (
    <>
      <div className="chat-item" data-active={open || undefined} data-unread={news || undefined} title={name}>
        {to}
        {badge}
        {children}
      </div>
      {error !== undefined && (
        <Text size="1" color="red" mx="4" mb="1" style={{ wordBreak: 'break-word' }}>
          {error}
        </Text>
      )}
    </>
  )
}

function RoomItem({ room, open }: { room: string; open: boolean }) {
  const gate = useSoulseekGate()
  const navigate = useNavigate()
  const { unread, mentions } = useRoomNews(room)
  const { running, error, run } = useRun()
  const news = !open && unread > 0
  let badge: ReactNode
  if (news) {
    badge =
      mentions > 0 ? (
        <Tooltip content={`${plural(mentions, 'new message')} ${mentions === 1 ? 'mentions' : 'mention'} you`}>
          <Badge color="amber" radius="full">
            {mentions.toLocaleString()}
          </Badge>
        </Tooltip>
      ) : (
        <Tooltip content={plural(unread, 'new message')}>
          <span className="chat-dot">
            <VisuallyHidden>{plural(unread, 'new message')}</VisuallyHidden>
          </span>
        </Tooltip>
      )
  }
  return (
    <Item
      to={
        <RouterLink className="chat-item-name" to="/rooms" search={{ room }}>
          {room}
        </RouterLink>
      }
      name={room}
      open={open}
      news={news}
      badge={badge}
      error={error === undefined ? undefined : `Can't leave: ${error}`}
    >
      <GatedIconButton
        label={`Leave ${room}`}
        gate={running ? 'Leaving' : gate}
        onClick={() =>
          run(async () => {
            await leaveRoom(room)
            if (open) void navigate({ to: '/rooms' })
          })
        }
      >
        <Cross2Icon />
      </GatedIconButton>
    </Item>
  )
}

function ConversationItem({
  conversation: { username, unread },
  open,
  started,
}: {
  conversation: Conversation
  open: boolean
  started: boolean
}) {
  const soulseekGate = useSoulseekGate()
  const navigate = useNavigate()
  const { running, error, run } = useRun()
  // Closing acknowledges what's unread, which needs a Soulseek login.
  const gate = running ? 'Closing' : unread > 0 ? soulseekGate : undefined
  return (
    <Item
      to={
        <RouterLink className="chat-item-name" to="/chat" search={{ user: username }}>
          {username}
        </RouterLink>
      }
      name={username}
      open={open}
      news={unread > 0}
      badge={
        unread > 0 && (
          <Badge color="red" radius="full">
            {unread.toLocaleString()}
          </Badge>
        )
      }
      error={error === undefined ? undefined : `Can't close: ${error}`}
    >
      {started && (
        <GatedIconButton
          label={`Close the conversation with ${username}`}
          gate={gate}
          onClick={() =>
            run(async () => {
              await closeConversation(username)
              if (open) void navigate({ to: '/chat' })
            })
          }
        >
          <Cross2Icon />
        </GatedIconButton>
      )}
    </Item>
  )
}
