import type { RouterHistory } from '@tanstack/react-router'
import { tabbable } from 'tabbable'

// The lists on screen, each under a name that's unique on its page. A page's main list has a rank, and the highest
// takes focus when nothing else has it.
type List = { rank: number; focus: () => boolean }

const lists = new Map<string, List>()

let lastList: string | undefined

// A navigation that lost focus before its page's list had rendered leaves it to the list, unless the user acts first.
let pending: { fallback?: Element } | undefined

export const isFocusLost = () => document.activeElement === null || document.activeElement === document.body

const touch = () => matchMedia('(hover: none)').matches

function best() {
  let found: List | undefined
  for (const list of lists.values()) if (list.rank > 0 && (found === undefined || list.rank > found.rank)) found = list
  return found
}

export function registerList(name: string, list: List) {
  lists.set(name, list)
  claimFocus(name)
  return () => {
    if (lists.get(name) === list) lists.delete(name)
  }
}

// A list whose rows arrive after the navigation that lost focus.
export function claimFocus(name: string) {
  const list = lists.get(name)
  if (pending === undefined || list === undefined || (name !== lastList && list !== best())) return
  if ((isFocusLost() || document.activeElement === pending.fallback) && list.focus()) pending = undefined
}

export function noteListFocus(name: string) {
  lastList = name
  pending = undefined
}

export const focusList = (name?: string) => (name === undefined ? best() : lists.get(name))?.focus() ?? false

// The list the keyboard was last in, or else the page's main list.
export const returnToList = () => (lastList !== undefined && lists.get(lastList)?.focus()) || focusList()

let watcher: MutationObserver | undefined

export const cancelPendingFocus = () => {
  pending = undefined
  watcher?.disconnect()
}

// A text field would take the keys meant for the page, and typing isn't what a navigation leads to.
const textField = 'input:not([type=button], [type=submit], [type=reset]), textarea, select, [contenteditable]'

function focusFirst(page: Element) {
  const first = tabbable(page).find((element) => !element.matches(textField))
  first?.focus()
  return first
}

// After a navigation that took the focused element away: the list that had focus, or the page's main list, or the
// first control on the page, once there is one. A field that focuses itself on mount has already taken it.
export function recoverFocus() {
  if (!isFocusLost() || touch()) return
  if (lastList !== undefined && lists.get(lastList)?.focus()) return
  if (best()?.focus()) return
  const page = document.querySelector('main')
  if (page === null) return
  const found = { fallback: focusFirst(page) }
  pending = found
  if (found.fallback !== undefined) return
  watcher?.disconnect()
  watcher = new MutationObserver(() => {
    if (pending === found && isFocusLost()) found.fallback = focusFirst(page)
    if (pending !== found || found.fallback !== undefined) watcher?.disconnect()
  })
  watcher.observe(page, { childList: true, subtree: true })
}

// Where the keyboard was in each list, per history entry, so Back returns to it. Entries after a new one are
// discarded, as the browser discards them.
type Spot = { key: string; index: number }

const spots = new Map<number, Map<string, Spot>>()

let entry = 0

const indexOf = (location: RouterHistory['location']) => location.state['__TSR_index']

export function trackHistory(history: RouterHistory) {
  entry = indexOf(history.location)
  history.subscribe(({ location, action }) => {
    entry = indexOf(location)
    if (action.type !== 'PUSH') return
    for (const index of spots.keys()) if (index >= entry) spots.delete(index)
  })
}

export function remember(list: string, spot: Spot) {
  let entrySpots = spots.get(entry)
  if (entrySpots === undefined) spots.set(entry, (entrySpots = new Map()))
  entrySpots.set(list, spot)
}

export const recall = (list: string) => spots.get(entry)?.get(list)

// A row that a list opening next should start on, such as the folder that was just left for its parent.
const intents = new Map<string, string>()

export const intendFocus = (list: string, key: string) => intents.set(list, key)

export const peekIntent = (list: string) => intents.get(list)

export const clearIntent = (list: string) => intents.delete(list)
