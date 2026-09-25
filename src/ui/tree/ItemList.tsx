import { ChevronRightIcon, FileIcon, LockClosedIcon } from '@radix-ui/react-icons'
import { Flex, Text } from '@radix-ui/themes'
import { type ComponentType, memo, type ReactNode } from 'react'

import { formatBytes, plural } from '../../lib/format'
import type { Folder, Item, TreeFile } from '../../lib/tree'
import {
  Cell,
  CheckCell,
  ColumnHeader,
  GridRow,
  HeaderRow,
  Parts,
  rowHeight,
  rowId,
  StackedRow,
  stackedHeight,
  useRowToggle,
  VirtualTable,
} from '../table'
import type { ExtraColumn, Layout, PaneRow, PaneTable } from './columns'

export type FileBadge = ComponentType<{ file: TreeFile }>

type Props = {
  table: PaneTable
  layout: Layout
  stacked: boolean
  selectable: boolean
  filtered: boolean
  separator: string
  folderOf: (item: Item) => string
  Badge?: FileBadge
  onOpen: (folder: Folder) => void
}

export function ItemList({ table, layout, stacked, selectable, filtered, separator, folderOf, Badge, onOpen }: Props) {
  const rows = table.getRowModel().rows
  const onSelect = useRowToggle(table)
  const { template, minWidth, counted, extras } = layout

  const header = (
    <HeaderRow template={template} table={selectable ? table : undefined} stacked={stacked}>
      <ColumnHeader label="Name" column={table.getColumn('name')} />
      {(counted || stacked) &&
        (filtered ? (
          <ColumnHeader label="Folder" column={table.getColumn('folder')} />
        ) : (
          <ColumnHeader label="Files" end={!stacked} column={table.getColumn('files')} />
        ))}
      <ColumnHeader label="Size" end={!stacked} column={table.getColumn('size')} />
      {extras.map((extra) => (
        <ColumnHeader
          key={extra.id}
          label={extra.label}
          end={!stacked && extra.end}
          column={table.getColumn(extra.id)}
        />
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
          stacked={stacked}
          counted={counted}
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
        stacked={stacked}
        counted={counted}
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

  return (
    <VirtualTable
      minWidth={stacked ? 0 : minWidth}
      header={header}
      items={rows}
      itemKey={rowId}
      rowSize={stacked ? stackedHeight : rowHeight}
      renderItem={render}
    />
  )
}

function ExtraCells({ item, extras }: { item: Item; extras: readonly ExtraColumn[] }) {
  return extras.map((extra) => (
    <Cell key={extra.id} end={extra.end} title={extra.title?.(item)}>
      {extra.render(item)}
    </Cell>
  ))
}

type RowProps = {
  template: string
  stacked: boolean
  counted: boolean
  extras: readonly ExtraColumn[]
  selectable: boolean
  disabled: boolean
  selected: boolean
  onSelect: (id: string, shiftKey: boolean) => void
}

// Stacked, a row's details are its count or folder, size and extras, on the line under its name.
function Row({
  stacked,
  template,
  group,
  check,
  dimmed,
  selected,
  title,
  name,
  details,
  cells,
  onClick,
}: {
  stacked: boolean
  template: string
  group?: boolean
  check: ReactNode
  dimmed: boolean
  selected: boolean
  title: string
  name: ReactNode
  details: ReactNode[]
  cells: ReactNode
  onClick: (event: { shiftKey: boolean }) => void
}) {
  if (stacked) {
    return (
      <StackedRow
        group={group}
        selected={selected}
        dimmed={dimmed}
        check={check || undefined}
        title={name}
        meta={<Parts items={details} />}
        style={group ? { cursor: 'pointer' } : undefined}
        onClick={onClick}
      />
    )
  }
  return (
    <GridRow
      template={template}
      group={group}
      selected={selected}
      dimmed={dimmed}
      style={group ? { cursor: 'pointer' } : undefined}
      onClick={onClick}
    >
      {check}
      <Flex className="table-cell" align="center" gap="2" title={title}>
        {name}
      </Flex>
      {cells}
    </GridRow>
  )
}

const SubfolderRow = memo(function SubfolderRow({
  folder,
  template,
  stacked,
  counted,
  extras,
  selectable,
  disabled,
  selected,
  onSelect,
  onOpen,
}: RowProps & { folder: Folder; onOpen: (folder: Folder) => void }) {
  const id = `folder\n${folder.id}`
  return (
    <Row
      stacked={stacked}
      template={template}
      group
      check={
        selectable && (
          <CheckCell selected={selected} disabled={disabled} onToggle={(shiftKey) => onSelect(id, shiftKey)} />
        )
      }
      dimmed={folder.locked || folder.hidden}
      selected={selected}
      title={folder.name}
      name={
        <>
          {folder.locked ? (
            <LockClosedIcon style={{ flexShrink: 0 }} />
          ) : (
            <ChevronRightIcon style={{ flexShrink: 0 }} />
          )}
          <Text size="2" weight="medium" truncate>
            {folder.name}
          </Text>
        </>
      }
      details={[
        plural(folder.fileCount, 'file'),
        formatBytes(folder.size),
        ...extras.map((extra) => extra.render(folder)),
      ]}
      cells={
        <>
          {counted && <Cell end>{folder.fileCount.toLocaleString()}</Cell>}
          <Cell end>{formatBytes(folder.size)}</Cell>
          <ExtraCells item={folder} extras={extras} />
        </>
      }
      onClick={() => onOpen(folder)}
    />
  )
})

const FileRow = memo(function FileRow({
  file,
  template,
  stacked,
  counted,
  extras,
  folder,
  separator,
  selectable,
  disabled,
  selected,
  Badge,
  onSelect,
}: RowProps & { file: TreeFile; folder?: string; separator: string; Badge?: FileBadge }) {
  const id = `file\n${file.id}`
  const toggle = selectable && !disabled
  const path = folder?.split(separator).join(' › ')
  return (
    <Row
      stacked={stacked}
      template={template}
      check={
        selectable && (
          <CheckCell selected={selected} disabled={disabled} onToggle={(shiftKey) => onSelect(id, shiftKey)} />
        )
      }
      dimmed={file.locked || file.hidden}
      selected={selected}
      title={file.filename}
      name={
        <>
          {file.locked ? <LockClosedIcon style={{ flexShrink: 0 }} /> : <FileIcon style={{ flexShrink: 0 }} />}
          <Text size="2" truncate>
            {file.name}
          </Text>
          {Badge !== undefined && <Badge file={file} />}
        </>
      }
      details={[path, !file.link && formatBytes(file.size), ...extras.map((extra) => extra.render(file))]}
      cells={
        <>
          {counted && (folder === undefined ? <div className="table-cell" /> : <Cell title={folder}>{path}</Cell>)}
          <Cell end>{!file.link && formatBytes(file.size)}</Cell>
          <ExtraCells item={file} extras={extras} />
        </>
      }
      onClick={(event) => toggle && onSelect(id, event.shiftKey)}
    />
  )
})
