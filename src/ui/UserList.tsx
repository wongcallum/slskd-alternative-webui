import { ReloadIcon, TrashIcon } from '@radix-ui/react-icons'
import { Flex, Link } from '@radix-ui/themes'
import { Link as RouterLink } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { describeError } from '../lib/api'
import type { RecordList } from '../lib/db'
import { GatedIconButton, Toolbar } from './controls'
import { Empty, ErrorCallout, Loading } from './status'
import {
  ActionsCell,
  ColumnHeader,
  GridRow,
  HeaderRow,
  type Layout,
  Parts,
  rowHeight,
  StackedRow,
  stackedHeight,
  type Templates,
  useListLayout,
  VirtualTable,
} from './table'

type Column = { label: string; end?: boolean; wide?: boolean }

const entryKey = (entry: { username: string }) => entry.username

export function UserPage({ toolbar, children }: { toolbar: ReactNode; children: ReactNode }) {
  return (
    <Flex direction="column" height="100%">
      <Toolbar gap="4" py="3">
        {toolbar}
      </Toolbar>
      {children}
    </Flex>
  )
}

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
  templates: Templates
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
  return <UserPage toolbar={toolbar}>{content}</UserPage>
}

type To = '/browse' | '/users'

// Stacked, a status replaces the details while there is one.
export function UserListRow({
  username,
  to,
  layout,
  templates,
  status,
  details,
  cells,
  onDelete,
  again,
}: {
  username: string
  to: To
  layout: Layout
  templates: Templates
  status: ReactNode
  details: ReactNode[]
  cells: ReactNode
  onDelete?: () => void
  again: { label: string; gate?: string; onClick: () => void }
}) {
  const actions = (
    <>
      {onDelete !== undefined && (
        <GatedIconButton label="Delete" onClick={onDelete}>
          <TrashIcon />
        </GatedIconButton>
      )}
      <GatedIconButton label={again.label} gate={again.gate} onClick={again.onClick}>
        <ReloadIcon />
      </GatedIconButton>
    </>
  )
  if (layout === 'stacked') {
    return (
      <StackedRow
        title={<UserLink username={username} to={to} />}
        meta={status ?? <Parts items={details} />}
        actions={actions}
      />
    )
  }
  return (
    <GridRow template={templates[layout]}>
      <div className="table-cell" title={username}>
        <UserLink username={username} to={to} />
      </div>
      {cells}
      <Flex className="table-cell" align="center">
        {status}
      </Flex>
      <ActionsCell>{actions}</ActionsCell>
    </GridRow>
  )
}

function UserLink({ username, to }: { username: string; to: To }) {
  return (
    <Link asChild size="2" weight="medium" truncate>
      <RouterLink to={to} search={{ user: username }}>
        {username}
      </RouterLink>
    </Link>
  )
}
