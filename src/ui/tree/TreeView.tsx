import { MinusIcon, PlusIcon, TargetIcon } from '@radix-ui/react-icons'
import { Button, Flex } from '@radix-ui/themes'
import { useDebouncedValue } from '@tanstack/react-pacer'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import { type Criteria, unjudged } from '../../lib/criteria'
import { useFrom } from '../../lib/media'
import { type SearchProps, useSortParam } from '../../lib/params'
import { type Folder, matchTree, nearestFolder, type Tree as FolderTree } from '../../lib/tree'
import { barHeight, FilterField, GatedIconButton, toolbarStyle, useFilterText } from '../controls'
import { intendFocus } from '../focus'
import { FolderPane, type TreeConfig } from './FolderPane'
import { expandTo, Tree, updateExpansion } from './Tree'

type TreeSearch<S extends string> = { path: string; q: string; sort?: S }

type Props<S extends string> = SearchProps<TreeSearch<S>> & {
  tree: FolderTree
  fetchedAt: number
  config: TreeConfig
  criteria?: Criteria
  filters?: ReactNode
}

// Below sm there's room for one pane: the folder, whose path leads up and whose folders lead down, or the tree in its
// place, from which opening a folder goes back to it.
export function TreeView<S extends string>({
  tree,
  fetchedAt,
  search,
  onSearchChange,
  config,
  criteria = unjudged,
  filters,
}: Props<S>) {
  const sm = useFrom('sm')
  const md = useFrom('md')
  const lg = useFrom('lg')
  const [treeShown, setTreeShown] = useState(false)
  const [reveal, setReveal] = useState(0)
  const filter = useFilterText(search.q, (q) => onSearchChange({ q }))
  // A big share takes long enough to filter that each letter typed quickly would hold up the next.
  const [query] = useDebouncedValue(filter.query, { wait: 150 })
  const matches = useMemo(() => matchTree(tree, query, criteria), [tree, query, criteria])
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
  // Going up lands on the folder that was left, in the pane or in whatever list the top shows instead.
  const up = useCallback(() => {
    const parent = folder.parent
    if (parent === undefined) return
    intendFocus(parent === tree.top && config.topList !== undefined ? config.topList : 'pane', `folder\n${folder.id}`)
    onSearchChange({ path: parent.path })
  }, [tree, folder, config.topList, onSearchChange])
  let revealGate: string | undefined
  if (folder === tree.top) revealGate = 'No folder is open'
  else if (matches !== undefined && !matches.counts.has(folder)) revealGate = 'The filter hides the open folder'
  const expansionGate = matches === undefined ? undefined : 'The filtered tree shows every match'
  const alone = !sm
  const treeWidth = lg ? '380px' : md ? '300px' : '260px'

  const toolbar = (
    <Flex align="center" gap="2" px="4" py="2" flexShrink="0" minHeight={barHeight} style={toolbarStyle}>
      <FilterField
        placeholder="Filter, -word to exclude"
        value={filter.text}
        onChange={filter.change}
        style={{ flexGrow: 1 }}
        main
        list={alone && !treeShown ? 'pane' : 'tree'}
      />
      {filters}
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
            label="Show the open folder"
            gate={revealGate}
            onClick={() => {
              expandTo(tree, folder, false)
              setReveal((count) => count + 1)
            }}
          >
            <TargetIcon />
          </GatedIconButton>
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
  const treePane = (
    <Tree tree={tree} selected={folder} matches={matches} onOpen={open} onUp={up} reveal={reveal} Keys={config.Keys} />
  )
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
      onUp={up}
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
