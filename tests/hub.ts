import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr'

import type { Instance } from './slskd'

export type Hub = {
  received: <T>(method: string) => T[]
  stop: () => Promise<void>
}

// Records every call to the given methods from the moment it connects, since hubs send their snapshot on connect.
export async function openHub(instance: Instance, name: string, token: string | undefined, methods: string[]) {
  const calls = new Map<string, unknown[]>(methods.map((method) => [method, []]))
  const connection = new HubConnectionBuilder()
    .withUrl(`${instance.base}/hub/${name}`, { accessTokenFactory: () => token ?? '' })
    .configureLogging(LogLevel.None)
    .build()
  for (const [method, list] of calls) connection.on(method, (payload: unknown) => list.push(payload))
  await connection.start()
  return {
    received: <T>(method: string) => (calls.get(method) ?? []) as T[],
    stop: () => connection.stop(),
  } satisfies Hub
}
