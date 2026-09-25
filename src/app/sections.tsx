import type { ReactNode } from 'react'

import { ChatBadge } from '../chat/ChatBadge'
import { DownloadsBadge } from '../transfers/DownloadsBadge'
import type { Direction } from '../transfers/transfers'
import { type To, useIsActive } from '../ui/nav'

type Section = { to: To; also?: To[]; label: string; badge?: ReactNode; direction?: Direction }

export const sections: Section[] = [
  { to: '/searches', label: 'Search' },
  { to: '/downloads', label: 'Downloads', badge: <DownloadsBadge />, direction: 'download' },
  { to: '/uploads', label: 'Uploads', direction: 'upload' },
  { to: '/browse', label: 'Browse' },
  { to: '/users', label: 'Users' },
  { to: '/chat', also: ['/rooms'], label: 'Chat', badge: <ChatBadge /> },
]

export function useSectionLabel() {
  const isActive = useIsActive()
  if (isActive('/system')) return 'System'
  return sections.find((section) => isActive(section.to, section.also))?.label
}
