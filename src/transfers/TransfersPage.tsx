import { Flex } from '@radix-ui/themes'
import type { RowSelectionState } from '@tanstack/react-table'
import { type ReactNode, useMemo, useState } from 'react'
import * as v from 'valibot'
import { oneOf, sortOf, textParam } from '../lib/params'
import { type Resource, useAtom, useResource, useStale } from '../lib/store'
import { useSoulseekGate } from '../soulseek/soulseek'
import { ActionButton, FilterField, OutcomeLine, SelectionActions, toolbarStyle, useFilterText } from '../ui/controls'
import { Empty, Freshness, Polling } from '../ui/status'
import { actions, cancel, remove, retry } from './actions'
import { columnIds, expansions, type Gates, useSectionTable } from './table'
import { TransferList } from './TransferList'
import {
  type Direction,
  filterGroups,
  type Group,
  isFailed,
  isFinished,
  pollInterval,
  type Transfer,
  type Transfers,
  transfers,
} from './transfers'

export const transfersSearch = v.object({
  q: textParam,
  show: oneOf(['all', 'succeeded', 'failed'], 'all'),
  activeSort: sortOf(columnIds.active),
  finishedSort: sortOf(columnIds.finished),
})

export const transfersSearchDefaults = { q: '', show: 'all' } as const

export type TransfersSearch = v.InferOutput<typeof transfersSearch>

const noGroups: Group[] = []

type Props = {
  direction: Direction
  search: TransfersSearch
  onSearchChange: (patch: Partial<TransfersSearch>) => void
}

export function TransfersPage({ direction, search, onSearchChange }: Props) {
  const resource = transfers[direction]
  const { data, error } = useResource(resource)
  const filter = useFilterText(search.q, (q) => onSearchChange({ q }))
  const active = useMemo(
    () => filterGroups(data?.active ?? noGroups, filter.query, 'all'),
    [data?.active, filter.query],
  )
  const finished = useMemo(
    () => filterGroups(data?.finished ?? noGroups, filter.query, search.show),
    [data?.finished, filter.query, search.show],
  )
  const expansion = useAtom(expansions[direction])
  const [activeSelection, setActiveSelection] = useState<RowSelectionState>({})
  const [finishedSelection, setFinishedSelection] = useState<RowSelectionState>({})
  const activeTable = useSectionTable(
    'active',
    active,
    search.activeSort,
    expansion.active,
    activeSelection,
    setActiveSelection,
    (activeSort) => onSearchChange({ activeSort }),
  )
  const finishedTable = useSectionTable(
    'finished',
    finished,
    search.finishedSort,
    expansion.finished,
    finishedSelection,
    setFinishedSelection,
    (finishedSort) => onSearchChange({ finishedSort }),
  )

  const stale = useStale(resource, pollInterval)
  const soulseekGate = useSoulseekGate()
  const listGate = stale ? 'The list is out of date' : undefined
  const gates = useMemo(() => ({ list: listGate, soulseek: listGate ?? soulseekGate }), [listGate, soulseekGate])

  const selected: Transfer[] = []
  for (const table of [activeTable, finishedTable]) {
    for (const row of table.getSelectedRowModel().flatRows)
      if (row.original.kind === 'file') selected.push(row.original)
  }

  let content: ReactNode
  if (data === undefined) {
    content = <Polling what={`${direction}s`} error={error} />
  } else if (data.active.length === 0 && data.finished.length === 0) {
    content = <Empty>No {direction}s.</Empty>
  } else {
    content = (
      <TransferList
        direction={direction}
        data={data}
        active={active}
        finished={finished}
        activeTable={activeTable}
        finishedTable={finishedTable}
        filtered={filter.query !== ''}
        show={search.show}
        onShowChange={(show) => onSearchChange({ show })}
        gates={gates}
      />
    )
  }

  return (
    <Flex direction="column" height="100%">
      <Toolbar
        direction={direction}
        resource={resource}
        error={data === undefined ? undefined : error}
        text={filter.text}
        onTextChange={filter.change}
        selected={selected}
        onClearSelection={() => {
          setActiveSelection({})
          setFinishedSelection({})
        }}
        gates={gates}
      />
      {content}
    </Flex>
  )
}

type ToolbarProps = {
  direction: Direction
  resource: Resource<Transfers>
  error: unknown
  text: string
  onTextChange: (value: string) => void
  selected: Transfer[]
  onClearSelection: () => void
  gates: Gates
}

function Toolbar({ direction, resource, error, text, onTextChange, selected, onClearSelection, gates }: ToolbarProps) {
  const { running } = useAtom(actions[direction])
  const retryable = direction === 'download' ? selected.filter((file) => isFailed(file.state)) : []
  const cancellable = selected.filter((file) => !isFinished(file.state))
  const removable = selected.filter((file) => isFinished(file.state))
  return (
    <Flex align="center" gap="3" px="4" py="2" flexShrink="0" style={toolbarStyle}>
      <FilterField placeholder="Filter by user or path" value={text} onChange={onTextChange} style={{ width: 280 }} />
      {selected.length > 0 && (
        <SelectionActions count={selected.length} onClear={onClearSelection}>
          {direction === 'download' && (
            <ActionButton
              label={`Retry ${retryable.length.toLocaleString()}`}
              busy="Retrying"
              progress={running.retry}
              gate={retryable.length === 0 ? 'Nothing selected has failed' : gates.soulseek}
              onClick={() => retry(retryable)}
            />
          )}
          <ActionButton
            label={`Cancel ${cancellable.length.toLocaleString()}`}
            busy="Cancelling"
            color="red"
            progress={running.cancel}
            gate={cancellable.length === 0 ? 'Nothing selected is active' : gates.list}
            onClick={() => cancel(direction, cancellable)}
          />
          <ActionButton
            label={`Remove ${removable.length.toLocaleString()}`}
            busy="Removing"
            progress={running.remove}
            gate={removable.length === 0 ? 'Nothing selected has finished' : gates.list}
            onClick={() => remove(direction, removable)}
          />
        </SelectionActions>
      )}
      <Flex ml="auto" align="center" gap="4" flexShrink="0">
        <OutcomeLine atom={actions[direction]} />
        <Freshness resource={resource} interval={pollInterval} error={error} />
      </Flex>
    </Flex>
  )
}
