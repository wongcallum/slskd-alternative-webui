import { TabNav } from '@radix-ui/themes'
import { Link, type LinkProps, useMatchRoute } from '@tanstack/react-router'
import type { CSSProperties, ReactNode } from 'react'

// TabNav draws its own divider in --gray-a5 under the tabs, which would double up with the bar's.
export function NavTabs({ children }: { children: ReactNode }) {
  return <TabNav.Root style={{ '--gray-a5': 'transparent' } as CSSProperties}>{children}</TabNav.Root>
}

export function NavTab({ to, children }: { to: NonNullable<LinkProps['to']>; children: ReactNode }) {
  const matchRoute = useMatchRoute()
  return (
    <TabNav.Link asChild active={Boolean(matchRoute({ to, fuzzy: true }))}>
      <Link to={to}>{children}</Link>
    </TabNav.Link>
  )
}
