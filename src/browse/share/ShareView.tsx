import { MinusIcon, PlusIcon } from '@radix-ui/react-icons'
import { Flex, IconButton, Tooltip } from '@radix-ui/themes'
import { useCallback, useEffect, useMemo } from 'react'
import { FilterField, toolbarStyle, useFilterText } from '../../ui/controls'
import type { BrowseSearch } from '../params'
import { type Folder, matchShare, nearestFolder, type Share } from '../shareTree'
import { FolderPane } from './FolderPane'
import { expandTo, Tree, updateExpansion } from './Tree'

type Props = {
  share: Share
  fetchedAt: number
  search: BrowseSearch
  onSearchChange: (patch: Partial<BrowseSearch>) => void
}

const treeWidth = 380

export function ShareView({ share, fetchedAt, search, onSearchChange }: Props) {
  const filter = useFilterText(search.q, (q) => onSearchChange({ q }))
  const matches = useMemo(() => matchShare(share, filter.query), [share, filter.query])
  const folder = useMemo(() => nearestFolder(share, search.path), [share, search.path])
  useEffect(() => expandTo(share, folder, false), [share, folder])
  const open = useCallback(
    (target: Folder) => {
      expandTo(share, target, true)
      onSearchChange({ path: target.path })
    },
    [share, onSearchChange],
  )

  return (
    <Flex flexGrow="1" minHeight="0">
      <Flex
        direction="column"
        width={`${treeWidth}px`}
        flexShrink="0"
        style={{ boxShadow: 'inset -1px 0 0 0 var(--gray-a5)' }}
      >
        <Flex align="center" gap="2" px="3" py="2" flexShrink="0" style={toolbarStyle}>
          <FilterField
            placeholder="Filter folders and files, -word to exclude"
            value={filter.text}
            onChange={filter.change}
            style={{ flexGrow: 1 }}
          />
          <Tooltip content="Expand all">
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              aria-label="Expand all"
              onClick={() => updateExpansion(share, () => ({ all: true, toggled: {} }))}
            >
              <PlusIcon />
            </IconButton>
          </Tooltip>
          <Tooltip content="Collapse all">
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              aria-label="Collapse all"
              onClick={() => updateExpansion(share, () => ({ all: false, toggled: {} }))}
            >
              <MinusIcon />
            </IconButton>
          </Tooltip>
        </Flex>
        <Tree share={share} selected={folder} matches={matches} onOpen={open} />
      </Flex>
      <FolderPane
        key={folder.id}
        share={share}
        folder={folder}
        unknown={folder.path !== search.path}
        fetchedAt={fetchedAt}
        matches={matches}
        sort={search.sort}
        onSearchChange={onSearchChange}
      />
    </Flex>
  )
}
