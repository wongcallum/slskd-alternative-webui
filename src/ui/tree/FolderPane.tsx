import { Flex, Link, Text } from '@radix-ui/themes'
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
import { byName } from '../../lib/text'
import { type Folder, type Item, type Matches, matchesUnder, relativePath, type Tree } from '../../lib/tree'
import { SelectionActions, toolbarStyle } from '../controls'
import { Ago, Empty } from '../status'
import { type ExtraColumn, paneColumns, paneFeatures, paneLayout, sortItems } from './columns'
import { type FileBadge, ItemList } from './ItemList'

// It's rendered through Radix's Link with asChild, so it has to pass the props it's given on to its anchor.
export type FolderLinkProps = { path: string } & Omit<ComponentProps<'a'>, 'href'>

export type FolderLink = ComponentType<FolderLinkProps>

// What a view adds to the shared tree: its columns and how to link to a folder, and optionally what can be selected,
// what to do with a selection, what to show beside it, and a badge on files.
export type Selection = { tree: Tree; folder: Folder; items: Item[]; clear: () => void }

export type TreeConfig = {
  scope: string
  extras: readonly ExtraColumn[]
  FolderLink: FolderLink
  selectable?: (item: Item) => boolean
  actions?: (selection: Selection) => ReactNode
  status?: ReactNode
  Badge?: FileBadge
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
  config,
}: Props) {
  const { scope, extras, FolderLink, selectable, actions, status, Badge } = config
  const folderOf = useCallback(
    (item: Item) => (item.kind === 'file' ? relativePath(tree, folder, item.folder) : ''),
    [tree, folder],
  )
  const items = useMemo<Item[]>(() => {
    if (matches !== undefined) return sortItems(matchesUnder(folder, matches), sorting, extras, folderOf)
    const files = sorting.length === 0 ? [...folder.files].sort(byName) : folder.files
    return [...sortItems(folder.folders, sorting, extras, folderOf), ...sortItems(files, sorting, extras, folderOf)]
  }, [folder, matches, sorting, extras, folderOf])
  const columns = useMemo(() => paneColumns(extras), [extras])
  const layout = useMemo(
    () => paneLayout(extras, selectable !== undefined, matches !== undefined),
    [extras, selectable, matches],
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
  const selected = table.getSelectedRowModel().rows.map((row) => row.original)
  const clear = useCallback(() => setRowSelection({}), [])

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
    <Flex direction="column" flexGrow="1" minWidth="0">
      <Flex align="center" gap="4" px="4" py="2" flexShrink="0" minHeight="48px" style={toolbarStyle}>
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
                    <FolderLink path={each.path}>{each.name}</FolderLink>
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
        <Flex ml="auto" align="center" gap="3" flexShrink="0">
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
          <NoMatches folder={folder} matches={matches} scope={scope} FolderLink={FolderLink} />
        )
      ) : (
        <ItemList
          table={table}
          layout={layout}
          extras={extras}
          selectable={selectable !== undefined}
          filtered={matches !== undefined}
          separator={tree.separator}
          folderOf={folderOf}
          Badge={Badge}
          onOpen={onOpen}
        />
      )}
    </Flex>
  )
}

function NoMatches({
  folder,
  matches,
  scope,
  FolderLink,
}: {
  folder: Folder
  matches: Matches
  scope: string
  FolderLink: FolderLink
}) {
  let above = folder.parent
  while (above !== undefined && !matches.counts.has(above)) above = above.parent
  if (above === undefined) return <Empty>Nothing in {scope} matches.</Empty>
  return (
    <Empty
      actions={
        <Link asChild>
          <FolderLink path={above.path}>
            Show {plural(matches.counts.get(above) ?? 0, 'match', 'matches')} in {above.name}
          </FolderLink>
        </Link>
      }
    >
      Nothing in this folder matches.
    </Empty>
  )
}
