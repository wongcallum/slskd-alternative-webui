import { Flex, Text } from '@radix-ui/themes'
import { Link as RouterLink } from '@tanstack/react-router'
import { useMemo } from 'react'

import { describeError } from '../../lib/api'
import { formatBytes, plural } from '../../lib/format'
import { useAtom, useResource } from '../../lib/store'
import type { Item } from '../../lib/tree'
import { useRun } from '../../lib/useRun'
import { ActionButton, ConfirmButton, OutcomeLine } from '../../ui/controls'
import { Ago, ErrorCallout, FetchedResource, Loading } from '../../ui/status'
import type { ExtraColumn } from '../../ui/tree/columns'
import type { FolderLinkProps, Selection, TreeConfig } from '../../ui/tree/FolderPane'
import { TreeView } from '../../ui/tree/TreeView'
import { useApplication } from '../application'
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

type Props = {
  search: FilesSearch
  onSearchChange: (patch: Partial<FilesSearch>) => void
}

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
      ) : error === undefined ? (
        <Loading />
      ) : (
        <ErrorCallout onRetry={files.refresh}>Can't list the files: {describeError(error)}</ErrorCallout>
      )}
    </SystemPage>
  )
}

function FilesFolderLink({ path, ...props }: FolderLinkProps) {
  return (
    <RouterLink {...props} from="/system/files" to="/system/files" search={(previous) => ({ ...previous, path })} />
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
  scope: 'the listing',
  extras: [modifiedColumn],
  FolderLink: FilesFolderLink,
  selectable: deleting ? selectable : undefined,
  actions: deleting ? (selection) => <DeleteAction selection={selection} /> : undefined,
  status: <FilesStatus />,
})

function describeTargets(targets: readonly Target[]) {
  const folders = targets.filter((target) => target.kind === 'folder').length
  const count = targets.length - folders
  const parts = [folders > 0 && plural(folders, 'folder'), count > 0 && plural(count, 'file')].filter(Boolean)
  return parts.join(' and ')
}

function DeleteAction({ selection }: { selection: Selection }) {
  const { running } = useAtom(fileActions)
  const { error } = useResource(files)
  const targets = targetsOf(selection.items)
  const size = targets.reduce((sum, target) => sum + target.size, 0)
  const unaddressable = targets.find((target) => encodePath(target.relative) === undefined)
  let gate: string | undefined
  if (error !== undefined) gate = 'The last listing failed, so it may be out of date'
  else if (unaddressable !== undefined) {
    gate = `slskd can't address ${unaddressable.id.slice(unaddressable.id.lastIndexOf('/') + 1)}; delete its folder instead`
  }
  const description = [
    `This deletes ${formatBytes(size)} from slskd's disk for good.`,
    ...(targets.some((target) => target.root === 'incomplete')
      ? [
          'A download still writing to Incomplete carries on regardless, and most likely ends as succeeded with no file.',
        ]
      : []),
  ].join(' ')
  return (
    <ConfirmButton
      label={`Delete ${targets.length.toLocaleString()} (${formatBytes(size)})`}
      busy="Deleting"
      color="red"
      progress={running.delete}
      gate={gate}
      title={`Delete ${describeTargets(targets)}?`}
      description={description}
      action="Delete"
      onConfirm={() => void deleteItems(selection.items)}
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
          busy=""
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
        busy="Rescanning"
        loading={run.running}
        gate={known ? undefined : "slskd's state is out of date"}
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
