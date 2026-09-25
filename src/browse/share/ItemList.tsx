import { ChevronRightIcon, FileIcon, LockClosedIcon } from '@radix-ui/react-icons'
import { Flex, Spinner, Text } from '@radix-ui/themes'
import { memo, useCallback } from 'react'
import { formatBytes, formatDuration } from '../../lib/format'
import { useAtom } from '../../lib/store'
import type { Mark } from '../../transfers/enqueue'
import { MarkBadge } from '../../transfers/MarkBadge'
import { Cell, CheckCell, ColumnHeader, GridRow, HeaderRow, rowId, useRowToggle, VirtualTable } from '../../ui/table'
import { shareDownloadsOf } from '../browse'
import type { BrowseSearch } from '../params'
import type { Folder, Share, ShareFile } from '../shareTree'
import {
  columnLabels,
  endAligned,
  folderColumns,
  folderTemplate,
  type Item,
  matchColumns,
  matchTemplate,
  type PaneRow,
  type PaneTable,
} from './paneTable'

type Props = {
  share: Share
  table: PaneTable
  filtered: boolean
  folderOf: (item: Item) => string
  onSearchChange: (patch: Partial<BrowseSearch>) => void
}

export function ItemList({ share, table, filtered, folderOf, onSearchChange }: Props) {
  const { pending, marks } = useAtom(shareDownloadsOf(share.username))
  const rows = table.getRowModel().rows
  const onSelect = useRowToggle(table)
  const onOpen = useCallback((folder: Folder) => onSearchChange({ path: folder.path }), [onSearchChange])
  const ids = filtered ? matchColumns : folderColumns
  const template = filtered ? matchTemplate : folderTemplate

  const header = (
    <HeaderRow template={template} table={table}>
      {ids.map((id) => (
        <ColumnHeader key={id} label={columnLabels[id]} end={endAligned.has(id)} column={table.getColumn(id)} />
      ))}
    </HeaderRow>
  )

  function render(row: PaneRow) {
    const item = row.original
    if (item.kind === 'folder') {
      return (
        <SubfolderRow
          folder={item}
          template={template}
          selected={row.getIsSelected()}
          onSelect={onSelect}
          onOpen={onOpen}
        />
      )
    }
    return (
      <FileRow
        file={item}
        template={template}
        folder={filtered ? folderOf(item) : undefined}
        separator={share.separator}
        selected={row.getIsSelected()}
        pending={pending.has(item.id)}
        mark={marks.get(item.id)}
        onSelect={onSelect}
      />
    )
  }

  return (
    <VirtualTable minWidth={filtered ? 810 : 780} header={header} items={rows} itemKey={rowId} renderItem={render} />
  )
}

type SubfolderRowProps = {
  folder: Folder
  template: string
  selected: boolean
  onSelect: (id: string, shiftKey: boolean) => void
  onOpen: (folder: Folder) => void
}

const SubfolderRow = memo(function SubfolderRow({ folder, template, selected, onSelect, onOpen }: SubfolderRowProps) {
  const id = `folder\n${folder.id}`
  return (
    <GridRow
      template={template}
      group
      selected={selected}
      dimmed={folder.locked}
      style={{ cursor: 'pointer' }}
      onClick={() => onOpen(folder)}
    >
      <CheckCell
        selected={selected}
        disabled={folder.fileCount === folder.lockedCount}
        onToggle={(shiftKey) => onSelect(id, shiftKey)}
      />
      <Flex className="table-cell" align="center" gap="2" title={folder.name}>
        {folder.locked ? <LockClosedIcon style={{ flexShrink: 0 }} /> : <ChevronRightIcon style={{ flexShrink: 0 }} />}
        <Text size="2" weight="medium" truncate>
          {folder.name}
        </Text>
      </Flex>
      <Cell end>{folder.fileCount.toLocaleString()}</Cell>
      <Cell end>{formatBytes(folder.size)}</Cell>
      <Cell title={folder.qualityLabel}>{folder.qualityLabel}</Cell>
      <Cell end>{folder.length > 0 && formatDuration(folder.length)}</Cell>
    </GridRow>
  )
})

type FileRowProps = {
  file: ShareFile
  template: string
  folder?: string
  separator: string
  selected: boolean
  pending: boolean
  mark?: Mark
  onSelect: (id: string, shiftKey: boolean) => void
}

const FileRow = memo(function FileRow({
  file,
  template,
  folder,
  separator,
  selected,
  pending,
  mark,
  onSelect,
}: FileRowProps) {
  const id = `file\n${file.id}`
  return (
    <GridRow
      template={template}
      selected={selected}
      dimmed={file.locked}
      onClick={(event) => !file.locked && onSelect(id, event.shiftKey)}
    >
      <CheckCell selected={selected} disabled={file.locked} onToggle={(shiftKey) => onSelect(id, shiftKey)} />
      <Flex className="table-cell" align="center" gap="2" title={file.filename}>
        {file.locked ? <LockClosedIcon style={{ flexShrink: 0 }} /> : <FileIcon style={{ flexShrink: 0 }} />}
        <Text size="2" truncate>
          {file.name}
        </Text>
        {mark !== undefined && <MarkBadge mark={mark} />}
        {pending && <Spinner size="1" />}
      </Flex>
      {folder === undefined ? (
        <div className="table-cell" />
      ) : (
        <Cell title={folder}>{folder.split(separator).join(' › ')}</Cell>
      )}
      <Cell end>{formatBytes(file.size)}</Cell>
      <Cell>{file.qualityLabel}</Cell>
      <Cell end>{file.length !== undefined && formatDuration(file.length)}</Cell>
    </GridRow>
  )
})
