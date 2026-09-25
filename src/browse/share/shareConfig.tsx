import { Link as RouterLink } from '@tanstack/react-router'

import { useAtom } from '../../lib/store'
import { filesUnder, type Item, type TreeFile } from '../../lib/tree'
import { DownloadButton } from '../../transfers/DownloadButton'
import { MarkBadge } from '../../transfers/MarkBadge'
import { OutcomeLine } from '../../ui/controls'
import { audioColumns } from '../../ui/tree/columns'
import type { FolderLinkProps, Selection, TreeConfig } from '../../ui/tree/FolderPane'
import type { FileBadge } from '../../ui/tree/ItemList'
import { downloadFiles, shareDownloadsOf } from '../browse'

function BrowseFolderLink({ path, ...props }: FolderLinkProps) {
  return <RouterLink {...props} from="/browse" to="/browse" search={(previous) => ({ ...previous, path })} />
}

const selectable = (item: Item) => (item.kind === 'folder' ? item.fileCount > item.lockedCount : !item.locked)

function DownloadAction({ username, selection }: { username: string; selection: Selection }) {
  const { tree, folder, items, clear } = selection
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
      onClick={() =>
        void downloadFiles(
          username,
          tree,
          folder,
          items.flatMap((item) => (item.kind === 'folder' ? filesUnder(item) : [item])),
        ).then(clear)
      }
    />
  )
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
  scope: 'this share',
  extras: audioColumns,
  FolderLink: BrowseFolderLink,
  selectable,
  actions: (selection) => <DownloadAction username={username} selection={selection} />,
  status: <OutcomeLine atom={shareDownloadsOf(username)} />,
  Badge: downloadBadge(username),
})
