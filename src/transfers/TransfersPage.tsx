import { MagnifyingGlassIcon } from '@radix-ui/react-icons'
import { Box, Button, Callout, Flex, Text, TextField } from '@radix-ui/themes'
import type { RowSelectionState } from '@tanstack/react-table'
import { type ReactNode, useDeferredValue, useMemo, useState } from 'react'
import * as v from 'valibot'
import { describeError } from '../lib/api'
import { oneOf, sortOf, textParam } from '../lib/params'
import { type Resource, useAtom, useResource, useStale } from '../lib/store'
import { useSoulseekGate } from '../soulseek/soulseek'
import { ActionButton, DelayedSpinner, Freshness, OutcomeLine, toolbarStyle } from '../ui/controls'
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
  const [text, setText] = useState(search.q)
  const [urlText, setUrlText] = useState(search.q)
  if (search.q !== urlText) {
    setUrlText(search.q)
    setText(search.q)
  }
  const query = useDeferredValue(text)
  const active = useMemo(() => filterGroups(data?.active ?? noGroups, query, 'all'), [data?.active, query])
  const finished = useMemo(
    () => filterGroups(data?.finished ?? noGroups, query, search.show),
    [data?.finished, query, search.show],
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
    (value) => onSearchChange({ activeSort: value as TransfersSearch['activeSort'] }),
  )
  const finishedTable = useSectionTable(
    'finished',
    finished,
    search.finishedSort,
    expansion.finished,
    finishedSelection,
    setFinishedSelection,
    (value) => onSearchChange({ finishedSort: value as TransfersSearch['finishedSort'] }),
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
    content =
      error === undefined ? (
        <Flex justify="center" p="6">
          <DelayedSpinner />
        </Flex>
      ) : (
        <Box p="4">
          <Callout.Root color="red">
            <Callout.Text>
              Can't load {direction}s: {describeError(error)}. Retrying.
            </Callout.Text>
          </Callout.Root>
        </Box>
      )
  } else if (data.active.length === 0 && data.finished.length === 0) {
    content = (
      <Box p="5">
        <Text color="gray">No {direction}s.</Text>
      </Box>
    )
  } else {
    content = (
      <TransferList
        direction={direction}
        data={data}
        active={active}
        finished={finished}
        activeTable={activeTable}
        finishedTable={finishedTable}
        filtered={query !== ''}
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
        text={text}
        onTextChange={(value) => {
          setText(value)
          setUrlText(value)
          onSearchChange({ q: value })
        }}
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
      <TextField.Root
        size="2"
        placeholder="Filter by user or path"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        style={{ width: 280 }}
      >
        <TextField.Slot>
          <MagnifyingGlassIcon />
        </TextField.Slot>
      </TextField.Root>
      {selected.length > 0 && (
        <Flex align="center" gap="2">
          <Text size="2" color="gray">
            {selected.length.toLocaleString()} selected
          </Text>
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
          <Button size="1" variant="ghost" color="gray" onClick={onClearSelection}>
            Clear selection
          </Button>
        </Flex>
      )}
      <Flex ml="auto" align="center" gap="4" flexShrink="0">
        <OutcomeLine atom={actions[direction]} />
        <Freshness resource={resource} interval={pollInterval} error={error} />
      </Flex>
    </Flex>
  )
}
