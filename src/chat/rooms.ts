import { isHTTPError } from 'ky'
import { useMemo } from 'react'

import { api } from '../lib/api'
import { application, ownUsername } from '../lib/application'
import { toTime } from '../lib/format'
import { sessionSignal } from '../lib/session'
import { createAtom, createResource, createResourceMap, poll, type Resource, useAtom, useResource } from '../lib/store'
import { createStoredAtom } from '../lib/stored'
import { byUsername, compareExactly } from '../lib/text'
import { lastOpen, mentionMatcher, type Message, reuseMessages } from './messages'

export type RawRoomMessage = { timestamp: string; username: string; message: string; self?: boolean }

export type RawRoomUser = { username: string; countryCode?: string | null; fileCount: number; self?: boolean }

export type RoomUser = { username: string; country?: string; files: number; self: boolean }

type RoomMessages = { messages: readonly Message[] }

type RoomUsers = { users: readonly RoomUser[] }

export const roomPollInterval = 2000

const backgroundInterval = 10_000

const roomUsersInterval = 30_000

export const roomMessageLimit = 250

const path = (room: string) => `rooms/joined/${encodeURIComponent(room)}`

let openRoom: string | undefined

export function setOpenRoom(room: string | undefined) {
  openRoom = room
  if (room !== undefined) roomMessages(room).refresh()
}

// The newest message time seen in each room, in slskd's clock. A room seen for the first time starts from what it
// already holds, so joining a busy room doesn't count 250 messages as unread.
const roomsSeen = createStoredAtom<Readonly<Record<string, number>>>(
  'slskd-alt-rooms-seen',
  (stored) =>
    typeof stored === 'object' && stored !== null
      ? Object.fromEntries(Object.entries(stored).filter(([, time]) => Number.isFinite(time)))
      : undefined,
  {},
)

export function markSeen(room: string, time: number) {
  const seen = roomsSeen.get()[room]
  if (seen === undefined || seen < time) roomsSeen.set((current) => ({ ...current, [room]: time }))
}

type Pending = { id: number; text: string; sentAt: number; after: number; unconfirmed: boolean }

// slskd only stores our own room messages once the server echoes them, a second or so after sending.
export const pendingMessages = createAtom<ReadonlyMap<string, readonly Pending[]>>(new Map())

const echoTimeout = 10_000

let nextPending = 0

function setPending(room: string, update: (list: readonly Pending[]) => readonly Pending[]) {
  pendingMessages.set((current) => {
    const old = current.get(room) ?? []
    const list = update(old)
    if (list === old) return current
    const next = new Map(current)
    if (list.length === 0) next.delete(room)
    else next.set(room, list)
    return next
  })
}

function settlePending(room: string, messages: readonly Message[]) {
  const list = pendingMessages.get().get(room)
  if (list === undefined) return
  const used = new Set<Message>()
  const left = list.filter((pending) => {
    const echo = messages.find(
      (message) => message.self && message.text === pending.text && message.time > pending.after && !used.has(message),
    )
    if (echo === undefined) return true
    used.add(echo)
    return false
  })
  if (left.length !== list.length) setPending(room, () => left)
}

function toMessages(raws: RawRoomMessage[], previous?: readonly Message[]): RoomMessages {
  const mentions = mentionMatcher(ownUsername.get())
  const counts = new Map<string, number>()
  const messages = raws.map((raw): Message => {
    // Messages have no id, and two can share a time and a sender.
    const base = `${raw.timestamp} ${raw.username}`
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    const self = raw.self === true
    return {
      key: count === 0 ? base : `${base} ${count}`,
      time: toTime(raw.timestamp),
      username: raw.username,
      text: raw.message,
      self,
      mention: !self && mentions(raw.message),
    }
  })
  return { messages: reuseMessages(previous, messages) }
}

function received(room: string, messages: readonly Message[]) {
  if (roomsSeen.get()[room] === undefined) markSeen(room, messages.at(-1)?.time ?? 0)
  settlePending(room, messages)
}

// Every joined room is polled while the chat page is open, to show which have news, and the open one more often.
const messageResources = createResourceMap((room: string) => {
  const resource: Resource<RoomMessages> = createResource((sink) =>
    poll(
      sink,
      async (signal, measure) => {
        const text = await api.get(`${path(room)}/messages`, { signal }).text()
        const previous = resource.getSnapshot().data?.messages
        const data = measure(() => toMessages(JSON.parse(text) as RawRoomMessage[], previous))
        received(room, data.messages)
        return data
      },
      () => (room === openRoom ? roomPollInterval : backgroundInterval),
    ),
  )
  return resource
})

