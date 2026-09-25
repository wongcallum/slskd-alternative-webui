import { MinusIcon, PlusIcon } from '@radix-ui/react-icons'
import { Button, Flex } from '@radix-ui/themes'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useFrom } from '../../lib/media'
import { useSortParam } from '../../lib/params'
import { type Folder, matchTree, nearestFolder, type Tree as FolderTree } from '../../lib/tree'
import { FilterField, GatedIconButton, toolbarStyle, useFilterText } from '../controls'
import { FolderPane, type TreeConfig } from './FolderPane'
import { expandTo, Tree, updateExpansion } from './Tree'

export type TreeSearch<S extends string> = { path: string; q: string; sort?: S }

type Props<S extends string> = {
  tree: FolderTree
  fetchedAt: number
  search: TreeSearch<S>
  onSearchChange: (patch: Partial<TreeSearch<S>>) => void
  config: TreeConfig
}

// Below sm there's room for one pane: the folder, whose path leads up and whose folders lead down, or the tree in its
// place, from which opening a folder goes back to it.
export function TreeView<S extends string>({ tree, fetchedAt, search, onSearchChange, config }: Props<S>) {
  const sm = useFrom('sm')
  const md = useFrom('md')
  const lg = useFrom('lg')
  const [treeShown, setTreeShown] = useState(false)
  const filter = useFilterText(search.q, (q) => onSearchChange({ q }))
  const matches = useMemo(() => matchTree(tree, filter.query), [tree, filter.query])
  const folder = useMemo(() => nearestFolder(tree, search.path), [tree, search.path])
  const { sorting, onSortingChange } = useSortParam(search.sort, (sort) => onSearchChange({ sort }))
  useEffect(() => expandTo(tree, folder, false), [tree, folder])
  const open = useCallback(
    (target: Folder) => {
      expandTo(tree, target, true)
      onSearchChange({ path: target.path })
      setTreeShown(false)
    },
    [tree, onSearchChange],
  )
  const enter = useCallback((target: Folder) => onSearchChange({ path: target.path }), [onSearchChange])
  const expansionGate = matches === undefined ? undefined : 'The filtered tree shows every match'
  const alone = !sm
  const treeWidth = lg ? '380px' : md ? '300px' : '260px'

  const toolbar = (
    <Flex align="center" gap="2" px="3" py="2" flexShrink="0" style={toolbarStyle}>
      <FilterField
        placeholder="Filter, -word to exclude"
        value={filter.text}
        onChange={filter.change}
        style={{ flexGrow: 1 }}
      />
      {alone && (
        <Button
          variant={treeShown ? 'solid' : 'soft'}
          color="gray"
          aria-pressed={treeShown}
          onClick={() => setTreeShown((shown) => !shown)}
        >
          Folders
        </Button>
      )}
      {(!alone || treeShown) && (
        <>
          <GatedIconButton
            label="Expand all"
            gate={expansionGate}
            onClick={() => updateExpansion(tree, () => ({ all: true, toggled: {} }))}
          >
            <PlusIcon />
          </GatedIconButton>
          <GatedIconButton
            label="Collapse all"
            gate={expansionGate}
            onClick={() => updateExpansion(tree, () => ({ all: false, toggled: {} }))}
          >
            <MinusIcon />
          </GatedIconButton>
        </>
      )}
    </Flex>
  )
  const treePane = <Tree tree={tree} selected={folder} matches={matches} onOpen={open} />
  const folderPane = (
    <FolderPane
      key={folder.id}
      tree={tree}
      folder={folder}
      missing={folder.path === search.path ? undefined : search.path}
      fetchedAt={fetchedAt}
      matches={matches}
      sorting={sorting}
      onSortingChange={onSortingChange}
      onOpen={enter}
      config={config}
    />
  )

  if (alone) {
    return (
      <Flex direction="column" flexGrow="1" minHeight="0">
        {toolbar}
        {treeShown ? treePane : folderPane}
      </Flex>
    )
  }
  return (
    <Flex flexGrow="1" minHeight="0">
      <Flex
        direction="column"
        width={treeWidth}
        flexShrink="0"
        style={{ boxShadow: 'inset -1px 0 0 0 var(--gray-a5)' }}
      >
        {toolbar}
        {treePane}
      </Flex>
      {folderPane}
    </Flex>
  )
}
