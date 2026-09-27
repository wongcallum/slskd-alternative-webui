import type { RefObject } from 'react'

import type { ListKey } from '../keys'
import type { Selection } from './FolderPane'

// A view's own keys for the tree and the folder pane, such as Browse's download. The selection is the pane's, or
// else the row the keyboard is on.
export type KeysProps = { target: RefObject<HTMLElement | null>; tree: boolean; selection: () => Selection | undefined }

export const upKeys = (run: () => void): ListKey[] => [
  { hotkeys: ['Backspace', 'Alt+ArrowUp', 'Mod+ArrowUp'], name: 'Open the folder above', run },
]
