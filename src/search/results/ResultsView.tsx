import { Cross2Icon } from '@radix-ui/react-icons'
import { Button, Text } from '@radix-ui/themes'
import { type RowSelectionState, useTable } from '@tanstack/react-table'
import { useCallback, useDeferredValue, useMemo, useState } from 'react'

import { useCriteria } from '../../lib/criteria'
import { countFiles } from '../../lib/files'
import { plural } from '../../lib/format'
import { useFrom } from '../../lib/media'
import { positiveInteger, useSortParam } from '../../lib/params'
import { useAtom } from '../../lib/store'
import { useSoulseekGate } from '../../soulseek/soulseek'
import { DownloadButton } from '../../transfers/DownloadButton'
import {
  CheckboxField,
  FilterField,
  OutcomeLine,
  SelectionActions,
  Tip,
  Toolbar,
  ToolbarEnd,
  useFilterText,
} from '../../ui/controls'
import { AmountField, FiltersButton } from '../../ui/Filters'
import { Empty } from '../../ui/status'
import { collapsed, expandedState, groupFeatures } from '../../ui/table'
import { countFilters, hiddenUsers, noFilters, type ResultsSearch } from './params'
import { ResultList } from './ResultList'
import { download, downloadsOf, type FolderFetch, type Results, unfiltered, viewGroups } from './results'
import { canSelect, columns, expansions, selectedFiles } from './table'

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
  const criteria = useCriteria(params)
  const files = useDeferredValue(Number(params.files))
  const hidden = useMemo(() => hiddenUsers(params.hide), [params.hide])
  const groups = useMemo(
    () => viewGroups(results, folders, { ...criteria, query, locked, free, files, hidden }),
    [results, folders, criteria, query, locked, free, files, hidden],
  )
  const onHide = useCallback(
    (username: string) => onSearchChange({ hide: [...hidden, username].join('\n') }),
    [hidden, onSearchChange],
  )
  const total = useMemo(
    () => countFiles(viewGroups(results, folders, { ...unfiltered, locked })),
    [results, folders, locked],
  )
  const shown = useMemo(() => countFiles(groups), [groups])
  const lockedCount = useMemo(
    () =>
      [...folders.values()].reduce(
        (count, fetch) => count + (fetch.files?.filter((file) => file.locked).length ?? 0),
        results.locked,
      ),
    [results, folders],
  )

  const expansion = useAtom(expansions).get(searchId) ?? collapsed
  const expanded = useMemo(() => expandedState(expansion, groups), [groups, expansion])
  const { sorting, onSortingChange } = useSortParam(params.sort, (sort) => onSearchChange({ sort }))
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const table = useTable({
    features: groupFeatures,
    columns,
    data: groups,
    // A file can be in two folders, when one's fetched with its subfolders.
    getRowId: (item, _index, parent) => (parent === undefined ? item.id : parent.id + item.id),
    getSubRows: (item) => (item.kind === 'group' ? item.files : undefined),
    autoResetExpanded: false,
    enableMultiSort: false,
    enableRowSelection: canSelect,
    state: { sorting, expanded, rowSelection },
    onSortingChange,
    onRowSelectionChange: setRowSelection,
  })

  const selected = selectedFiles(table)
  const soulseekGate = useSoulseekGate()
  const downloads = useAtom(downloadsOf(searchId))
  const sm = useFrom('sm')
  const lockedField = lockedCount > 0 && (
    <CheckboxField checked={locked} onChange={(checked) => onSearchChange({ locked: checked ? 'show' : 'hide' })}>
      Locked ({lockedCount.toLocaleString()})
    </CheckboxField>
  )

  return (
    <>
      <Toolbar gap={{ initial: '3', sm: '4' }}>
        <FilterField
          placeholder="Filter by user or path, -word to exclude"
          value={filter.text}
          onChange={filter.change}
          width="330px"
          main
          list="results"
        />
        {/* Below sm, Locked joins the other filters in the popover, so the toolbar keeps to two lines. */}
        <FiltersButton
          filters={params}
          onChange={onSearchChange}
          active={countFilters(params)}
          onClear={() => onSearchChange(noFilters)}
          fields={
            <AmountField
              label="Min files per folder"
              value={params.files}
              schema={positiveInteger}
              onChange={(minimum) => onSearchChange({ files: minimum })}
            />
          }
        >
          <CheckboxField checked={free} onChange={(checked) => onSearchChange({ free: checked ? 'only' : 'all' })}>
            Free slot only
          </CheckboxField>
          {!sm && lockedField}
        </FiltersButton>
        {sm && lockedField}
        {hidden.size > 0 && (
          <Tip content={[...hidden].join('\n')} tap={false}>
            <Button size="1" variant="soft" onClick={() => onSearchChange({ hide: '' })}>
              {plural(hidden.size, 'user')} hidden
              <Cross2Icon />
            </Button>
          </Tip>
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
            <DownloadButton
              downloads={downloadsOf(searchId)}
              count={selected.length}
              size={selected.reduce((sum, file) => sum + file.size, 0)}
              onClick={() => void download(searchId, selected).then(() => setRowSelection({}))}
            />
          </SelectionActions>
        )}
        <ToolbarEnd>
          <OutcomeLine atom={downloadsOf(searchId)} />
          <Text size="1" color="gray">
            {shown === total
              ? `${total.toLocaleString()} files in ${groups.length.toLocaleString()} folders`
              : `${shown.toLocaleString()} of ${total.toLocaleString()} files`}
          </Text>
        </ToolbarEnd>
      </Toolbar>
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
          onHide={onHide}
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
          {params.hide !== '' && (
            <Button size="1" variant="soft" onClick={() => onSearchChange({ hide: '' })}>
              Show hidden users
            </Button>
          )}
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
