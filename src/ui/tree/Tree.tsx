import { ChevronDownIcon, ChevronRightIcon, LockClosedIcon } from '@radix-ui/react-icons'
import { Box, Text } from '@radix-ui/themes'
import type { ExpandedStateList } from '@tanstack/react-table'
import { type ComponentType, memo, useCallback, useMemo, useState } from 'react'

import { useFrom, useTouch } from '../../lib/media'
import { createAtom, useAtom } from '../../lib/store'
import type { Folder, Matches, Tree as FolderTree } from '../../lib/tree'
import { focusList } from '../focus'
import { useListKeys } from '../keys'
import { useListNav } from '../listNav'
import { type Expansion, isExpanded, rowId, stop, toggleExpanded, VirtualTable } from '../table'
import { type KeysProps, upKeys } from './keys'

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

type FolderRow = {
  id: string
  folder: Folder
  depth: number
  index: number
  siblings: number
  parent: boolean
  open: boolean
}

// Built by hand rather than with TanStack, whose row models visit every folder in the share, open or not.
function visibleRows(tree: FolderTree, matches: Matches | undefined, expansion: Expansion) {
  const rows: FolderRow[] = []
  const childrenOf = (folder: Folder) =>
    matches === undefined ? folder.folders : folder.folders.filter((each) => matches.counts.has(each))
  const visit = (folders: Folder[], depth: number) => {
    for (const [index, folder] of folders.entries()) {
      const children = childrenOf(folder)
      const open = matches !== undefined || isExpanded(expansion, folder.id)
      rows.push({ id: folder.id, folder, depth, index, siblings: folders.length, parent: children.length > 0, open })
      if (open && children.length > 0) visit(children, depth + 1)
    }
  }
  visit(childrenOf(tree.top), 0)
  return rows
}

type TreeProps = {
  tree: FolderTree
  selected: Folder
  matches?: Matches
  onOpen: (folder: Folder) => void
  onUp: () => void
  // Each new value takes the keyboard to the open folder.
  reveal: number
  Keys?: ComponentType<KeysProps>
}

const noop = () => {}

export function Tree({ tree, selected, matches, onOpen, onUp, reveal, Keys }: TreeProps) {
  const sm = useFrom('sm')
  const touch = useTouch()
  const stored = useAtom(expansions).get(tree.key)
  const expansion = useMemo(() => stored ?? initialExpansion(tree), [stored, tree])
  const rows = useMemo(() => visibleRows(tree, matches, expansion), [tree, matches, expansion])
  const onToggle = useCallback(
    (folder: Folder) => updateExpansion(tree, (current) => toggleExpanded(current, folder.id)),
    [tree],
  )
  const filtered = matches !== undefined
  const nav = useListNav({
    name: 'tree',
    items: rows,
    itemKey: rowId,
    rank: 2,
    anchor: selected.id,
    role: 'tree',
    label: 'Folders',
    depth: (row) => row.depth,
    canToggle: (row) => !filtered && row.parent,
    isOpen: (row) => row.open,
    onToggle: (row) => onToggle(row.folder),
    // Enter opens a folder, and on the open one goes into it.
    onEnter: (row) => (row.folder === selected ? focusList('pane') : onOpen(row.folder)),
    aria: (row) => ({
      'aria-level': row.depth + 1,
      'aria-setsize': row.siblings,
      'aria-posinset': row.index + 1,
      'aria-expanded': row.parent ? row.open : undefined,
      'aria-selected': row.folder === selected,
    }),
  })
  useListKeys(nav.containerRef, upKeys(onUp))
  const [seenReveal, setSeenReveal] = useState(reveal)
  if (reveal !== seenReveal) {
    setSeenReveal(reveal)
    nav.focusKey(selected.id)
  }
  const selectedIndex = rows.findIndex((row) => row.id === selected.id)

  if (rows.length === 0) {
    return (
      <Box p="4">
        <Text size="2" color="gray">
          Nothing matches.
        </Text>
      </Box>
    )
  }

  return (
    <>
      {Keys !== undefined && (
        <Keys
          target={nav.containerRef}
          tree
          selection={() => {
            const folder = nav.focused()?.folder
            return folder && { tree, folder, items: [folder], clear: noop }
          }}
        />
      )}
      <VirtualTable
        items={rows}
        itemKey={rowId}
        rowSize={!sm ? 40 : touch ? 36 : 30}
        reveal={{ key: `${selected.id}\n${matches === undefined}`, index: selectedIndex }}
        nav={nav}
        renderItem={(row) => {
          const folder = row.folder
          return (
            <TreeRow
              folder={folder}
              depth={row.depth}
              expanded={row.open}
              selected={folder === selected}
              count={matches?.counts.get(folder) ?? folder.fileCount}
              filtered={matches !== undefined}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          )
        }}
      />
    </>
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
    <div
      className="tree-row"
      data-selected={selected || undefined}
      data-dimmed={folder.locked || folder.hidden || undefined}
      style={{ paddingLeft: 12 + depth * 16 }}
      title={folder.name}
      onClick={() => onOpen(folder)}
    >
      {parent && !filtered ? (
        <button
          type="button"
          className="tree-toggle"
          tabIndex={-1}
          aria-hidden
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
