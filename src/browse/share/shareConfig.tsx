import type { ComponentType } from 'react'

import { useAtom } from '../../lib/store'
import { filesUnder, type Item, type TreeFile } from '../../lib/tree'
import { useSoulseekGate } from '../../soulseek/soulseek'
import { DownloadButton } from '../../transfers/DownloadButton'
import { MarkBadge } from '../../transfers/MarkBadge'
import { OutcomeLine } from '../../ui/controls'
import { useListKeys } from '../../ui/keys'
import { audioColumns } from '../../ui/tree/columns'
import type { Selection, TreeConfig } from '../../ui/tree/FolderPane'
import type { FileBadge } from '../../ui/tree/ItemList'
import type { KeysProps } from '../../ui/tree/keys'
import { downloadFiles, shareDownloadsOf } from '../browse'

const selectable = (item: Item) => (item.kind === 'folder' ? item.fileCount > item.lockedCount : !item.locked)

const filesOf = (items: readonly Item[]) =>
  items.flatMap((item) => (item.kind === 'folder' ? filesUnder(item) : item.locked ? [] : [item]))

const download = (username: string, { tree, folder, items, clear }: Selection) =>
  void downloadFiles(username, tree, folder, filesOf(items)).then(clear)

function DownloadAction({ username, selection }: { username: string; selection: Selection }) {
  const { items } = selection
  let count = 0
  let size = 0
  for (const item of items) {
    count += item.kind === 'folder' ? item.fileCount - item.lockedCount : 1
    size += item.kind === 'folder' ? item.size - item.lockedSize : item.size
  }
  return (
    <DownloadButton
      downloads={shareDownloadsOf(username)}
      count={count}
      size={size}
      onClick={() => download(username, selection)}
    />
  )
}

// D downloads the pane's selection or the row the keyboard is on. In the tree, that's the folder with all it holds,
// kept under its own name as if it had been opened and all of it selected.
const downloadKeys = new Map<string, ComponentType<KeysProps>>()

function downloadKey(username: string) {
  let keys = downloadKeys.get(username)
  if (keys === undefined) {
    keys = function DownloadKey({ target, selection }: KeysProps) {
      const gate = useSoulseekGate()
      const { running } = useAtom(shareDownloadsOf(username))
      useListKeys(target, [
        {
          hotkeys: ['D'],
          name: 'Download',
          enabled: gate === undefined && running.download === undefined,
          run: () => {
            const chosen = selection()
            if (chosen !== undefined && filesOf(chosen.items).length > 0) download(username, chosen)
          },
        },
      ])
      return null
    }
    downloadKeys.set(username, keys)
  }
  return keys
}

const badges = new Map<string, FileBadge>()

function downloadBadge(username: string) {
  let badge = badges.get(username)
  if (badge === undefined) {
    badge = function DownloadBadge({ file }: { file: TreeFile }) {
      const { pending, marks } = useAtom(shareDownloadsOf(username))
      return <MarkBadge mark={marks.get(file.id)} pending={pending.has(file.id)} />
    }
    badges.set(username, badge)
  }
  return badge
}

export const shareConfig = (username: string): TreeConfig => ({
  page: '/browse',
  scope: 'this share',
  extras: audioColumns,
  selectable,
  actions: (selection) => <DownloadAction username={username} selection={selection} />,
  status: <OutcomeLine atom={shareDownloadsOf(username)} />,
  Badge: downloadBadge(username),
  Keys: downloadKey(username),
})