export const roomMessages = messageResources.get

function toUser(raw: RawRoomUser): RoomUser {
  return {
    username: raw.username,
    // Empty when the server doesn't know it.
    country: raw.countryCode || undefined,
    files: raw.fileCount,
    self: raw.self === true,
  }
}

const userResources = createResourceMap((room: string) =>
  createResource<RoomUsers>((sink) => {
    let last: { text: string; data: RoomUsers } | undefined
    return poll(
      sink,
      async (signal, measure) => {
        const text = await api.get(`${path(room)}/users`, { signal }).text()
        if (text === last?.text) return last.data
        const data = measure(() => ({ users: (JSON.parse(text) as RawRoomUser[]).map(toUser).sort(byUsername) }))
        last = { text, data }
        return data
      },
      () => (last === undefined ? roomPollInterval : roomUsersInterval),
    )
  }),
)

export const roomUsers = userResources.get

// STATE.rooms lags a leave by a few seconds, so what this tab joined or left counts until STATE agrees.
const overrides = createAtom<ReadonlyMap<string, boolean>>(new Map())

application.watch(() => {
  const rooms = application.getSnapshot().data?.rooms
  const current = overrides.get()
  if (rooms === undefined || current.size === 0) return
  const left = [...current].filter(([room, joined]) => rooms.includes(room) !== joined)
  if (left.length !== current.size) overrides.set(new Map(left))
})

// One that STATE already agrees with would linger until STATE next changes.
function setOverride(room: string, joined: boolean) {
  const agreed = application.getSnapshot().data?.rooms.includes(room) === joined
  overrides.set((current) => {
    const next = new Map(current)
    if (agreed) next.delete(room)
    else next.set(room, joined)
    return next
  })
}

// STATE lists a room being joined a moment before slskd answers for it, so this tab waits for its join to return.
const joining = createAtom<ReadonlySet<string>>(new Set())

// Rooms show from the last STATE however old, since slskd keeps them across a Soulseek disconnect.
export function useJoinedRooms() {
  const { data } = useResource(application)
  const changes = useAtom(overrides)
  const pending = useAtom(joining)
  const reported = data?.rooms
  const rooms = useMemo(() => {
    const joined = new Set(reported)
    for (const [room, isJoined] of changes) {
      if (isJoined) joined.add(room)
      else joined.delete(room)
    }
    for (const room of pending) joined.delete(room)
    return [...joined].sort(compareExactly)
  }, [reported, changes, pending])
  return { known: reported !== undefined, rooms }
}

export function useRoomNews(room: string) {
  const { data } = useResource(roomMessages(room))
  const seen = useAtom(roomsSeen)[room]
  return useMemo(() => {
    let unread = 0
    let mentions = 0
    if (seen !== undefined) {
      for (const message of data?.messages ?? []) {
        if (message.self || message.time <= seen) continue
        unread++
        if (message.mention) mentions++
      }
    }
    return { unread, mentions }
  }, [data, seen])
}

export async function joinRoom(room: string) {
  const signal = sessionSignal()
  joining.set((current) => new Set(current).add(room))
  try {
    await api.post('rooms/joined', { json: room, signal })
    if (!signal.aborted) setOverride(room, true)
  } finally {
    joining.set((current) => new Set([...current].filter((each) => each !== room)))
  }
}

export async function leaveRoom(room: string) {
  const signal = sessionSignal()
  try {
    await api.delete(path(room), { signal })
  } catch (error) {
    if (!isHTTPError(error) || error.response.status !== 404) throw error
  }
  if (signal.aborted) return
  setOverride(room, false)
  messageResources.forget(room)
  userResources.forget(room)
  setPending(room, () => [])
  roomsSeen.set((current) => Object.fromEntries(Object.entries(current).filter(([name]) => name !== room)))
  const open = lastOpen.get()
  if (open?.kind === 'room' && open.name === room) lastOpen.set(undefined)
}

export async function sendToRoom(room: string, text: string) {
  const resource = roomMessages(room)
  const after = resource.getSnapshot().data?.messages.at(-1)?.time ?? 0
  const signal = sessionSignal()
  await api.post(`${path(room)}/messages`, { json: text, signal })
  if (signal.aborted) return
  const id = nextPending++
  setPending(room, (list) => [...list, { id, text, sentAt: Date.now(), after, unconfirmed: false }])
  setTimeout(
    () =>
      !signal.aborted &&
      setPending(room, (list) =>
        list.some((each) => each.id === id)
          ? list.map((each) => (each.id === id ? { ...each, unconfirmed: true } : each))
          : list,
      ),
    echoTimeout,
  )
  resource.refresh()
}
