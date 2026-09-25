import { ChevronDownIcon, ChevronRightIcon, LockClosedIcon } from '@radix-ui/react-icons'
import { Box, Text } from '@radix-ui/themes'
import {
  createExpandedRowModel,
  type ExpandedStateList,
  rowExpandingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { memo, useCallback, useMemo } from 'react'
import { createAtom, useAtom } from '../../lib/store'
import { type Expansion, expandedState, isExpanded, rowId, stop, toggleExpanded, VirtualTable } from '../../ui/table'
import type { Folder, Matches, Share } from '../shareTree'

const treeFeatures = tableFeatures({ rowExpandingFeature, expandedRowModel: createExpandedRowModel() })

const expansions = createAtom<ReadonlyMap<string, Expansion>>(new Map())

// Each root opens down through any single-child chain, so a lone "Music" folder shows what's in it.
function initialExpansion(share: Share): Expansion {
  const toggled: ExpandedStateList = {}
  for (const root of share.top.folders) {
    for (let folder: Folder | undefined = root; folder !== undefined;) {
      toggled[folder.id] = true
      folder = folder.folders.length === 1 ? folder.folders[0] : undefined
    }
  }
  return { all: false, toggled }
}

export function updateExpansion(share: Share, change: (expansion: Expansion) => Expansion) {
  expansions.set((current) => {
    const expansion = current.get(share.username) ?? initialExpansion(share)
    const next = change(expansion)
    return next === expansion && current.has(share.username) ? current : new Map(current).set(share.username, next)
  })
}

function* parentsIn(share: Share) {
  for (const folder of share.byPath.values()) if (folder.folders.length > 0) yield folder
}

export function expandTo(share: Share, folder: Folder, self: boolean) {
  updateExpansion(share, (expansion) => {
    const closed: Folder[] = []
    for (let current = self ? folder : folder.parent; current !== undefined; current = current.parent) {
      if (current.path !== '' && current.folders.length > 0 && !isExpanded(expansion, current.id)) closed.push(current)
    }
    if (closed.length === 0) return expansion
    const toggled = { ...expansion.toggled }
    for (const each of closed) toggled[each.id] = true
    return { ...expansion, toggled }
  })
}

type TreeProps = { share: Share; selected: Folder; matches?: Matches; onOpen: (folder: Folder) => void }

const treeRowHeight = 30

export function Tree({ share, selected, matches, onOpen }: TreeProps) {
  const stored = useAtom(expansions).get(share.username)
  const expansion = useMemo(() => stored ?? initialExpansion(share), [stored, share])
  const expanded = useMemo(
    () => matches !== undefined || expandedState(expansion, parentsIn(share)),
    [share, matches, expansion],
  )
  const roots = useMemo(
    () => (matches === undefined ? share.top.folders : share.top.folders.filter((each) => matches.counts.has(each))),
    [share, matches],
  )
  const table = useTable({
    features: treeFeatures,
    columns: [],
    data: roots,
    getRowId: (folder) => folder.id,
    getSubRows: (folder) =>
      matches === undefined ? folder.folders : folder.folders.filter((each) => matches.counts.has(each)),
    autoResetExpanded: false,
    state: { expanded },
  })
  const rows = table.getRowModel().rows
  const onToggle = useCallback(
    (folder: Folder) => updateExpansion(share, (current) => toggleExpanded(current, folder.id)),
    [share],
  )
  const selectedIndex = rows.findIndex((row) => row.id === selected.id)

  if (rows.length === 0) {
    return (
      <Box p="3">
        <Text size="2" color="gray">
          Nothing matches.
        </Text>
      </Box>
    )
  }

  return (
    <VirtualTable
      minWidth={0}
      items={rows}
      itemKey={rowId}
      rowSize={treeRowHeight}
      reveal={{ key: `${selected.id}\n${matches === undefined}`, index: selectedIndex }}
      role="tree"
      label="Folders"
      renderItem={(row) => {
        const folder = row.original
        return (
          <TreeRow
            folder={folder}
            depth={row.depth}
            expanded={matches !== undefined || isExpanded(expansion, folder.id)}
            selected={folder === selected}
            count={matches?.counts.get(folder) ?? folder.fileCount}
            filtered={matches !== undefined}
            onOpen={onOpen}
            onToggle={onToggle}
          />
        )
      }}
    />
  )
}

type TreeRowProps = {
  folder: Folder
  depth: number
  expanded: boolean
  selected: boolean
  count: number
  filtered: boolean
  onOpen: (folder: Folder) => void
  onToggle: (folder: Folder) => void
}

const TreeRow = memo(function TreeRow({
  folder,
  depth,
  expanded,
  selected,
  count,
  filtered,
  onOpen,
  onToggle,
}: TreeRowProps) {
  const parent = folder.folders.length > 0
  return (
    // TODO: keyboard handling makes tree items focusable.
    // oxlint-disable-next-line jsx-a11y/interactive-supports-focus
    <div
      className="tree-row"
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={parent ? expanded : undefined}
      aria-selected={selected}
      data-selected={selected || undefined}
      data-dimmed={folder.locked || undefined}
      style={{ paddingLeft: 8 + depth * 16 }}
      title={folder.name}
      onClick={() => onOpen(folder)}
    >
      {parent && !filtered ? (
        <button
          type="button"
          className="tree-toggle"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={(event) => {
            stop(event)
            onToggle(folder)
          }}
        >
          {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </button>
      ) : (
        <span className="tree-toggle" />
      )}
      {folder.locked && <LockClosedIcon style={{ flexShrink: 0 }} />}
      <Text size="2" truncate>
        {folder.name}
      </Text>
      <Text size="1" color="gray" ml="auto" style={{ flexShrink: 0, paddingLeft: 'var(--space-2)' }}>
        {count.toLocaleString()}
      </Text>
    </div>
  )
})
