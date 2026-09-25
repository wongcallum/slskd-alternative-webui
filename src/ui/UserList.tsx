import { Flex, Link } from '@radix-ui/themes'
import { Link as RouterLink } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { describeError } from '../lib/api'
import type { RecordList } from '../lib/db'
import { Toolbar } from './controls'
import { Empty, ErrorCallout, Loading } from './status'
import { ColumnHeader, HeaderRow, type Layout, rowHeight, stackedHeight, useListLayout, VirtualTable } from './table'

type Column = { label: string; end?: boolean; wide?: boolean }

const entryKey = (entry: { username: string }) => entry.username

// A landing page: a box to ask for a user, over everyone stored, running or failed.
export function UserListPage<E extends { username: string }>({
  toolbar,
  list,
  what,
  empty,
  templates,
  minWidth,
  columns,
  entries,
  renderRow,
}: {
  toolbar: ReactNode
  list: RecordList<unknown>
  what: string
  empty: string
  templates: Record<Exclude<Layout, 'stacked'>, string>
  minWidth: number
  columns: Column[]
  entries: readonly E[]
  renderRow: (entry: E, layout: Layout) => ReactNode
}) {
  const layout = useListLayout()
  let content: ReactNode
  if (!list.loaded) content = <Loading />
  else if (entries.length === 0) {
    content =
      list.error === undefined ? (
        <Empty>{empty}</Empty>
      ) : (
        <ErrorCallout>
          Can't read {what}: {describeError(list.error)}
        </ErrorCallout>
      )
  } else {
    const header = layout !== 'stacked' && (
      <HeaderRow template={templates[layout]}>
        {columns
          .filter((column) => layout === 'wide' || column.wide !== true)
          .map((column) => (
            <ColumnHeader key={column.label} label={column.label} end={column.end} />
          ))}
        <div />
      </HeaderRow>
    )
    content = (
      <VirtualTable
        minWidth={layout === 'wide' ? minWidth : 0}
        header={header || undefined}
        items={entries}
        itemKey={entryKey}
        rowSize={layout === 'stacked' ? stackedHeight : rowHeight}
        renderItem={(entry) => renderRow(entry, layout)}
      />
    )
  }
  return (
    <Flex direction="column" height="100%">
      <Toolbar gap="4" py="3">
        {toolbar}
      </Toolbar>
      {content}
    </Flex>
  )
}

export function UserLink({ username, to }: { username: string; to: '/browse' | '/users' }) {
  return (
    <Link asChild size="2" weight="medium" truncate>
      <RouterLink to={to} search={{ user: username }}>
        {username}
      </RouterLink>
    </Link>
  )
}

export function UserLinkCell({ username, to }: { username: string; to: '/browse' | '/users' }) {
  return (
    <div className="table-cell" title={username}>
      <UserLink username={username} to={to} />
    </div>
  )
}
