import { Flex, Link } from '@radix-ui/themes'
import { Link as RouterLink } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { describeError } from '../lib/api'
import type { RecordList } from '../lib/db'
import { toolbarStyle } from './controls'
import { Empty, ErrorCallout, Loading } from './status'
import { ColumnHeader, HeaderRow, VirtualTable } from './table'

type Column = { label: string; end?: boolean }

const entryKey = (entry: { username: string }) => entry.username

// A landing page: a box to ask for a user, over everyone stored, running or failed.
export function UserListPage<E extends { username: string }>({
  toolbar,
  list,
  what,
  empty,
  template,
  minWidth,
  columns,
  entries,
  renderRow,
}: {
  toolbar: ReactNode
  list: RecordList<unknown>
  what: string
  empty: string
  template: string
  minWidth: number
  columns: Column[]
  entries: readonly E[]
  renderRow: (entry: E) => ReactNode
}) {
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
    const header = (
      <HeaderRow template={template}>
        {columns.map((column) => (
          <ColumnHeader key={column.label} label={column.label} end={column.end} />
        ))}
        <div />
      </HeaderRow>
    )
    content = (
      <VirtualTable minWidth={minWidth} header={header} items={entries} itemKey={entryKey} renderItem={renderRow} />
    )
  }
  return (
    <Flex direction="column" height="100%">
      <Flex align="center" gap="4" px="4" py="3" flexShrink="0" style={toolbarStyle}>
        {toolbar}
      </Flex>
      {content}
    </Flex>
  )
}

export function UserLinkCell({ username, to }: { username: string; to: '/browse' | '/users' }) {
  return (
    <div className="table-cell" title={username}>
      <Link asChild size="2" weight="medium">
        <RouterLink to={to} search={{ user: username }}>
          {username}
        </RouterLink>
      </Link>
    </div>
  )
}
