import { isHTTPError } from 'ky'

import { api } from '../lib/api'
import { createResource, createResourceMap, poll, type Resource } from '../lib/store'
import { compareExactly } from '../lib/text'
import { application } from '../system/application'
import { lastOpen, type Message, reuseMessages } from './messages'

type RawConversation = { username: string; unAcknowledgedMessageCount: number }

type RawPrivateMessage = {
  timestamp: string
  id: number
  username: string
  direction: 'In' | 'Out'
  message: string
  isAcknowledged: boolean
}

export type Conversation = { username: string; unread: number }

type Conversations = { list: readonly Conversation[]; unread: number }

// The key of the first message that was unread when the conversation opened.
type ConversationMessages = { messages: readonly Message[]; newFrom?: string }

const conversationListInterval = 10_000

export const conversationPollInterval = 2000

export const conversationMessageLimit = 100

const path = (username: string) => `conversations/${encodeURIComponent(username)}`

const byUsername = (a: Conversation, b: Conversation) => compareExactly(a.username, b.username)

// Polled wherever the app is open, for the unread count in the nav and the title, which shows in a hidden tab too.
export const conversations = createResource<Conversations>((sink) => {
  let last: { text: string; data: Conversations } | undefined
  return poll(
    sink,
    async (signal, measure) => {
      const text = await api.get('conversations', { signal }).text()
      if (text === last?.text) return last.data
      const data = measure(() => {
        const list = (JSON.parse(text) as RawConversation[])
          .map((raw) => ({ username: raw.username, unread: raw.unAcknowledgedMessageCount }))
          .sort(byUsername)
        return { list, unread: list.reduce((sum, each) => sum + each.unread, 0) }
      })
      last = { text, data }
      return data
    },
    conversationListInterval,
    { whileHidden: true },
  )
})

function toMessage(raw: RawPrivateMessage): Message {
  const self = raw.direction === 'Out'
  return {
    // Every sent message has id 0.
    key: `${raw.direction} ${raw.id} ${raw.timestamp}`,
    time: Date.parse(raw.timestamp),
    // A sent message's username is the other party's.
    username: self ? '' : raw.username,
    text: raw.message,
    self,
    mention: false,
  }
}

// Acknowledging tells the server to stop delivering a message again at every login; the sender never learns of it.
// It's done only while the conversation is on screen, so never in a hidden tab, whose poll pauses too.
async function acknowledge(username: string, signal: AbortSignal) {
  if (document.hidden || application.getSnapshot().data?.isLoggedIn !== true) return
  try {
    await api.put(path(username), { signal })
    conversations.refresh()
  } catch {
    // The next poll tries again.
  }
}

const messageResources = createResourceMap((username) => {
  const resource: Resource<ConversationMessages> = createResource((sink) => {
    let first = true
    let newFrom: string | undefined
    return poll(
      sink,
      async (signal, measure) => {
        let text = '[]'
        try {
          text = await api.get(`${path(username)}/messages`, { signal }).text()
        } catch (error) {
          // Nothing has been sent or received yet.
          if (!isHTTPError(error) || error.response.status !== 404) throw error
        }
        const previous = resource.getSnapshot().data
        const raws = measure(() => JSON.parse(text) as RawPrivateMessage[])
        const unread = raws.filter((raw) => raw.direction === 'In' && !raw.isAcknowledged)
        if (first) {
          first = false
          const oldest = unread[0]
          newFrom = oldest === undefined ? undefined : toMessage(oldest).key
        }
        if (unread.length > 0) await acknowledge(username, signal)
        const messages = measure(() => reuseMessages(previous?.messages, raws.map(toMessage)))
        return { messages, newFrom }
      },
      conversationPollInterval,
    )
  })
  return resource
})

export const conversationMessages = messageResources.get

export async function sendMessage(username: string, text: string) {
  const response = await api.post(path(username), { json: text })
  if (response.status === 200) throw new Error(`slskd didn't send it, because ${username} is blacklisted`)
  conversationMessages(username).refresh()
  conversations.refresh()
}

// Closing keeps the history, and a new message reopens the conversation.
export async function closeConversation(username: string) {
  await api.delete(path(username))
  conversations.refresh()
  const open = lastOpen.get()
  if (open?.kind === 'user' && open.name === username) lastOpen.set(undefined)
}
