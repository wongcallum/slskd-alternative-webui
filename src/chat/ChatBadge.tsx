import { Badge, Tooltip } from '@radix-ui/themes'
import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'

import { plural } from '../lib/format'
import { useResource } from '../lib/store'
import { conversations } from './conversations'

export const unreadCount = () => conversations.getSnapshot().data?.unread ?? 0

export function ChatBadge() {
  const unread = useResource(conversations).data?.unread ?? 0
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
