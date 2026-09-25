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

// Stacked, a row's details are its file count or folder, size and extras, on the line under its name.
function Row({
  id,
  item,
  group,
  dimmed,
  title,
  icon,
  name,
  count,
  countCell,
  size,
  onClick,
  stacked,
  template,
  counted,
  extras,
  selectable,
  disabled,
  selected,
  onSelect,
}: RowProps & {
  id: string
  item: Item
  group?: boolean
  dimmed: boolean
  title: string
  icon: ReactNode
  name: ReactNode
  count: ReactNode
  countCell: ReactNode
  size: ReactNode
  onClick: (event: { shiftKey: boolean }) => void
}) {
  const check = selectable ? (
    <CheckCell selected={selected} disabled={disabled} onToggle={(shiftKey) => onSelect(id, shiftKey)} />
  ) : undefined
  const style = group ? { cursor: 'pointer' } : undefined
  const label = (
    <>
      {icon}
      {name}
    </>
  )
  if (stacked) {
    return (
      <StackedRow
        group={group}
        selected={selected}
        dimmed={dimmed}
        check={check}
        title={label}
        meta={<Parts items={[count, size, ...extras.map((extra) => extra.render(item))]} />}
        style={style}
        onClick={onClick}
      />
    )
  }
  return (
    <GridRow template={template} group={group} selected={selected} dimmed={dimmed} style={style} onClick={onClick}>
      {check}
      <Flex className="table-cell" align="center" gap="2" title={title}>
        {label}
      </Flex>
      {counted && countCell}
      <Cell end>{size}</Cell>
      <ExtraCells item={item} extras={extras} />
    </GridRow>
  )
}

const SubfolderRow = memo(function SubfolderRow({
  folder,
  onOpen,
  ...props
}: RowProps & { folder: Folder; onOpen: (folder: Folder) => void }) {
  return (
    <Row
      {...props}
      id={`folder\n${folder.id}`}
      item={folder}
      group
      dimmed={folder.locked || folder.hidden}
      title={folder.name}
      icon={
        folder.locked ? <LockClosedIcon style={{ flexShrink: 0 }} /> : <ChevronRightIcon style={{ flexShrink: 0 }} />
      }
      name={
        <Text size="2" weight="medium" truncate>
          {folder.name}
        </Text>
      }
      count={plural(folder.fileCount, 'file')}
      countCell={<Cell end>{folder.fileCount.toLocaleString()}</Cell>}
      size={formatBytes(folder.size)}
      onClick={() => onOpen(folder)}
    />
  )
})

const FileRow = memo(function FileRow({
  file,
  folder,
  separator,
  Badge,
  ...props
}: RowProps & { file: TreeFile; folder?: string; separator: string; Badge?: FileBadge }) {
  const id = `file\n${file.id}`
  const path = folder?.split(separator).join(' › ')
  return (
    <Row
      {...props}
      id={id}
      item={file}
      dimmed={file.locked || file.hidden}
      title={file.filename}
      icon={file.locked ? <LockClosedIcon style={{ flexShrink: 0 }} /> : <FileIcon style={{ flexShrink: 0 }} />}
      name={
        <>
          <Text size="2" truncate>
            {file.name}
          </Text>
          {Badge !== undefined && <Badge file={file} />}
        </>
      }
      count={path}
      countCell={folder === undefined ? <div className="table-cell" /> : <Cell title={folder}>{path}</Cell>}
      size={!file.link && formatBytes(file.size)}
      onClick={(event) => props.selectable && !props.disabled && props.onSelect(id, event.shiftKey)}
    />
  )
})
