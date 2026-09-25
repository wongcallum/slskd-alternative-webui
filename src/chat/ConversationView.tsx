import { Navigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { BrowseUserButton } from '../browse/BrowseUserButton'
import { useAtom, useResource } from '../lib/store'
import { ownUsername } from '../system/application'
import { Loading } from '../ui/status'
import { UserMenu } from '../users/UserMenu'
import { ChatEmpty } from './ChatEmpty'
import { ChatPane } from './ChatPane'
import {
  conversationMessageLimit,
  conversationMessages,
  conversationPollInterval,
  conversations,
  sendMessage,
} from './conversations'
import { MessageLog } from './MessageLog'
import { lastOpen } from './messages'
import { useJoinedRooms } from './rooms'

export function ConversationView({ user }: { user: string }) {
  if (user === '') return <ChatIndex />
  return <OpenConversation key={user} username={user} />
}

// The Chat tab lands here, and returns to whatever was open last, if it's still there.
function ChatIndex() {
  const { known, rooms } = useJoinedRooms()
  const { data, error } = useResource(conversations)
  if (!known || (data === undefined && error === undefined)) return <Loading />
  return <Resume rooms={rooms} users={data?.list.map((each) => each.username) ?? []} />
}

function Resume({ rooms, users }: { rooms: readonly string[]; users: readonly string[] }) {
  const [open] = useState(lastOpen.get)
  if (open?.kind === 'room' && rooms.includes(open.name)) {
    return <Navigate to="/rooms" search={{ room: open.name }} replace />
  }
  if (open?.kind === 'user' && users.includes(open.name)) {
    return <Navigate to="/chat" search={{ user: open.name }} replace />
  }
  return <ChatEmpty />
}

function OpenConversation({ username }: { username: string }) {
  const resource = conversationMessages(username)
  const { data, error } = useResource(resource)
  const started = useResource(conversations).data?.list.some((each) => each.username === username) === true
  const ownName = useAtom(ownUsername)

  useEffect(() => {
    if (started) lastOpen.set({ kind: 'user', name: username })
  }, [started, username])

  return (
    <ChatPane
      target={{ kind: 'user', name: username }}
      title={<UserMenu username={username} here="message" />}
      actions={<BrowseUserButton username={username} directory="" />}
      resource={resource}
      interval={conversationPollInterval}
      error={error}
      send={(text) => sendMessage(username, text)}
      log={
        data && (
          <MessageLog
            messages={data.messages}
            ownName={ownName}
            newFrom={data.newFrom}
            note={
              data.messages.length >= conversationMessageLimit
                ? `slskd returns only the newest ${conversationMessageLimit} messages.`
                : undefined
            }
            empty="No messages yet."
          />
        )
      }
    />
  )
}
