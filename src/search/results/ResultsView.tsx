import { Button, Flex, Text } from '@radix-ui/themes'
import { type RowSelectionState, useTable } from '@tanstack/react-table'
import { useDeferredValue, useMemo, useState } from 'react'

import { countFiles } from '../../lib/files'
import { formatBytes } from '../../lib/format'
import { useSortParam } from '../../lib/params'
import { useAtom } from '../../lib/store'
import { useSoulseekGate } from '../../soulseek/soulseek'
import {
  ActionButton,
  CheckboxField,
  FilterField,
  OutcomeLine,
  SelectionActions,
  toolbarStyle,
  useFilterText,
} from '../../ui/controls'
import { Empty } from '../../ui/status'
import { collapsed, expandedState } from '../../ui/table'
import { FiltersButton } from './Filters'
import { countFilters, noFilters, qualities, type ResultsSearch } from './params'
import { ResultList } from './ResultList'
import {
  download,
  downloadsOf,
  type FolderFetch,
  type ResultFile,
  type Results,
  unfiltered,
  viewGroups,
} from './results'
import { canSelect, columns, expansions, features } from './table'

type Props = {
  searchId: string
  results: Results
  folders: ReadonlyMap<string, FolderFetch>
  params: ResultsSearch
  onSearchChange: (patch: Partial<ResultsSearch>) => void
}

export function ResultsView({ searchId, results, folders, params, onSearchChange }: Props) {
  const filter = useFilterText(params.q, (q) => onSearchChange({ q }))
  const query = filter.query
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
  const expanded = useMemo(() => expandedState(expansion, groups), [groups, expansion])
  const { sorting, onSortingChange } = useSortParam(params.sort, (sort) => onSearchChange({ sort }))
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
    onSortingChange,
    onRowSelectionChange: setRowSelection,
  })

  const selected: ResultFile[] = []
  for (const row of table.getSelectedRowModel().flatRows) {
    if (row.original.kind === 'file' && !row.original.locked) selected.push(row.original)
  }
  const selectedSize = selected.reduce((sum, file) => sum + file.size, 0)
  const soulseekGate = useSoulseekGate()
  const downloads = useAtom(downloadsOf(searchId))

  return (
    <>
      <Flex align="center" gap="4" px="4" py="2" flexShrink="0" style={toolbarStyle}>
        <FilterField
          placeholder="Filter by user or path, -word to exclude"
          value={filter.text}
          onChange={filter.change}
          style={{ width: 330 }}
        />
        <FiltersButton filters={params} onChange={onSearchChange} />
        {results.locked > 0 && (
          <CheckboxField checked={locked} onChange={(checked) => onSearchChange({ locked: checked ? 'show' : 'hide' })}>
            Locked ({results.locked.toLocaleString()})
          </CheckboxField>
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
          <SelectionActions onClear={() => setRowSelection({})}>
            <ActionButton
              label={`Download ${selected.length.toLocaleString()} (${formatBytes(selectedSize)})`}
              busy="Enqueueing"
              progress={downloads.running.download}
              gate={soulseekGate}
              onClick={() => void download(searchId, selected).then(() => setRowSelection({}))}
            />
          </SelectionActions>
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
        <NothingShown
          total={total}
          locked={results.locked}
          params={params}
          text={filter.text}
          onClearText={() => filter.change('')}
          onSearchChange={onSearchChange}
        />
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

type NothingShownProps = {
  total: number
  locked: number
  params: ResultsSearch
  text: string
  onClearText: () => void
  onSearchChange: (patch: Partial<ResultsSearch>) => void
}

function NothingShown({ total, locked, params, text, onClearText, onSearchChange }: NothingShownProps) {
  if (total === 0) {
    return (
      <Empty
        actions={
          <Button size="1" variant="soft" onClick={() => onSearchChange({ locked: 'show' })}>
            Show locked
          </Button>
        }
      >
        {locked === 1 ? 'The only file is locked.' : `All ${locked.toLocaleString()} files are locked.`}
      </Empty>
    )
  }
  return (
    <Empty
      actions={
        <>
          {countFilters(params) > 0 && (
            <Button size="1" variant="soft" onClick={() => onSearchChange(noFilters)}>
              Clear filters
            </Button>
          )}
          {text !== '' && (
            <Button size="1" variant="soft" onClick={onClearText}>
              Clear text filter
            </Button>
          )}
        </>
      }
    >
      {total === 1 ? 'Filters hide the only file.' : `Filters hide all ${total.toLocaleString()} files.`}
    </Empty>
  )
}
