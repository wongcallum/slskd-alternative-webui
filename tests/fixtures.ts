import { type APIRequestContext, test as base, expect, type Page } from '@playwright/test'

import { type Config, credentials, type Instance, logIn, start } from './slskd'

type TestFixtures = {
  // Which instance a test runs against. Instances are started on first use and kept for the rest of the worker, so
  // tests don't assume one is fresh.
  config: Partial<Config>
  slskd: Instance
  token: string | undefined
  api: APIRequestContext
}

type WorkerFixtures = { pool: Map<string, Promise<Instance>> }

export const test = base.extend<TestFixtures, WorkerFixtures>({
  config: [{}, { option: true }],
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
    async ({ pool, config }, use) => {
      const key = JSON.stringify(config)
      let instance = pool.get(key)
      if (instance === undefined) pool.set(key, (instance = start(config)))
      await use(await instance)
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
  baseURL: async ({ slskd }, use) => use(`${slskd.base}/`),
})

export { expect }

// slskd takes these bodies as a bare JSON string, which Playwright would otherwise send as it is.
export const jsonString = (text: string) => ({
  data: JSON.stringify(text),
  headers: { 'Content-Type': 'application/json' },
})

export async function logInPage(page: Page) {
  await page.getByLabel('Username').fill(credentials.username)
  await page.getByLabel('Password').fill(credentials.password)
  await page.getByRole('button', { name: 'Log in' }).click()
}
