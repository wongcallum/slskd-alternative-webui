import './chat.css'
import { Cross2Icon, PlusIcon } from '@radix-ui/react-icons'
import { Badge, Flex, IconButton, Text, Tooltip } from '@radix-ui/themes'
import { Outlet, Link as RouterLink, useLocation, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { useRun } from '../lib/useRun'
import { useSoulseekGate } from '../soulseek/soulseek'
import { disabledProps, GatedIconButton } from '../ui/controls'
import { JoinRoomDialog } from './JoinRoomDialog'
import { leaveRoom, useJoinedRooms, useRoomNews } from './rooms'

export function ChatPage() {
  return (
    <Flex height="100%">
      <Sidebar />
      <Flex flexGrow="1" minWidth="0">
        <Outlet />
      </Flex>
    </Flex>
  )
}

function Sidebar() {
  const gate = useSoulseekGate()
  const { known, rooms } = useJoinedRooms()
  const openRoom = useLocation({
    select: (location) => (location.pathname === '/rooms' ? (location.search as { room?: string }).room : undefined),
  })
  return (
    <Flex
      direction="column"
      width="220px"
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
          <RoomItem key={room} room={room} open={room === openRoom} />
        ))}
        {known && rooms.length === 0 && <Hint>No rooms joined.</Hint>}
      </Section>
    </Flex>
  )
}

function Section({ title, action, children }: { title: string; action: ReactNode; children: ReactNode }) {
  return (
    <Flex direction="column" mb="3">
      <Flex align="center" justify="between" pl="4" pr="3" py="1">
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

function RoomItem({ room, open }: { room: string; open: boolean }) {
  const gate = useSoulseekGate()
  const navigate = useNavigate()
  const { unread, mentions } = useRoomNews(room)
  const { running, error, run } = useRun()
  const news = !open && unread > 0
  return (
    <>
      <div className="chat-item" data-active={open || undefined} data-unread={news || undefined}>
        <RouterLink className="chat-item-name" to="/rooms" search={{ room }} title={room}>
          {room}
        </RouterLink>
        {news &&
          (mentions > 0 ? (
            <Tooltip content={`${mentions.toLocaleString()} new mentioning you`}>
              <Badge color="amber" radius="full">
                {mentions.toLocaleString()}
              </Badge>
            </Tooltip>
          ) : (
            <Tooltip content={`${unread.toLocaleString()} new`}>
              <span className="chat-dot" />
            </Tooltip>
          ))}
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
      </div>
      {error !== undefined && (
        <Text size="1" color="red" mx="4" mb="1" style={{ wordBreak: 'break-word' }}>
          Can't leave: {error}
        </Text>
      )}
    </>
  )
}
