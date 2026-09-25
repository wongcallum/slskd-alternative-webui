import { ChevronRightIcon, FileIcon, LockClosedIcon } from '@radix-ui/react-icons'
import { Flex, Text } from '@radix-ui/themes'
import { type ComponentType, memo } from 'react'

import { formatBytes } from '../../lib/format'
import type { Folder, Item, TreeFile } from '../../lib/tree'
import { Cell, CheckCell, ColumnHeader, GridRow, HeaderRow, rowId, useRowToggle, VirtualTable } from '../table'
import type { ExtraColumn, Layout, PaneRow, PaneTable } from './columns'

export type FileBadge = ComponentType<{ file: TreeFile }>

type Props = {
  table: PaneTable
  layout: Layout
  extras: readonly ExtraColumn[]
  selectable: boolean
  filtered: boolean
  separator: string
  folderOf: (item: Item) => string
  Badge?: FileBadge
  onOpen: (folder: Folder) => void
}

export function ItemList({ table, layout, extras, selectable, filtered, separator, folderOf, Badge, onOpen }: Props) {
  const rows = table.getRowModel().rows
  const onSelect = useRowToggle(table)
  const { template, minWidth } = layout

  const header = (
    <HeaderRow template={template} table={selectable ? table : undefined}>
      <ColumnHeader label="Name" column={table.getColumn('name')} />
      {filtered ? (
        <ColumnHeader label="Folder" column={table.getColumn('folder')} />
      ) : (
        <ColumnHeader label="Files" end column={table.getColumn('files')} />
      )}
      <ColumnHeader label="Size" end column={table.getColumn('size')} />
      {extras.map((extra) => (
        <ColumnHeader key={extra.id} label={extra.label} end={extra.end} column={table.getColumn(extra.id)} />
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
          extras={extras}
          selectable={selectable}
          disabled={!row.getCanSelect()}
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
        extras={extras}
        folder={filtered ? folderOf(item) : undefined}
        separator={separator}
        selectable={selectable}
        disabled={!row.getCanSelect()}
        selected={row.getIsSelected()}
        Badge={Badge}
        onSelect={onSelect}
      />
    )
  }

  return <VirtualTable minWidth={minWidth} header={header} items={rows} itemKey={rowId} renderItem={render} />
}

function ExtraCells({ item, extras }: { item: Item; extras: readonly ExtraColumn[] }) {
  return extras.map((extra) => (
    <Cell key={extra.id} end={extra.end} title={extra.title?.(item)}>
      {extra.render(item)}
    </Cell>
  ))
}

type SubfolderRowProps = {
  folder: Folder
  template: string
  extras: readonly ExtraColumn[]
  selectable: boolean
  disabled: boolean
  selected: boolean
  onSelect: (id: string, shiftKey: boolean) => void
  onOpen: (folder: Folder) => void
}

const SubfolderRow = memo(function SubfolderRow({
  folder,
  template,
  extras,
  selectable,
  disabled,
  selected,
  onSelect,
  onOpen,
}: SubfolderRowProps) {
  const id = `folder\n${folder.id}`
  return (
    <GridRow
      template={template}
      group
      selected={selected}
      dimmed={folder.locked || folder.hidden}
      style={{ cursor: 'pointer' }}
      onClick={() => onOpen(folder)}
    >
      {selectable && (
        <CheckCell selected={selected} disabled={disabled} onToggle={(shiftKey) => onSelect(id, shiftKey)} />
      )}
      <Flex className="table-cell" align="center" gap="2" title={folder.name}>
        {folder.locked ? <LockClosedIcon style={{ flexShrink: 0 }} /> : <ChevronRightIcon style={{ flexShrink: 0 }} />}
        <Text size="2" weight="medium" truncate>
          {folder.name}
        </Text>
      </Flex>
      <Cell end>{folder.fileCount.toLocaleString()}</Cell>
      <Cell end>{formatBytes(folder.size)}</Cell>
      <ExtraCells item={folder} extras={extras} />
    </GridRow>
  )
})

type FileRowProps = {
  file: TreeFile
  template: string
  extras: readonly ExtraColumn[]
  folder?: string
  separator: string
  selectable: boolean
  disabled: boolean
  selected: boolean
  Badge?: FileBadge
  onSelect: (id: string, shiftKey: boolean) => void
}

const FileRow = memo(function FileRow({
  file,
  template,
  extras,
  folder,
  separator,
  selectable,
  disabled,
  selected,
  Badge,
  onSelect,
}: FileRowProps) {
  const id = `file\n${file.id}`
  const toggle = selectable && !disabled
  return (
    <GridRow
      template={template}
      selected={selected}
      dimmed={file.locked || file.hidden}
      onClick={(event) => toggle && onSelect(id, event.shiftKey)}
    >
      {selectable && (
        <CheckCell selected={selected} disabled={disabled} onToggle={(shiftKey) => onSelect(id, shiftKey)} />
      )}
      <Flex className="table-cell" align="center" gap="2" title={file.filename}>
        {file.locked ? <LockClosedIcon style={{ flexShrink: 0 }} /> : <FileIcon style={{ flexShrink: 0 }} />}
        <Text size="2" truncate>
          {file.name}
        </Text>
        {Badge !== undefined && <Badge file={file} />}
      </Flex>
      {folder === undefined ? (
        <div className="table-cell" />
      ) : (
        <Cell title={folder}>{folder.split(separator).join(' › ')}</Cell>
      )}
      <Cell end>{!file.link && formatBytes(file.size)}</Cell>
      <ExtraCells item={file} extras={extras} />
    </GridRow>
  )
})
