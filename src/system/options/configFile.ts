import { isHTTPError } from 'ky'

import { api, describeError, readsOptions } from '../../lib/api'
import { sessionSignal } from '../../lib/session'
import { createAtom, createResource, load } from '../../lib/store'

export type ConfigFile = {
  location?: string
  // The file as it was last read or saved, which a save expects to still be on disk.
  base?: string
  readAt?: number
  reading: boolean
  readError?: unknown
  // Only while it differs from base. It's never persisted, since it holds the Soulseek password.
  draft?: string
  // What's on disk, when that isn't base.
  conflict?: string
  saving: boolean
  saveMessage?: string
  saved: boolean
}

export const configFile = createAtom<ConfigFile>({ reading: false, saving: false, saved: false })

const readText = (path: string, signal: AbortSignal) => readsOptions(() => api.get(path, { signal }).json<string>())

// A draft is never replaced by what's read. A file that changed under it is a conflict to resolve. Nothing is read
// during a save, which leaves the file as read.
export async function readFile() {
  if (configFile.get().reading || configFile.get().saving) return
  const signal = sessionSignal()
  configFile.set((state) => ({ ...state, reading: true, readError: undefined }))
  try {
    const known = configFile.get().location
    const [text, location] = await Promise.all([
      readText('options/yaml', signal),
      known ?? readText('options/yaml/location', signal),
    ])
    if (signal.aborted) return
    configFile.set((state) => {
      const read = { ...state, reading: false, location, readAt: Date.now() }
      if (state.draft === undefined) return { ...read, base: text, conflict: undefined }
      return { ...read, conflict: text === state.base ? undefined : text }
    })
  } catch (error) {
    if (!signal.aborted) configFile.set((state) => ({ ...state, reading: false, readError: error }))
  }
}

export function edit(text: string) {
  configFile.set((state) => ({ ...state, draft: text === state.base ? undefined : text, saved: false }))
}

export function discard() {
  if (configFile.get().saving) return
  configFile.set((state) => ({ ...state, draft: undefined, conflict: undefined, saveMessage: undefined }))
  void readFile()
}

// slskd answers a rejected file with its validator's message.
function describeSaveError(error: unknown) {
  if (isHTTPError(error) && error.response.status === 400 && typeof error.data === 'string') return error.data
  return describeError(error)
}

export async function save({ overwrite = false } = {}) {
  const { draft, base, saving } = configFile.get()
  if (draft === undefined || saving) return
  const signal = sessionSignal()
  configFile.set((state) => ({ ...state, saving: true, saveMessage: undefined, saved: false }))
  try {
    if (!overwrite) {
      const disk = await readText('options/yaml', signal)
      if (disk !== base) {
        if (!signal.aborted)
          configFile.set((state) => ({ ...state, saving: false, conflict: disk, readAt: Date.now() }))
        return
      }
    }
    await readsOptions(() => api.put('options/yaml', { json: draft, signal }))
    if (signal.aborted) return
    configFile.set((state) => ({
      ...state,
      saving: false,
      base: draft,
      draft: state.draft === draft ? undefined : state.draft,
      conflict: undefined,
      readAt: Date.now(),
      saved: true,
    }))
  } catch (error) {
    if (!signal.aborted) configFile.set((state) => ({ ...state, saving: false, saveMessage: describeSaveError(error) }))
  }
}

const warn = (event: BeforeUnloadEvent) => event.preventDefault()

let warning = false

// A reload or closing the tab is the one way to lose a draft, which otherwise survives leaving the page.
configFile.subscribe(() => {
  const dirty = configFile.get().draft !== undefined
  if (dirty === warning) return
  warning = dirty
  if (dirty) window.addEventListener('beforeunload', warn)
  else window.removeEventListener('beforeunload', warn)
})

// Answers 200 either way: an empty body when valid, and the validator's message when not.
export async function validate(text: string, signal: AbortSignal) {
  const body = await readsOptions(async () => (await api.post('options/yaml/validate', { json: text, signal })).text())
  return body === '' ? undefined : (JSON.parse(body) as string)
}

export const sourcesLoading = createAtom(false)

export const sources = createResource<{ text: string; fetchedAt: number }>((sink) =>
  load(sink, async (signal) => ({ text: await readText('options/debug', signal), fetchedAt: Date.now() }), {
    loading: sourcesLoading,
  }),
)
