import { Badge, Tooltip } from '@radix-ui/themes'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useSyncExternalStore } from 'react'

import { plural } from '../lib/format'
import { conversations } from './conversations'

export const unreadCount = () => conversations.getSnapshot().data?.unread ?? 0

// Unless polled, the count is whatever the last poll found.
export function useUnread(poll = true) {
  const snapshot = useSyncExternalStore(poll ? conversations.subscribe : conversations.watch, conversations.getSnapshot)
  return snapshot.data?.unread ?? 0
}

export function ChatBadge() {
  const unread = useUnread()
  if (unread === 0) return null
  return (
    <Tooltip content={plural(unread, 'unread private message')}>
      <Badge ml="2" radius="full" color="red">
        {unread.toLocaleString()}
      </Badge>
    </Tooltip>
  )
}

// Page titles lead with the unread count, so a tab in the background shows it too.
export function useUnreadInTitle() {
  const router = useRouter()
  useEffect(() => {
    let shown = unreadCount()
    return conversations.watch(() => {
      if (unreadCount() === shown) return
      shown = unreadCount()
      void router.invalidate()
    })
  }, [router])
}
