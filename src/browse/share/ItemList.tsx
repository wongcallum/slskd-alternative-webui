import { ChevronRightIcon, FileIcon, LockClosedIcon } from '@radix-ui/react-icons'
import { Checkbox, Flex, Spinner, Text } from '@radix-ui/themes'
import { memo, useCallback, useLayoutEffect, useRef } from 'react'
import { formatBytes, formatDuration } from '../../lib/format'
import { useAtom } from '../../lib/store'
import type { Mark } from '../../transfers/enqueue'
import { MarkBadge } from '../../transfers/MarkBadge'
import { preventShiftSelection, SortButton, stop, VirtualTable } from '../../ui/table'
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
  const tableRef = useRef(table)
  useLayoutEffect(() => {
    tableRef.current = table
  })
  const onSelect = useCallback((id: string, shiftKey: boolean) => {
    const row = tableRef.current.getRow(id, true)
    row.getToggleSelectedHandler()({ shiftKey, target: { checked: !row.getIsSelected() } })
  }, [])
  const onOpen = useCallback((folder: Folder) => onSearchChange({ path: folder.path }), [onSearchChange])
  const getItemKey = useCallback((index: number) => rows[index]?.id ?? index, [rows])
  const ids = filtered ? matchColumns : folderColumns
  const template = filtered ? matchTemplate : folderTemplate

  const header = (
    <div className="table-row table-columns" style={{ gridTemplateColumns: template, height: '100%' }}>
      <div className="table-cell table-check">
        <Checkbox
          checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? 'indeterminate' : false}
          onClick={() => table.toggleAllRowsSelected()}
        />
      </div>
      {ids.map((id) => {
        const column = table.getColumn(id)
        return (
          <div key={id} className="table-cell" data-align={endAligned.has(id) ? 'end' : undefined}>
            <SortButton
              label={columnLabels[id]}
              sorted={column?.getIsSorted()}
              onClick={column?.getToggleSortingHandler()}
            />
          </div>
        )
      })}
    </div>
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
    <VirtualTable
      minWidth={filtered ? 810 : 780}
      header={header}
      count={rows.length}
      getItemKey={getItemKey}
      renderRow={(index) => {
        const row = rows[index]
        return row && render(row)
      }}
    />
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
  const empty = folder.fileCount === folder.lockedCount
  return (
    <div
      className="table-row table-group"
      style={{ gridTemplateColumns: template, cursor: 'pointer' }}
      data-selected={selected || undefined}
      data-dimmed={folder.locked || undefined}
      onClick={() => onOpen(folder)}
    >
      <div className="table-cell table-check" onClick={stop}>
        <Checkbox checked={selected} disabled={empty} onClick={(event) => onSelect(id, event.shiftKey)} />
      </div>
      <Flex className="table-cell" align="center" gap="2" title={folder.name}>
        {folder.locked ? <LockClosedIcon style={{ flexShrink: 0 }} /> : <ChevronRightIcon style={{ flexShrink: 0 }} />}
        <Text size="2" weight="medium" truncate>
          {folder.name}
        </Text>
      </Flex>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {folder.fileCount.toLocaleString()}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {formatBytes(folder.size)}
        </Text>
      </div>
      <div className="table-cell" title={folder.qualityLabel}>
        <Text size="2" color="gray">
          {folder.qualityLabel}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {folder.length > 0 && formatDuration(folder.length)}
        </Text>
      </div>
    </div>
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
    <div
      className="table-row"
      style={{ gridTemplateColumns: template }}
      data-selected={selected || undefined}
      data-dimmed={file.locked || undefined}
      onMouseDown={preventShiftSelection}
      onClick={(event) => !file.locked && onSelect(id, event.shiftKey)}
    >
      <div className="table-cell table-check" onClick={stop}>
        <Checkbox checked={selected} disabled={file.locked} onClick={(event) => onSelect(id, event.shiftKey)} />
      </div>
      <Flex className="table-cell" align="center" gap="2" title={file.path}>
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
        <div className="table-cell" title={folder}>
          <Text size="2" color="gray">
            {folder.split(separator).join(' › ')}
          </Text>
        </div>
      )}
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {formatBytes(file.size)}
        </Text>
      </div>
      <div className="table-cell">
        <Text size="2" color="gray">
          {file.qualityLabel}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {file.length !== undefined && formatDuration(file.length)}
        </Text>
      </div>
    </div>
  )
})
