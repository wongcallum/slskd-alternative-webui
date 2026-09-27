import { Flex, Text } from '@radix-ui/themes'
import { useMemo, useState } from 'react'

import { formatBytes, plural } from '../../lib/format'
import type { SearchProps } from '../../lib/params'
import { useAtom, useResource } from '../../lib/store'
import type { Item } from '../../lib/tree'
import { useRun } from '../../lib/useRun'
import { ActionButton, ConfirmButton, ConfirmDialog, OutcomeLine } from '../../ui/controls'
import { useListKeys } from '../../ui/keys'
import { Ago, FetchedResource, Fetching } from '../../ui/status'
import type { ExtraColumn } from '../../ui/tree/columns'
import type { Selection, TreeConfig } from '../../ui/tree/FolderPane'
import type { KeysProps } from '../../ui/tree/keys'
import { TreeView } from '../../ui/tree/TreeView'
import { stateGate, useApplication } from '../application'
import { useOptions } from '../options/options'
import { rescan } from '../shares/shares'
import { SystemPage } from '../SystemPage'
import {
  deleteItems,
  dismissSharedHint,
  encodePath,
  fileActions,
  files,
  filesLoading,
  type Target,
  targetsOf,
} from './files'
import type { FilesSearch } from './params'

type Props = SearchProps<FilesSearch>

export function FilesPage({ search, onSearchChange }: Props) {
  const { data, error } = useResource(files)
  const deleting = useOptions()?.remoteFileManagement === true
  const config = useMemo(() => filesConfig(deleting), [deleting])
  return (
    <SystemPage status={<FetchedResource resource={files} loading={filesLoading} />}>
      {data !== undefined ? (
        <TreeView
          tree={data.tree}
          fetchedAt={data.fetchedAt}
          search={search}
          onSearchChange={onSearchChange}
          config={config}
        />
      ) : (
        <Fetching error={error} onRetry={files.refresh}>
          Can't list the files
        </Fetching>
      )}
    </SystemPage>
  )
}

const modifiedColumn: ExtraColumn = {
  id: 'modified',
  label: 'Modified',
  width: 120,
  value: (item) => item.modifiedAt ?? 0,
  render: (item) => item.modifiedAt !== undefined && <Ago time={item.modifiedAt} />,
}

// The two roots can't be deleted.
const selectable = (item: Item) => item.kind === 'file' || item.path.includes('/')

const filesConfig = (deleting: boolean): TreeConfig => ({
  page: '/system/files',
  scope: 'the listing',
  extras: [modifiedColumn],
  selectable: deleting ? selectable : undefined,
  actions: deleting ? (selection) => <DeleteAction selection={selection} /> : undefined,
  status: <FilesStatus />,
  Keys: deleting ? DeleteKey : undefined,
})

function describeTargets(targets: readonly Target[]) {
  const folders = targets.filter((target) => target.kind === 'folder').length
  const count = targets.length - folders
  const parts = [folders > 0 && plural(folders, 'folder'), count > 0 && plural(count, 'file')].filter(Boolean)
  return parts.join(' and ')
}

function describeDelete(items: readonly Item[], listingError: unknown) {
  const targets = targetsOf(items)
  const size = targets.reduce((sum, target) => sum + target.size, 0)
  const unaddressable = targets.find((target) => encodePath(target.relative) === undefined)
  let gate: string | undefined
  if (listingError !== undefined) gate = 'The last listing failed, so it may be out of date'
  else if (unaddressable !== undefined) {
    gate = `slskd can't address ${unaddressable.id.slice(unaddressable.id.lastIndexOf('/') + 1)}; delete its folder instead`
  }
  const description = [
    `This permanently deletes ${formatBytes(size)} from slskd's disk.`,
    ...(targets.some((target) => target.root === 'incomplete')
      ? ['A download still writing to Incomplete keeps going, and most likely ends as succeeded with no file.']
      : []),
  ].join(' ')
  return {
    label: `Delete ${targets.length.toLocaleString()} (${formatBytes(size)})`,
    title: `Delete ${describeTargets(targets)}?`,
    description,
    gate,
  }
}

function DeleteAction({ selection }: { selection: Selection }) {
  const { running } = useAtom(fileActions)
  const { error } = useResource(files)
  const { label, title, description, gate } = useMemo(
    () => describeDelete(selection.items, error),
    [selection.items, error],
  )
  return (
    <ConfirmButton
      label={label}
      busy="Deleting"
      color="red"
      progress={running.delete}
      gate={gate}
      title={title}
      description={description}
      action="Delete"
      shortcut={{ key: 'Delete', name: 'Delete' }}
      onConfirm={() => void deleteItems(selection.items)}
    />
  )
}

const nothing: readonly Item[] = []

// Delete asks about the pane's selection, or the row the keyboard is on, as the Delete button does.
function DeleteKey({ target, tree, selection }: KeysProps) {
  const { running } = useAtom(fileActions)
  const { error } = useResource(files)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(nothing)
  const { title, description } = useMemo(() => describeDelete(items, error), [items, error])
  useListKeys(
    target,
    tree
      ? []
      : [
          {
            hotkeys: ['Delete', 'Mod+Backspace'],
            name: 'Delete',
            enabled: running.delete === undefined,
            run: () => {
              const chosen = selection()?.items.filter(selectable) ?? []
              if (chosen.length === 0 || describeDelete(chosen, error).gate !== undefined) return
              setItems(chosen)
              setOpen(true)
            },
          },
        ],
  )
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={title}
      description={description}
      action="Delete"
      color="red"
      onConfirm={() => void deleteItems(items)}
    />
  )
}

function FilesStatus() {
  const options = useOptions()
  return (
    <Flex align="center" gap="3">
      <OutcomeLine atom={fileActions} />
      <SharedHint />
      {options?.remoteFileManagement !== true && (
        <ActionButton
          label="Delete"
          gate={
            options === undefined
              ? "slskd's options haven't arrived yet"
              : 'Deleting needs remote_file_management turned on in slskd'
          }
          onClick={() => {}}
        />
      )}
    </Flex>
  )
}

function SharedHint() {
  const { outcome, sharedDeleted } = useAtom(fileActions)
  const { known } = useApplication()
  const run = useRun()
  if (outcome === undefined || !sharedDeleted) return null
  return (
    <Flex align="center" gap="2">
      <Text size="2" color={run.error === undefined ? 'amber' : 'red'}>
        {run.error ?? 'Still in your shares until a rescan'}
      </Text>
      <ActionButton
        label="Rescan"
        loading={run.running}
        gate={stateGate(known)}
        onClick={() =>
          run.run(async () => {
            await rescan()
            dismissSharedHint()
          })
        }
      />
    </Flex>
  )
}
