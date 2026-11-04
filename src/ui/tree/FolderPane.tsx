import { Flex, Link, Text } from '@radix-ui/themes'
import { Link as RouterLink } from '@tanstack/react-router'
import { type RowSelectionState, type SortingState, type Updater, useTable } from '@tanstack/react-table'
import {
  type ComponentProps,
  type ComponentType,
  Fragment,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from 'react'

import { nameOf } from '../../lib/files'
import { plural } from '../../lib/format'
import {
  type Folder,
  type Item,
  type Matches,
  matchesUnder,
  relativePath,
  sortedFiles,
  type Tree,
} from '../../lib/tree'
import { barHeight, SelectionActions, toolbarStyle } from '../controls'
import { useListKeys } from '../keys'
import { useListNav } from '../listNav'
import { Ago, Empty } from '../status'
import { rowId, rowSelected, useSelectionKeys } from '../table'
import { type ExtraColumn, paneColumns, paneFeatures, paneLayout, sortItems, usePaneWidth } from './columns'
import { type FileBadge, ItemList } from './ItemList'
import { type KeysProps, upKeys } from './keys'

type Page = '/browse' | '/system/files' | '/system/shares'

// It's rendered through Radix's Link with asChild, so it has to pass the props it's given on to its anchor.
function FolderLink({ page, path, ...props }: { page: Page; path: string } & Omit<ComponentProps<'a'>, 'href'>) {
  return <RouterLink {...props} from={page} to={page} search={(previous) => ({ ...previous, path })} />
}

// What a view adds to the shared tree: its page and columns, and optionally what can be selected, what to do with a
// selection, what to show beside it, a badge on files, and keys. The list the top shows instead of its folders, if it
// does, is where going up from a top folder lands.
export type Selection = { tree: Tree; folder: Folder; items: Item[]; clear: () => void }

export type TreeConfig = {
  page: Page
  scope: string
  extras: readonly ExtraColumn[]
  selectable?: (item: Item) => boolean
  actions?: (selection: Selection) => ReactNode
  status?: ReactNode
  Badge?: FileBadge
  Keys?: ComponentType<KeysProps>
  topList?: string
}

type Props = {
  tree: Tree
  folder: Folder
  missing?: string
  fetchedAt: number
  matches?: Matches
  sorting: SortingState
  onSortingChange: (updater: Updater<SortingState>) => void
  onOpen: (folder: Folder) => void
  onUp: () => void
  config: TreeConfig
}

export function FolderPane({
  tree,
  folder,
  missing,
  fetchedAt,
  matches,
  sorting,
  onSortingChange,
  onOpen,
  onUp,
  config,
}: Props) {
  const { page, scope, extras, selectable, actions, status, Badge, Keys } = config
  const folderOf = useCallback(
    (item: Item) => (item.kind === 'file' ? relativePath(tree, folder, item.folder) : ''),
    [tree, folder],
  )
  const items = useMemo<Item[]>(() => {
    if (matches !== undefined) return sortItems(matchesUnder(folder, matches), sorting, extras, folderOf)
    const files = sorting.length === 0 ? sortedFiles(folder) : folder.files
    return [...sortItems(folder.folders, sorting, extras, folderOf), ...sortItems(files, sorting, extras, folderOf)]
  }, [folder, matches, sorting, extras, folderOf])
  const columns = useMemo(() => paneColumns(extras), [extras])
  const width = usePaneWidth()
  const layout = useMemo(
    () => paneLayout(extras, selectable !== undefined, matches !== undefined, width),
    [extras, selectable, matches, width],
  )
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const table = useTable({
    features: paneFeatures,
    columns,
    data: items,
    getRowId: (item) => `${item.kind}\n${item.id}`,
    manualSorting: true,
    enableMultiSort: false,
    enableRowSelection: (row) => selectable?.(row.original) ?? false,
    state: { sorting, rowSelection },
    onSortingChange,
    onRowSelectionChange: setRowSelection,
  })
  const selectedRows = table.getSelectedRowModel().rows
  const selected = useMemo(() => selectedRows.map((row) => row.original), [selectedRows])
  const clear = useCallback(() => setRowSelection({}), [])
  const selectionKeys = useSelectionKeys(table)
  const nav = useListNav({
    name: 'pane',
    items: table.getRowModel().rows,
    itemKey: rowId,
    rank: 1,
    label: 'Contents',
    ...(selectable === undefined ? {} : { ...selectionKeys, aria: rowSelected }),
    onEnter: (row) => {
      if (row.original.kind === 'folder') onOpen(row.original)
      else if (selectable !== undefined) selectionKeys.onSpace(row, false)
    },
  })
  useListKeys(nav.containerRef, upKeys(onUp))
  const keySelection = () => {
    const focused = nav.focused()?.original
    if (selected.length === 0 && focused === undefined) return undefined
    return { tree, folder, items: selected.length > 0 ? selected : [focused as Item], clear }
  }

  const trail: Folder[] = []
  for (let current: Folder | undefined = folder; current !== undefined; current = current.parent) trail.unshift(current)

  let summary: string
  if (matches !== undefined) summary = plural(items.length, 'matching file')
  else if (folder.folders.length === 0) summary = plural(folder.files.length, 'file')
  else {
    summary = plural(folder.folders.length, 'folder')
    if (folder.files.length > 0) summary += `, ${plural(folder.files.length, 'file')}`
  }

  return (
    <Flex direction="column" flexGrow="1" minWidth="0" minHeight="0">
      <Flex
        align="center"
        gap="4"
        wrap={{ initial: 'wrap', sm: 'nowrap' }}
        px="4"
        py="2"
        flexShrink="0"
        minHeight={`${barHeight}px`}
        style={toolbarStyle}
      >
        <Flex align="center" gap="3" minWidth="0" style={{ overflow: 'hidden' }}>
          <Flex align="center" gap="1" minWidth="0" style={{ overflow: 'hidden' }}>
            {trail.map((each, index) => (
              <Fragment key={each.id}>
                {index > 0 && (
                  <Text size="2" color="gray" style={{ flexShrink: 0 }}>
                    ›
                  </Text>
                )}
                {each === folder ? (
                  <Text size="2" weight="medium" truncate title={each.path || each.name}>
                    {each.name}
                  </Text>
                ) : (
                  <Link asChild size="2" color="gray" truncate style={{ flexShrink: index === 0 ? 0 : 1 }}>
                    <FolderLink page={page} path={each.path}>
                      {each.name}
                    </FolderLink>
                  </Link>
                )}
              </Fragment>
            ))}
          </Flex>
          <Text size="2" color="gray" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
            {summary}
          </Text>
          {missing !== undefined && (
            <Text size="2" color="amber" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
              “{nameOf(missing)}” isn't in {scope} as of <Ago time={fetchedAt} />
            </Text>
          )}
        </Flex>
        <Flex className="toolbar-end" ml="auto" align="center" gap="3" flexShrink="0">
          {status}
          {selected.length > 0 && actions !== undefined && (
            <SelectionActions onClear={clear}>{actions({ tree, folder, items: selected, clear })}</SelectionActions>
          )}
        </Flex>
      </Flex>
      {items.length === 0 ? (
        matches === undefined ? (
          <Empty>This folder is empty.</Empty>
        ) : (
          <NoMatches folder={folder} matches={matches} page={page} scope={scope} />
        )
      ) : (
        <ItemList
          table={table}
          nav={nav}
          layout={layout}
          stacked={width === 'stacked'}
          selectable={selectable !== undefined}
          filtered={matches !== undefined}
          separator={tree.separator}
          folderOf={folderOf}
          Badge={Badge}
          onOpen={onOpen}
        />
      )}
      {Keys !== undefined && <Keys target={nav.containerRef} tree={false} selection={keySelection} />}
    </Flex>
  )
}

function NoMatches({ folder, matches, page, scope }: { folder: Folder; matches: Matches; page: Page; scope: string }) {
  let above = folder.parent
  while (above !== undefined && !matches.counts.has(above)) above = above.parent
  if (above === undefined) return <Empty>Nothing in {scope} matches.</Empty>
  return (
    <Empty
      actions={
        <Link asChild>
          <FolderLink page={page} path={above.path}>
            Show {plural(matches.counts.get(above) ?? 0, 'match', 'matches')} in {above.name}
          </FolderLink>
        </Link>
      }
    >
      Nothing in this folder matches.
    </Empty>
  )
}
