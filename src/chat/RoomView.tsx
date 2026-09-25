import { Button, Flex, Text } from '@radix-ui/themes'
import { Navigate } from '@tanstack/react-router'
import { type ReactNode, useEffect, useState } from 'react'

import { useAtom, useResource } from '../lib/store'
import { useRun } from '../lib/useRun'
import { useSoulseekGate } from '../soulseek/soulseek'
import { application } from '../system/application'
import { disabledProps, toolbarStyle } from '../ui/controls'
import { Freshness, Loading, Polling } from '../ui/status'
import { ChatEmpty } from './ChatEmpty'
import { Composer } from './Composer'
import { MessageLog } from './MessageLog'
import { lastOpen, targetKey } from './messages'
import {
  joinRoom,
  markSeen,
  pendingMessages,
  roomMessageLimit,
  roomMessages,
  roomPollInterval,
  sendToRoom,
  setOpenRoom,
  useJoinedRooms,
} from './rooms'
import { RoomUsers } from './RoomUsers'
import { renderUserMenu } from './UserMenu'

export function RoomView({ room }: { room: string }) {
  const { known, rooms } = useJoinedRooms()
  if (!known) return <Loading />
  if (room === '') return <RoomsIndex rooms={rooms} />
  if (!rooms.includes(room)) return <NotJoined room={room} />
  return <JoinedRoom key={room} room={room} />
}

// Without a room, the last one open is shown, or the only one joined. That's decided once: STATE lists a room
// being joined before slskd can answer for it.
function RoomsIndex({ rooms }: { rooms: readonly string[] }) {
  const [fallback] = useState(() => {
    const open = lastOpen.get()
    if (open?.kind === 'room' && rooms.includes(open.name)) return open.name
    return rooms.length === 1 ? rooms[0] : undefined
  })
  if (fallback !== undefined) return <Navigate to="/rooms" search={{ room: fallback }} replace />
  return <ChatEmpty />
}

function Toolbar({ room, children }: { room: string; children?: ReactNode }) {
  return (
    <Flex align="center" gap="3" px="4" py="2" flexShrink="0" minHeight="45px" style={toolbarStyle}>
      <Text weight="bold" truncate>
        {room}
      </Text>
      {children}
    </Flex>
  )
}

function NotJoined({ room }: { room: string }) {
  const gate = useSoulseekGate()
  const { running, error, run } = useRun()
  return (
    <Flex direction="column" flexGrow="1">
      <Toolbar room={room} />
      <Flex direction="column" align="start" gap="3" p="5">
        <Text color="gray">You're not in this room.</Text>
        <Button
          loading={running}
          {...disabledProps(gate !== undefined)}
          onClick={() => gate === undefined && run(() => joinRoom(room))}
        >
          Join {room}
        </Button>
        {(error ?? gate) !== undefined && (
          <Text size="2" color={error === undefined ? 'gray' : 'red'}>
            {error ?? gate}
          </Text>
        )}
      </Flex>
    </Flex>
  )
}

function JoinedRoom({ room }: { room: string }) {
  const resource = roomMessages(room)
  const { data, error } = useResource(resource)
  const pending = useAtom(pendingMessages).get(room)
  const username = useResource(application).data?.username
  const newest = data?.messages.at(-1)?.time

  useEffect(() => {
    setOpenRoom(room)
    lastOpen.set({ kind: 'room', name: room })
    return () => setOpenRoom(undefined)
  }, [room])

  useEffect(() => {
    if (newest === undefined) return
    const see = () => {
      if (!document.hidden) markSeen(room, newest)
    }
    see()
    document.addEventListener('visibilitychange', see)
    return () => document.removeEventListener('visibilitychange', see)
  }, [room, newest])

  return (
    <Flex flexGrow="1" minWidth="0" height="100%">
      <Flex direction="column" flexGrow="1" minWidth="0">
        <Toolbar room={room}>
          <Flex ml="auto" align="center" flexShrink="0">
            <Freshness resource={resource} interval={roomPollInterval} error={data === undefined ? undefined : error} />
          </Flex>
        </Toolbar>
        {data === undefined ? (
          <Flex flexGrow="1">
            <Polling what="the room" error={error} />
          </Flex>
        ) : (
          <MessageLog
            messages={data.messages}
            pending={pending}
            username={username}
            note={
              data.messages.length >= roomMessageLimit
                ? `slskd keeps the last ${roomMessageLimit} messages.`
                : undefined
            }
            empty="No messages since slskd joined."
            renderName={renderUserMenu}
          />
        )}
        <Composer
          draftKey={targetKey({ kind: 'room', name: room })}
          placeholder={`Message ${room}`}
          send={(text) => sendToRoom(room, text)}
        />
      </Flex>
      <RoomUsers room={room} />
    </Flex>
  )
}
