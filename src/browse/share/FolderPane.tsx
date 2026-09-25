import { Box, Button, Flex, Link, Text } from '@radix-ui/themes'
import { functionalUpdate, type RowSelectionState, useTable } from '@tanstack/react-table'
import { Link as RouterLink } from '@tanstack/react-router'
import { Fragment, useCallback, useMemo, useState } from 'react'
import { formatBytes, plural } from '../../lib/format'
import { formatSort, parseSort } from '../../lib/params'
import { useAtom } from '../../lib/store'
import { useSoulseekGate } from '../../soulseek/soulseek'
import { ActionButton, Ago, OutcomeLine, toolbarStyle } from '../../ui/controls'
import { downloadFiles, shareDownloadsOf } from '../browse'
import type { BrowseSearch } from '../params'
import { byName, filesUnder, type Folder, type Matches, matchesUnder, relativePath, type Share } from '../shareTree'
import { ItemList } from './ItemList'
import { columns, type Item, paneFeatures, selectable, sortItems } from './paneTable'

type Props = {
  share: Share
  folder: Folder
  unknown: boolean
  fetchedAt: number
  matches?: Matches
  sort: BrowseSearch['sort']
  onSearchChange: (patch: Partial<BrowseSearch>) => void
}

export function FolderPane({ share, folder, unknown, fetchedAt, matches, sort, onSearchChange }: Props) {
  const sorting = useMemo(() => parseSort(sort), [sort])
  const folderOf = useCallback(
    (item: Item) => (item.kind === 'file' ? relativePath(share, folder, item.folder) : ''),
    [share, folder],
  )
  const items = useMemo<Item[]>(() => {
    if (matches !== undefined) return sortItems(matchesUnder(folder, matches), sorting, folderOf)
    const files = sorting.length === 0 ? [...folder.files].sort(byName) : folder.files
    return [...sortItems(folder.folders, sorting, folderOf), ...sortItems(files, sorting, folderOf)]
  }, [folder, matches, sorting, folderOf])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const table = useTable({
    features: paneFeatures,
    columns,
    data: items,
    getRowId: (item) => `${item.kind}\n${item.id}`,
    manualSorting: true,
    enableMultiSort: false,
    enableRowSelection: (row) => selectable(row.original),
    state: { sorting, rowSelection },
    onSortingChange: (updater) =>
      onSearchChange({ sort: formatSort(functionalUpdate(updater, sorting)) as BrowseSearch['sort'] }),
    onRowSelectionChange: setRowSelection,
  })

  let count = 0
  let size = 0
  const selected: Item[] = []
  for (const row of table.getSelectedRowModel().rows) {
    const item = row.original
    selected.push(item)
    count += item.kind === 'folder' ? item.fileCount - item.lockedCount : 1
    size += item.kind === 'folder' ? item.size - item.lockedSize : item.size
  }
  const soulseekGate = useSoulseekGate()
  const downloads = useAtom(shareDownloadsOf(share.username))

  const trail: Folder[] = []
  for (let current: Folder | undefined = folder; current !== undefined; current = current.parent) trail.unshift(current)

  let summary: string
  if (matches !== undefined) summary = plural(items.length, 'matching file')
  else if (folder.folders.length === 0) summary = plural(folder.files.length, 'file')
  else {
    summary = plural(folder.folders.length, 'folder')
    if (folder.files.length > 0) summary += ` · ${plural(folder.files.length, 'file')}`
  }

  return (
    <Flex direction="column" flexGrow="1" minWidth="0">
      <Flex align="center" gap="4" px="4" py="2" flexShrink="0" minHeight="48px" style={toolbarStyle}>
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
                  <RouterLink
                    from="/browse"
                    to="/browse"
                    search={(previous) => ({ ...previous, path: each.path })}
                    replace
                  >
                    {each.name}
                  </RouterLink>
                </Link>
              )}
            </Fragment>
          ))}
          <Text size="2" color="gray" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
            · {summary}
          </Text>
          {unknown && (
            <Text size="2" color="amber" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
              · Not in this share as fetched <Ago time={fetchedAt} />
            </Text>
          )}
        </Flex>
        <Flex ml="auto" align="center" gap="3" flexShrink="0">
          <OutcomeLine atom={shareDownloadsOf(share.username)} />
          {selected.length > 0 && (
            <>
              <Button size="1" variant="ghost" color="gray" onClick={() => setRowSelection({})}>
                Clear selection
              </Button>
              <ActionButton
                label={`Download ${count.toLocaleString()} (${formatBytes(size)})`}
                busy="Enqueueing"
                progress={downloads.running.download}
                gate={soulseekGate}
                onClick={() =>
                  void downloadFiles(
                    share,
                    folder,
                    selected.flatMap((item) => (item.kind === 'folder' ? filesUnder(item) : [item])),
                  )
                }
              />
            </>
          )}
        </Flex>
      </Flex>
      {items.length === 0 ? (
        <Box p="5">
          <Text color="gray">{matches !== undefined ? 'Nothing matches here.' : 'This folder is empty.'}</Text>
        </Box>
      ) : (
        <ItemList
          share={share}
          table={table}
          filtered={matches !== undefined}
          folderOf={folderOf}
          onSearchChange={onSearchChange}
        />
      )}
    </Flex>
  )
}
