import { type APIRequestContext, test as base, expect, type Page, request } from '@playwright/test'

import type { RawState } from '../src/system/application'
import type { RawTransfer, RawUser } from '../src/transfers/transfers'
import { type Config, credentials, type Instance, logIn, start, startAgent } from './slskd'
import { type Network, type Peer, startLoggedIn, startNetwork, uploadsEnded } from './soulseek'

type TestFixtures = {
  // Which instance a test runs against. Instances are started on first use and kept for the rest of the worker, so
  // tests don't assume one is fresh. With `soulseek`, it's logged in to the worker's network. With `agent`, it's a relay
  // agent, with its controller.
  config: Partial<Config> & { soulseek?: boolean; agent?: boolean }
  slskd: Instance
  token: string | undefined
  api: APIRequestContext
  // The network's peers. Downloads a test leaves unfinished are cancelled after it, which frees the slow peer's slot.
  peers: { fast: Peer; slow: Peer }
  // Whether a page may log failed requests, as it does while slskd restarts and after, until its token is dropped.
  failedRequests: boolean
}

type WorkerFixtures = {
  pool: Map<string, Promise<Instance>>
  // Started on first use: Soulfind and two peers logged in to it. Each worker has its own, since a search goes to
  // everyone on the server.
  network: () => Promise<Network>
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  config: [{}, { option: true }],
  network: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from the destructuring
    async ({}, use) => {
      let network: Promise<Network> | undefined
      await use(() => (network ??= startNetwork()))
      await network?.then(
        (started) => started.stop(),
        () => {},
      )
    },
    { scope: 'worker' },
  ],
  pool: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from the destructuring
    async ({}, use) => {
      const pool = new Map<string, Promise<Instance>>()
      await use(pool)
      await Promise.all(
        [...pool.values()].map((instance) =>
          instance.then(
            (started) => started.stop(),
            () => {},
          ),
        ),
      )
    },
    { scope: 'worker' },
  ],
  slskd: [
    async ({ pool, network, config }, use, testInfo) => {
      const key = JSON.stringify(config)
      let instance = pool.get(key)
      if (instance === undefined) {
        const { soulseek, agent, ...overrides } = config
        const username = `user.${pool.size} test`
        if (agent) instance = startAgent(overrides)
        else if (soulseek) instance = network().then((started) => startLoggedIn(started, overrides, username))
        else instance = start(overrides)
        pool.set(key, instance)
      }
      const started = await instance
      await use(started)
      if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach('slskd.log', { path: started.log })
    },
    { timeout: 60_000 },
  ],
  token: async ({ slskd }, use) => use(slskd.config.auth ? await logIn(slskd) : undefined),
  api: async ({ playwright, slskd, token }, use) => {
    const context = await playwright.request.newContext({
      baseURL: `${slskd.api}/`,
      extraHTTPHeaders: token === undefined ? {} : { Authorization: `Bearer ${token}` },
    })
    await use(context)
    await context.dispose()
  },
  peers: [
    async ({ network, api }, use, testInfo) => {
      const { fast, slow } = await network()
      await use({ fast, slow })
      let failure: unknown
      try {
        const me = await ownName(api)
        const unfinished = async () =>
          ((await (await api.get('transfers/downloads')).json()) as RawUser[]).flatMap(({ username, directories }) =>
            directories
              .flatMap((directory) => directory.files)
              .filter((file) => !file.state.startsWith('Completed'))
              .map((file) => ({ username, file })),
          )
        // Downloads from the fast peer finish on their own. Those from the slow peer are cancelled only once one is in
        // progress and the rest are queued behind it, since cancelling one while it's being requested or started
        // leaves the peer waiting out its transfer timeout, and one queued while the slot is free starts at once. The
        // queued ones go first, since cancelling the running one lets the next one start.
        const settled = ({ username, file }: { username: string; file: RawTransfer }) =>
          username === slow.username && /Remotely|InProgress/.test(file.state)
        await expect
          .poll(
            async () => {
              const left = await unfinished()
              return left.every(settled) && (left.length === 0 || left.some(({ file }) => file.state === 'InProgress'))
            },
            { timeout: 10_000 },
          )
          .toBe(true)
        const byRunning = (await unfinished()).sort(
          (a, b) => Number(a.file.state === 'InProgress') - Number(b.file.state === 'InProgress'),
        )
        for (const { username, file } of byRunning) {
          await api.delete(`transfers/downloads/${encodeURIComponent(username)}/${file.id}`)
        }
        await Promise.all([fast, slow].map((peer) => uploadsEnded(peer, me)))
      } catch (error) {
        failure = error
      }
      if (failure !== undefined || testInfo.status !== testInfo.expectedStatus) {
        for (const [name, peer] of Object.entries({ fast, slow })) {
          await testInfo.attach(`${name} peer.log`, { path: peer.instance.log })
        }
      }
      if (failure !== undefined) throw failure
    },
    { timeout: 60_000 },
  ],
  baseURL: async ({ slskd }, use) => use(`${slskd.base}/`),
  failedRequests: [false, { option: true }],
  page: async ({ page, failedRequests }, use) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      if (failedRequests && /^(Failed to load resource|WebSocket connection)/.test(message.text())) return
      errors.push(message.text())
    })
    await use(page)
    expect(errors).toEqual([])
  },
})

export { expect }

// slskd takes these bodies as a bare JSON string, which Playwright would otherwise send as it is.
export const jsonString = (text: string) => ({
  data: JSON.stringify(text),
  headers: { 'Content-Type': 'application/json' },
})

export const ownName = async (api: APIRequestContext) =>
  ((await (await api.get('application')).json()) as RawState).user.username!

// A request context for an instance other than the test's own, such as a peer.
export async function contextFor(instance: Instance) {
  const token = await logIn(instance)
  return request.newContext({ baseURL: `${instance.api}/`, extraHTTPHeaders: { Authorization: `Bearer ${token}` } })
}

export async function logInPage(page: Page) {
  await page.getByLabel('Username').fill(credentials.username)
  await page.getByLabel('Password').fill(credentials.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('button', { name: 'Log in' })).toBeHidden()
}
