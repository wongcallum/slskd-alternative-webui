import { PersonIcon } from '@radix-ui/react-icons'
import { Button, Flex, Text } from '@radix-ui/themes'
import { Navigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { useFrom } from '../lib/media'
import { useAtom, useResource } from '../lib/store'
import { useRun } from '../lib/useRun'
import { useSoulseekGate } from '../soulseek/soulseek'
import { ownUsername } from '../system/application'
import { disabledProps } from '../ui/controls'
import { Loading } from '../ui/status'
import { renderUserMenu } from '../users/UserMenu'
import { ChatEmpty } from './ChatEmpty'
import { ChatPane, ChatToolbar } from './ChatPane'
import { MessageLog } from './MessageLog'
import { lastOpen } from './messages'
import {
  joinRoom,
  markSeen,
  pendingMessages,
  roomMessageLimit,
  roomMessages,
  roomPollInterval,
  roomUsers,
  sendToRoom,
  setOpenRoom,
  useJoinedRooms,
} from './rooms'
import { RoomUsers } from './RoomUsers'

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

function NotJoined({ room }: { room: string }) {
  const gate = useSoulseekGate()
  const { running, error, run } = useRun()
  return (
    <Flex direction="column" flexGrow="1">
      <ChatToolbar title={room} />
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
  const md = useFrom('md')
  const [usersShown, setUsersShown] = useState(false)
  const userCount = useResource(roomUsers(room)).data?.users.length
  const resource = roomMessages(room)
  const { data, error } = useResource(resource)
  const pending = useAtom(pendingMessages).get(room)
  const ownName = useAtom(ownUsername)
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
      <ChatPane
        target={{ kind: 'room', name: room }}
        actions={
          !md && (
            <Button
              size="1"
              variant={usersShown ? 'solid' : 'soft'}
              color="gray"
              aria-pressed={usersShown}
              onClick={() => setUsersShown((shown) => !shown)}
            >
              <PersonIcon />
              {userCount === undefined ? 'Users' : userCount.toLocaleString()}
            </Button>
          )
        }
        instead={!md && usersShown ? <RoomUsers room={room} fill /> : undefined}
        resource={resource}
        interval={roomPollInterval}
        error={error}
        send={(text) => sendToRoom(room, text)}
        log={
          data && (
            <MessageLog
              messages={data.messages}
              pending={pending}
              ownName={ownName}
              note={
                data.messages.length >= roomMessageLimit
                  ? `slskd keeps only the newest ${roomMessageLimit} messages.`
                  : undefined
              }
              empty="No messages since slskd joined."
              renderName={renderUserMenu}
            />
          )
        }
      />
      {md && <RoomUsers room={room} />}
    </Flex>
  )
}
