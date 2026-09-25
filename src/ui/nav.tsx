import { TabNav } from '@radix-ui/themes'
import { Link, type LinkProps, useMatchRoute } from '@tanstack/react-router'
import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react'

// TabNav draws its own divider in --gray-a5 under the tabs, which would double up with the bar's.
export function NavTabs({ children }: { children: ReactNode }) {
  return <TabNav.Root style={{ '--gray-a5': 'transparent', minWidth: 0 } as CSSProperties}>{children}</TabNav.Root>
}

export type To = NonNullable<LinkProps['to']>

const none: To[] = []

export function useIsActive() {
  const matchRoute = useMatchRoute()
  return (to: To, also = none) => [to, ...also].some((path) => matchRoute({ to: path, fuzzy: true }) !== false)
}

// TabNav's list scrolls sideways when the tabs don't fit, so a tab that opens scrolls itself into view.
export function NavTab({ to, also = none, children }: { to: To; also?: To[]; children: ReactNode }) {
  const active = useIsActive()(to, also)
  const ref = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])
  return (
    <TabNav.Link asChild active={active}>
      <Link ref={ref} to={to}>
        {children}
      </Link>
    </TabNav.Link>
  )
}
