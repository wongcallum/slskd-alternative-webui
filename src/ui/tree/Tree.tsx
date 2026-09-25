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

import { useFrom, useTouch } from '../../lib/media'
import { createAtom, useAtom } from '../../lib/store'
import type { Folder, Matches, Tree as FolderTree } from '../../lib/tree'
import { type Expansion, expandedState, isExpanded, rowId, stop, toggleExpanded, VirtualTable } from '../table'

const treeFeatures = tableFeatures({ rowExpandingFeature, expandedRowModel: createExpandedRowModel() })

const expansions = createAtom<ReadonlyMap<string, Expansion>>(new Map())

// Each root opens down through any single-child chain, so a lone "Music" folder shows what's in it.
function initialExpansion(tree: FolderTree): Expansion {
  const toggled: ExpandedStateList = {}
  for (const root of tree.top.folders) {
    for (let folder: Folder | undefined = root; folder !== undefined;) {
      toggled[folder.id] = true
      folder = folder.folders.length === 1 ? folder.folders[0] : undefined
    }
  }
  return { all: false, toggled }
}

export function updateExpansion(tree: FolderTree, change: (expansion: Expansion) => Expansion) {
  expansions.set((current) => {
    const expansion = current.get(tree.key) ?? initialExpansion(tree)
    const next = change(expansion)
    return next === expansion && current.has(tree.key) ? current : new Map(current).set(tree.key, next)
  })
}

function* parentsIn(tree: FolderTree) {
  for (const folder of tree.byPath.values()) if (folder.folders.length > 0) yield folder
}

export function expandTo(tree: FolderTree, folder: Folder, self: boolean) {
  updateExpansion(tree, (expansion) => {
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

type TreeProps = { tree: FolderTree; selected: Folder; matches?: Matches; onOpen: (folder: Folder) => void }

export function Tree({ tree, selected, matches, onOpen }: TreeProps) {
  const sm = useFrom('sm')
  const touch = useTouch()
  const stored = useAtom(expansions).get(tree.key)
  const expansion = useMemo(() => stored ?? initialExpansion(tree), [stored, tree])
  const expanded = useMemo(
    () => matches !== undefined || expandedState(expansion, parentsIn(tree)),
    [tree, matches, expansion],
  )
  const roots = useMemo(
    () => (matches === undefined ? tree.top.folders : tree.top.folders.filter((each) => matches.counts.has(each))),
    [tree, matches],
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
    (folder: Folder) => updateExpansion(tree, (current) => toggleExpanded(current, folder.id)),
    [tree],
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
      rowSize={!sm ? 40 : touch ? 36 : 30}
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
      data-dimmed={folder.locked || folder.hidden || undefined}
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
