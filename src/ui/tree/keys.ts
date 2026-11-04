import type { RefObject } from 'react'

import type { Folder, Item, Tree } from '../../lib/tree'
import type { ListKey } from '../keys'

export type Selection = { tree: Tree; folder: Folder; items: Item[]; clear: () => void }

// A view's own keys for the tree and the folder pane, such as Browse's download. The selection is the pane's, or
// else the row the keyboard is on.
export type KeysProps = { target: RefObject<HTMLElement | null>; tree: boolean; selection: () => Selection | undefined }

export const upKeys = (run: () => void): ListKey[] => [
  { hotkeys: ['Backspace', 'Alt+ArrowUp', 'Mod+ArrowUp'], name: 'Open the folder above', run },
]
