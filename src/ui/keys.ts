import { formatForDisplay, getSequenceManager, type Hotkey, useHotkeys } from '@tanstack/react-hotkeys'
import type { RefObject } from 'react'

// Symbols for arrows and modifiers, and names for keys whose symbols few keyboards print.
const keyLabels = { Enter: 'Enter', Delete: 'Delete', Space: 'Space', Tab: 'Tab' }

export const displayKey = (hotkey: string) => formatForDisplay(hotkey, { keyLabels })

export type ListKey = { hotkeys: Hotkey[]; name: string; run: () => void; enabled?: boolean }

// The second key of a g sequence, such as the d of g d, isn't a list's key too.
function inSequence() {
  const now = Date.now()
  for (const each of getSequenceManager().registrations.state.values()) {
    if (each.matchedStepCount > 0 && now - each.partialMatchLastKeyTime <= (each.options.timeout ?? 1000)) return true
  }
  return false
}

// Keys that act on a list's selection, or on the row the keyboard is on, so they only work while focus is in the list.
export function useListKeys(target: RefObject<HTMLElement | null>, keys: readonly ListKey[]) {
  useHotkeys(
    keys.flatMap(({ hotkeys, name, run, enabled }) =>
      hotkeys.map((hotkey) => ({
        hotkey,
        callback: () => {
          if (!inSequence()) run()
        },
        options: { enabled: enabled ?? true, meta: { name, group: 'list' } },
      })),
    ),
    { target },
  )
}

// Where the keyboard is when a key fires somewhere it shouldn't act, such as in an open menu or dialog.
export const inOverlay = (event: KeyboardEvent) =>
  event.target instanceof Element && event.target.closest('[role=dialog], [role=alertdialog], [role=menu]') !== null
