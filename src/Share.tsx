import './Table.css'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
} from '@radix-ui/react-icons'
import { Box, Button, Callout, Checkbox, Flex, Heading, IconButton, Link, Spinner, Text, TextField, Tooltip } from '@radix-ui/themes'
import {
  createColumnHelper,
  createExpandedRowModel,
  type ExpandedStateList,
  functionalUpdate,
  type Row,
  rowExpandingFeature,
  rowSelectionFeature,
  type RowSelectionState,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { Link as RouterLink } from '@tanstack/react-router'
import {
  Fragment,
  memo,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { describeError } from './api'
import {
  browse,
  browses,
  downloadFiles,
  failures,
  loadedShares,
  reloadShare,
  shareDownloadsOf,
  viewShare,
} from './browse'
import { type BrowseSearch, BrowseProgress, FailureLine, type shareColumnIds, UserBox } from './Browse'
import {
  ActionButton,
  Ago,
  MarkBadge,
  OutcomeLine,
  preventShiftSelection,
  SortButton,
  stop,
  toolbarStyle,
  VirtualTable,
} from './controls'
import { formatBytes, formatDuration, plural } from './format'
import { DelayedSpinner } from './pages'
import { formatSort, parseSort } from './params'
import type { Mark } from './results'
import {
  byName,
  filesUnder,
  type Folder,
  type Matches,
  matchesUnder,
  matchShare,
  nearestFolder,
  relativePath,
  type Share,
  type ShareFile,
} from './shareTree'
import { useSoulseekGate } from './soulseek'
import { createAtom, useAtom } from './store'
import { compareNames } from './transfers'

type Props = {
  search: BrowseSearch
  onSearchChange: (patch: Partial<BrowseSearch>) => void
}

export function SharePage({ search, onSearchChange }: Props) {
  const username = search.user
  useEffect(() => viewShare(username), [username])
  const loaded = useAtom(loadedShares).get(username)
  const running = useAtom(browses).get(username)
  const failure = useAtom(failures).get(username)
  const soulseekGate = useSoulseekGate()
  const gate = running === undefined ? soulseekGate : `Already browsing ${username}`
  const ready = loaded?.status === 'ready' ? loaded : undefined
  const top = ready?.share.top

  let content: ReactNode
  if (ready !== undefined) {
    content =
      ready.share.folderCount === 0 ? (
        <Box p="5">
          <Text color="gray">{username} shares nothing (or has blocked you).</Text>
        </Box>
      ) : (
        <ShareView share={ready.share} fetchedAt={ready.fetchedAt} search={search} onSearchChange={onSearchChange} />
      )
  } else if (loaded?.status === 'failed') {
    content = (
      <Box p="4">
        <Callout.Root color="red">
          <Callout.Text>Can't read the cached share: {describeError(loaded.error)}</Callout.Text>
        </Callout.Root>
        <Button mt="3" variant="soft" onClick={() => reloadShare(username)}>
          Try again
        </Button>
      </Box>
    )
  } else if (loaded?.status === 'missing' && running !== undefined) {
    content = (
      <Flex justify="center" p="6">
        <BrowseProgress username={username} browse={running} />
      </Flex>
    )
  } else if (loaded?.status === 'missing') {
    content = (
      <Flex direction="column" align="start" gap="3" p="5">
        <Heading size="4">Not browsed yet</Heading>
        <Text color="gray">Browsing fetches {username}'s whole share from them.</Text>
        <ActionButton label={`Browse ${username}`} busy="Browsing" gate={gate} onClick={() => void browse(username)} />
      </Flex>
    )
  } else {
    content = (
      <Flex justify="center" p="6">
        <DelayedSpinner />
      </Flex>
    )
  }

  return (
    <Flex direction="column" height="100%">
      <Flex align="center" gap="4" px="4" py="3" flexShrink="0" style={toolbarStyle}>
        <UserBox current={username} />
        {top !== undefined && (
          <Text size="2" color="gray">
            {plural(top.fileCount, 'file')} · {formatBytes(top.size)}
            {top.lockedCount > 0 && ` · ${top.lockedCount.toLocaleString()} locked`}
          </Text>
        )}
        <Flex ml="auto" align="center" gap="3" flexShrink="0">
          {ready?.notCached !== undefined && (
            <Tooltip content={ready.notCached}>
              <Text size="2" color="amber">
                Not cached
              </Text>
            </Tooltip>
          )}
          {ready !== undefined && (
            <Text size="2" color="gray">
              fetched <Ago time={ready.fetchedAt} />
            </Text>
          )}
          {ready !== undefined && (
            <ActionButton label="Re-browse" busy="Browsing" gate={gate} onClick={() => void browse(username)} />
          )}
        </Flex>
      </Flex>
      {ready !== undefined && running !== undefined ? (
        <Flex align="center" px="4" py="2" flexShrink="0" style={toolbarStyle}>
          <BrowseProgress username={username} browse={running} />
        </Flex>
      ) : (
        failure !== undefined && (
          <Flex align="center" px="4" py="2" flexShrink="0" style={toolbarStyle}>
            <FailureLine username={username} failure={failure} />
          </Flex>
        )
      )}
      {content}
    </Flex>
  )
}

const treeFeatures = tableFeatures({ rowExpandingFeature, expandedRowModel: createExpandedRowModel() })

type Expansion = { all: boolean; toggled: ExpandedStateList }

const expansions = createAtom<ReadonlyMap<string, Expansion>>(new Map())

// Each root opens down through any single-child chain, so a lone "Music" folder shows what's in it.
function initialExpansion(share: Share): Expansion {
  const toggled: ExpandedStateList = {}
  for (const root of share.top.folders) {
    for (let folder: Folder | undefined = root; folder !== undefined; ) {
      toggled[folder.id] = true
      folder = folder.folders.length === 1 ? folder.folders[0] : undefined
    }
  }
  return { all: false, toggled }
}

function updateExpansion(share: Share, change: (expansion: Expansion) => Expansion) {
  expansions.set((current) => {
    const expansion = current.get(share.username) ?? initialExpansion(share)
    const next = change(expansion)
    return next === expansion && current.has(share.username) ? current : new Map(current).set(share.username, next)
  })
}

const isOpen = (expansion: Expansion, folder: Folder) => expansion.toggled[folder.id] ?? expansion.all

function expandTo(share: Share, folder: Folder, self: boolean) {
  updateExpansion(share, (expansion) => {
    const closed: Folder[] = []
    for (let current = self ? folder : folder.parent; current !== undefined; current = current.parent) {
      if (current.path !== '' && current.folders.length > 0 && !isOpen(expansion, current)) closed.push(current)
    }
    if (closed.length === 0) return expansion
    const toggled = { ...expansion.toggled }
    for (const each of closed) toggled[each.id] = true
    return { ...expansion, toggled }
  })
}

type ViewProps = {
  share: Share
  fetchedAt: number
  search: BrowseSearch
  onSearchChange: (patch: Partial<BrowseSearch>) => void
}

const treeWidth = 380

function ShareView({ share, fetchedAt, search, onSearchChange }: ViewProps) {
  const [text, setText] = useState(search.q)
  const [urlText, setUrlText] = useState(search.q)
  if (search.q !== urlText) {
    setUrlText(search.q)
    setText(search.q)
  }
  const query = useDeferredValue(text)
  const matches = useMemo(() => matchShare(share, query), [share, query])
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
      <Flex direction="column" width={`${treeWidth}px`} flexShrink="0" style={{ boxShadow: 'inset -1px 0 0 0 var(--gray-a5)' }}>
        <Flex align="center" gap="2" px="3" py="2" flexShrink="0" style={toolbarStyle}>
          <TextField.Root
            size="2"
            placeholder="Filter folders and files, -word to exclude"
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setUrlText(event.target.value)
              onSearchChange({ q: event.target.value })
            }}
            style={{ flexGrow: 1 }}
          >
            <TextField.Slot>
              <MagnifyingGlassIcon />
            </TextField.Slot>
          </TextField.Root>
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

type TreeProps = { share: Share; selected: Folder; matches?: Matches; onOpen: (folder: Folder) => void }

const treeRowHeight = 30

function Tree({ share, selected, matches, onOpen }: TreeProps) {
  const stored = useAtom(expansions).get(share.username)
  const expansion = useMemo(() => stored ?? initialExpansion(share), [stored, share])
  // TanStack skips expansion entirely while the expanded state is empty, so "all expanded" has to be spelled out.
  const expanded = useMemo(() => {
    if (matches !== undefined) return true
    if (!expansion.all) return expansion.toggled
    const all: ExpandedStateList = {}
    for (const folder of share.byPath.values()) {
      if (folder.folders.length > 0) all[folder.id] = expansion.toggled[folder.id] ?? true
    }
    return all
  }, [share, matches, expansion])
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
    (folder: Folder) =>
      updateExpansion(share, (current) => ({
        ...current,
        toggled: { ...current.toggled, [folder.id]: !isOpen(current, folder) },
      })),
    [share],
  )
  const getItemKey = useCallback((index: number) => rows[index]?.id ?? index, [rows])
  const index = rows.findIndex((row) => row.id === selected.id)

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
      count={rows.length}
      getItemKey={getItemKey}
      rowSize={treeRowHeight}
      reveal={{ key: `${selected.id}\n${matches === undefined}`, index }}
      role="tree"
      label="Folders"
      renderRow={(index) => {
        const row = rows[index]
        if (row === undefined) return null
        const folder = row.original
        return (
          <TreeRow
            folder={folder}
            depth={row.depth}
            expanded={matches !== undefined || isOpen(expansion, folder)}
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

const paneFeatures = tableFeatures({ rowSortingFeature, rowSelectionFeature })

type Item = Folder | ShareFile

type PaneRow = Row<typeof paneFeatures, Item>

type ColumnId = (typeof shareColumnIds)[number]

const helper = createColumnHelper<typeof paneFeatures, Item>()

const columns = helper.columns([
  helper.accessor((item) => item.name, { id: 'name', sortDescFirst: false }),
  helper.accessor((item) => item.id, { id: 'folder', sortDescFirst: false }),
  helper.accessor((item) => (item.kind === 'folder' ? item.fileCount : 0), { id: 'files', sortDescFirst: true }),
  helper.accessor((item) => item.size, { id: 'size', sortDescFirst: true }),
  helper.accessor((item) => item.quality, { id: 'quality', sortDescFirst: true }),
  helper.accessor((item) => item.length ?? 0, { id: 'length', sortDescFirst: true }),
])

const columnLabels: Record<ColumnId, string> = {
  name: 'Name',
  folder: 'Folder',
  files: 'Files',
  size: 'Size',
  quality: 'Quality',
  length: 'Length',
}

const endAligned = new Set<ColumnId>(['files', 'size', 'length'])

const folderColumns: ColumnId[] = ['name', 'files', 'size', 'quality', 'length']

const matchColumns: ColumnId[] = ['name', 'folder', 'size', 'quality', 'length']

const folderTemplate = '40px minmax(280px, 1fr) 90px 100px 170px 100px'

const matchTemplate = '40px minmax(240px, 1fr) minmax(160px, 0.7fr) 100px 170px 100px'

const number = (id: ColumnId, item: Item) => {
  if (id === 'files') return item.kind === 'folder' ? item.fileCount : 0
  if (id === 'size') return item.size
  if (id === 'quality') return item.quality
  return item.length ?? 0
}

// Subfolders always stay above files, so the two are sorted apart and TanStack is told the data comes sorted.
function sortItems<T extends Item>(items: T[], [sort]: SortingState, folderOf: (item: T) => string): T[] {
  if (sort === undefined) return items
  const id = sort.id as ColumnId
  const sign = sort.desc ? -1 : 1
  const compare =
    id === 'name'
      ? byName
      : id === 'folder'
        ? (a: T, b: T) => compareNames(folderOf(a), folderOf(b))
        : (a: T, b: T) => number(id, a) - number(id, b)
  return [...items].sort((a, b) => sign * compare(a, b) || byName<Item>(a, b))
}

const selectable = (item: Item) => (item.kind === 'folder' ? item.fileCount > item.lockedCount : !item.locked)

type PaneProps = {
  share: Share
  folder: Folder
  unknown: boolean
  fetchedAt: number
  matches?: Matches
  sort: BrowseSearch['sort']
  onSearchChange: (patch: Partial<BrowseSearch>) => void
}

function FolderPane({ share, folder, unknown, fetchedAt, matches, sort, onSearchChange }: PaneProps) {
  const sorting = useMemo(() => parseSort(sort), [sort])
  const folderOf = useCallback(
    (item: Item) => (item.kind === 'file' ? relativePath(share, folder, item.folder) : ''),
    [share, folder],
  )
  const items = useMemo<Item[]>(() => {
    if (matches !== undefined) return sortItems(matchesUnder(folder, matches), sorting, folderOf)
    const files = sorting.length === 0 ? [...folder.files].sort(byName) : folder.files
    return [...sortItems(folder.folders, sorting, folderOf), ...sortItems(files, sorting, folderOf)]
  }, [folder, matches, sorting, folderOf])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const table = useTable({
    features: paneFeatures,
    columns,
    data: items,
    getRowId: (item) => `${item.kind}\n${item.id}`,
    manualSorting: true,
    enableMultiSort: false,
    enableRowSelection: (row) => selectable(row.original),
    state: { sorting, rowSelection },
    onSortingChange: (updater) =>
      onSearchChange({ sort: formatSort(functionalUpdate(updater, sorting)) as BrowseSearch['sort'] }),
    onRowSelectionChange: setRowSelection,
  })

  let count = 0
  let size = 0
  const selected: Item[] = []
  for (const row of table.getSelectedRowModel().rows) {
    const item = row.original
    selected.push(item)
    count += item.kind === 'folder' ? item.fileCount - item.lockedCount : 1
    size += item.kind === 'folder' ? item.size - item.lockedSize : item.size
  }
  const soulseekGate = useSoulseekGate()
  const downloads = useAtom(shareDownloadsOf(share.username))

  const trail: Folder[] = []
  for (let current: Folder | undefined = folder; current !== undefined; current = current.parent) trail.unshift(current)

  let summary: string
  if (matches !== undefined) summary = plural(items.length, 'matching file')
  else if (folder.folders.length === 0) summary = plural(folder.files.length, 'file')
  else {
    summary = plural(folder.folders.length, 'folder')
    if (folder.files.length > 0) summary += ` · ${plural(folder.files.length, 'file')}`
  }

  return (
    <Flex direction="column" flexGrow="1" minWidth="0">
      <Flex align="center" gap="4" px="4" py="2" flexShrink="0" minHeight="48px" style={toolbarStyle}>
        <Flex align="center" gap="1" minWidth="0" style={{ overflow: 'hidden' }}>
          {trail.map((each, index) => (
            <Fragment key={each.id}>
              {index > 0 && (
                <Text size="2" color="gray" style={{ flexShrink: 0 }}>
                  ›
                </Text>
              )}
              {each === folder ? (
                <Text size="2" weight="medium" truncate title={each.path || each.name}>
                  {each.name}
                </Text>
              ) : (
                <Link asChild size="2" color="gray" truncate style={{ flexShrink: index === 0 ? 0 : 1 }}>
                  <RouterLink from="/browse" to="/browse" search={(previous) => ({ ...previous, path: each.path })} replace>
                    {each.name}
                  </RouterLink>
                </Link>
              )}
            </Fragment>
          ))}
          <Text size="2" color="gray" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
            · {summary}
          </Text>
          {unknown && (
            <Text size="2" color="amber" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
              · Not in this share as fetched <Ago time={fetchedAt} />
            </Text>
          )}
        </Flex>
        <Flex ml="auto" align="center" gap="3" flexShrink="0">
          <OutcomeLine atom={shareDownloadsOf(share.username)} />
          {selected.length > 0 && (
            <>
              <Button size="1" variant="ghost" color="gray" onClick={() => setRowSelection({})}>
                Clear selection
              </Button>
              <ActionButton
                label={`Download ${count.toLocaleString()} (${formatBytes(size)})`}
                busy="Enqueueing"
                progress={downloads.running.download}
                gate={soulseekGate}
                onClick={() =>
                  void downloadFiles(
                    share,
                    folder,
                    selected.flatMap((item) => (item.kind === 'folder' ? filesUnder(item) : [item])),
                  )
                }
              />
            </>
          )}
        </Flex>
      </Flex>
      {items.length === 0 ? (
        <Box p="5">
          <Text color="gray">{matches !== undefined ? 'Nothing matches here.' : 'This folder is empty.'}</Text>
        </Box>
      ) : (
        <ItemList
          share={share}
          table={table}
          filtered={matches !== undefined}
          folderOf={folderOf}
          onSearchChange={onSearchChange}
        />
      )}
    </Flex>
  )
}

type PaneTable = ReturnType<typeof useTable<typeof paneFeatures, Item>>

type ListProps = {
  share: Share
  table: PaneTable
  filtered: boolean
  folderOf: (item: Item) => string
  onSearchChange: (patch: Partial<BrowseSearch>) => void
}

function ItemList({ share, table, filtered, folderOf, onSearchChange }: ListProps) {
  const { pending, marks } = useAtom(shareDownloadsOf(share.username))
  const rows = table.getRowModel().rows
  const tableRef = useRef(table)
  useLayoutEffect(() => {
    tableRef.current = table
  })
  const onSelect = useCallback((id: string, shiftKey: boolean) => {
    const row = tableRef.current.getRow(id, true)
    row.getToggleSelectedHandler()({ shiftKey, target: { checked: !row.getIsSelected() } })
  }, [])
  const onOpen = useCallback((folder: Folder) => onSearchChange({ path: folder.path }), [onSearchChange])
  const getItemKey = useCallback((index: number) => rows[index]?.id ?? index, [rows])
  const ids = filtered ? matchColumns : folderColumns
  const template = filtered ? matchTemplate : folderTemplate

  const header = (
    <div className="table-row table-columns" style={{ gridTemplateColumns: template, height: '100%' }}>
      <div className="table-cell table-check">
        <Checkbox
          checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? 'indeterminate' : false}
          onClick={() => table.toggleAllRowsSelected()}
        />
      </div>
      {ids.map((id) => {
        const column = table.getColumn(id)
        return (
          <div key={id} className="table-cell" data-align={endAligned.has(id) ? 'end' : undefined}>
            <SortButton label={columnLabels[id]} sorted={column?.getIsSorted()} onClick={column?.getToggleSortingHandler()} />
          </div>
        )
      })}
    </div>
  )

  function render(row: PaneRow) {
    const item = row.original
    if (item.kind === 'folder') {
      return <SubfolderRow folder={item} template={template} selected={row.getIsSelected()} onSelect={onSelect} onOpen={onOpen} />
    }
    return (
      <FileRow
        file={item}
        template={template}
        folder={filtered ? folderOf(item) : undefined}
        separator={share.separator}
        selected={row.getIsSelected()}
        pending={pending.has(item.id)}
        mark={marks.get(item.id)}
        onSelect={onSelect}
      />
    )
  }

  return (
    <VirtualTable
      minWidth={filtered ? 810 : 780}
      header={header}
      count={rows.length}
      getItemKey={getItemKey}
      renderRow={(index) => {
        const row = rows[index]
        return row && render(row)
      }}
    />
  )
}

type SubfolderRowProps = {
  folder: Folder
  template: string
  selected: boolean
  onSelect: (id: string, shiftKey: boolean) => void
  onOpen: (folder: Folder) => void
}

const SubfolderRow = memo(function SubfolderRow({ folder, template, selected, onSelect, onOpen }: SubfolderRowProps) {
  const id = `folder\n${folder.id}`
  const empty = folder.fileCount === folder.lockedCount
  return (
    <div
      className="table-row table-group"
      style={{ gridTemplateColumns: template, cursor: 'pointer' }}
      data-selected={selected || undefined}
      data-dimmed={folder.locked || undefined}
      onClick={() => onOpen(folder)}
    >
      <div className="table-cell table-check" onClick={stop}>
        <Checkbox checked={selected} disabled={empty} onClick={(event) => onSelect(id, event.shiftKey)} />
      </div>
      <Flex className="table-cell" align="center" gap="2" title={folder.name}>
        {folder.locked ? <LockClosedIcon style={{ flexShrink: 0 }} /> : <ChevronRightIcon style={{ flexShrink: 0 }} />}
        <Text size="2" weight="medium" truncate>
          {folder.name}
        </Text>
      </Flex>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {folder.fileCount.toLocaleString()}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {formatBytes(folder.size)}
        </Text>
      </div>
      <div className="table-cell" title={folder.qualityLabel}>
        <Text size="2" color="gray">
          {folder.qualityLabel}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {folder.length > 0 && formatDuration(folder.length)}
        </Text>
      </div>
    </div>
  )
})

type FileRowProps = {
  file: ShareFile
  template: string
  folder?: string
  separator: string
  selected: boolean
  pending: boolean
  mark?: Mark
  onSelect: (id: string, shiftKey: boolean) => void
}

const FileRow = memo(function FileRow({ file, template, folder, separator, selected, pending, mark, onSelect }: FileRowProps) {
  const id = `file\n${file.id}`
  return (
    <div
      className="table-row"
      style={{ gridTemplateColumns: template }}
      data-selected={selected || undefined}
      data-dimmed={file.locked || undefined}
      onMouseDown={preventShiftSelection}
      onClick={(event) => !file.locked && onSelect(id, event.shiftKey)}
    >
      <div className="table-cell table-check" onClick={stop}>
        <Checkbox checked={selected} disabled={file.locked} onClick={(event) => onSelect(id, event.shiftKey)} />
      </div>
      <Flex className="table-cell" align="center" gap="2" title={file.path}>
        {file.locked ? <LockClosedIcon style={{ flexShrink: 0 }} /> : <FileIcon style={{ flexShrink: 0 }} />}
        <Text size="2" truncate>
          {file.name}
        </Text>
        {mark !== undefined && <MarkBadge mark={mark} />}
        {pending && <Spinner size="1" />}
      </Flex>
      {folder === undefined ? (
        <div className="table-cell" />
      ) : (
        <div className="table-cell" title={folder}>
          <Text size="2" color="gray">
            {folder.split(separator).join(' › ')}
          </Text>
        </div>
      )}
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {formatBytes(file.size)}
        </Text>
      </div>
      <div className="table-cell">
        <Text size="2" color="gray">
          {file.qualityLabel}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {file.length !== undefined && formatDuration(file.length)}
        </Text>
      </div>
    </div>
  )
})
