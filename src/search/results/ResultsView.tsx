import { MagnifyingGlassIcon } from '@radix-ui/react-icons'
import { Box, Button, Checkbox, Flex, Text, TextField } from '@radix-ui/themes'
import { type ExpandedStateList, functionalUpdate, type RowSelectionState, useTable } from '@tanstack/react-table'
import { useDeferredValue, useMemo, useState } from 'react'
import { formatBytes } from '../../lib/format'
import { formatSort, parseSort } from '../../lib/params'
import { useAtom } from '../../lib/store'
import { useSoulseekGate } from '../../soulseek/soulseek'
import { ActionButton, OutcomeLine, toolbarStyle } from '../../ui/controls'
import { FiltersButton } from './Filters'
import { type FilterSearch, qualities, type ResultsSearch, saveFilters } from './params'
import { ResultList } from './ResultList'
import {
  download,
  downloadsOf,
  type FolderFetch,
  type ResultFile,
  type ResultGroup,
  type Results,
  unfiltered,
  viewGroups,
} from './results'
import { canSelect, collapsed, columns, expansions, features } from './table'

const countFiles = (groups: ResultGroup[]) => groups.reduce((count, group) => count + group.files.length, 0)

type Props = {
  searchId: string
  results: Results
  folders: ReadonlyMap<string, FolderFetch>
  params: ResultsSearch
  onSearchChange: (patch: Partial<ResultsSearch>) => void
}

export function ResultsView({ searchId, results, folders, params, onSearchChange }: Props) {
  const [text, setText] = useState(params.q)
  const [urlText, setUrlText] = useState(params.q)
  if (params.q !== urlText) {
    setUrlText(params.q)
    setText(params.q)
  }
  const query = useDeferredValue(text)
  const locked = params.locked === 'show'
  const free = params.free === 'only'
  const quality = useDeferredValue(qualities.find(([value]) => value === params.quality)?.[2] ?? 0)
  const size = useDeferredValue(Number(params.size) * 2 ** 20)
  const length = useDeferredValue(Number(params.length) * 60)
  const files = useDeferredValue(Number(params.files))
  const groups = useMemo(
    () => viewGroups(results, folders, { query, locked, free, quality, size, length, files }),
    [results, folders, query, locked, free, quality, size, length, files],
  )
  const total = useMemo(
    () => countFiles(viewGroups(results, folders, { ...unfiltered, locked })),
    [results, folders, locked],
  )
  const shown = useMemo(() => countFiles(groups), [groups])

  const expansion = useAtom(expansions).get(searchId) ?? collapsed
  // TanStack skips expansion entirely while the expanded state is empty, so "all expanded" has to be spelled out.
  const expanded = useMemo(() => {
    if (!expansion.all) return expansion.toggled
    const all: ExpandedStateList = {}
    for (const group of groups) all[group.id] = expansion.toggled[group.id] ?? true
    return all
  }, [groups, expansion])
  const sorting = useMemo(() => parseSort(params.sort), [params.sort])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const table = useTable({
    features,
    columns,
    data: groups,
    getRowId: (item) => item.id,
    getSubRows: (item) => (item.kind === 'group' ? item.files : undefined),
    autoResetExpanded: false,
    enableMultiSort: false,
    enableRowSelection: canSelect,
    state: { sorting, expanded, rowSelection },
    onSortingChange: (updater) =>
      onSearchChange({ sort: formatSort(functionalUpdate(updater, sorting)) as ResultsSearch['sort'] }),
    onRowSelectionChange: setRowSelection,
  })

  const selected: ResultFile[] = []
  for (const row of table.getSelectedRowModel().flatRows) {
    if (row.original.kind === 'file' && !row.original.locked) selected.push(row.original)
  }
  const selectedSize = selected.reduce((sum, file) => sum + file.size, 0)
  const soulseekGate = useSoulseekGate()
  const downloads = useAtom(downloadsOf(searchId))

  function changeFilters(patch: Partial<FilterSearch>) {
    saveFilters({ ...params, ...patch })
    onSearchChange(patch)
  }

  return (
    <>
      <Flex align="center" gap="4" px="4" py="2" flexShrink="0" style={toolbarStyle}>
        <TextField.Root
          size="2"
          placeholder="Filter by user or path, -word to exclude"
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setUrlText(event.target.value)
            onSearchChange({ q: event.target.value })
          }}
          style={{ width: 330 }}
        >
          <TextField.Slot>
            <MagnifyingGlassIcon />
          </TextField.Slot>
        </TextField.Root>
        <FiltersButton filters={params} onChange={changeFilters} />
        {results.locked > 0 && (
          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Checkbox
                checked={locked}
                onCheckedChange={(checked) => onSearchChange({ locked: checked === true ? 'show' : 'hide' })}
              />
              Locked ({results.locked.toLocaleString()})
            </Flex>
          </Text>
        )}
        <Button
          size="1"
          variant="soft"
          color="gray"
          onClick={() =>
            expansions.set((current) => new Map(current).set(searchId, { all: !expansion.all, toggled: {} }))
          }
        >
          {expansion.all ? 'Collapse all' : 'Expand all'}
        </Button>
        {selected.length > 0 && (
          <Flex align="center" gap="2">
            <ActionButton
              label={`Download ${selected.length.toLocaleString()} (${formatBytes(selectedSize)})`}
              busy="Enqueueing"
              progress={downloads.running.download}
              gate={soulseekGate}
              onClick={() => void download(searchId, selected)}
            />
            <Button size="1" variant="ghost" color="gray" onClick={() => setRowSelection({})}>
              Clear selection
            </Button>
          </Flex>
        )}
        <Flex ml="auto" align="center" gap="4" flexShrink="0">
          <OutcomeLine atom={downloadsOf(searchId)} />
          <Text size="1" color="gray">
            {shown === total
              ? `${total.toLocaleString()} files in ${groups.length.toLocaleString()} folders`
              : `${shown.toLocaleString()} of ${total.toLocaleString()} files`}
          </Text>
        </Flex>
      </Flex>
      {groups.length === 0 ? (
        <Box p="5">
          <Text color="gray">Nothing matches.</Text>
        </Box>
      ) : (
        <ResultList
          searchId={searchId}
          table={table}
          folders={folders}
          gate={downloads.running.download ? 'Wait for the current download to be enqueued' : soulseekGate}
          folderGate={soulseekGate}
        />
      )}
    </>
  )
}
