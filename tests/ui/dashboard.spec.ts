import { randomUUID } from 'node:crypto'

import type { APIRequestContext } from '@playwright/test'

import type { RawUser } from '../../src/transfers/transfers'
import { contextFor, expect, logInPage, test } from '../fixtures'
import { type Peer, startLoggedIn, uploadsEnded } from '../soulseek'

const file = (peer: Peer, filename: string) => ({ filename, size: peer.files.get(filename)!.length })

async function downloads(api: APIRequestContext, username?: string) {
  const users = (await (await api.get('transfers/downloads')).json()) as RawUser[]
  return users
    .filter((user) => username === undefined || user.username === username)
    .flatMap(({ directories }) => directories.flatMap((directory) => directory.files))
}

const states = async (api: APIRequestContext) => (await downloads(api)).map((f) => f.state)

// A fresh instance, so the figures are only this test's: one success, one failure and one cancellation, which counts
// as neither.
test('the dashboard totals finished downloads and lists who they came from', async ({ page, network }) => {
  test.setTimeout(90_000)
  const { fast, slow } = await network()
  const username = `dashboard.${randomUUID().slice(0, 8)} test`
  const instance = await startLoggedIn(await network(), {}, username)
  const api = await contextFor(instance)
  try {
    await api.post('transfers/downloads/batches', {
      data: {
        username: fast.username,
        files: [
          file(fast, 'Music\\Artist - Album\\01 Intro.flac'),
          { filename: 'Music\\Nowhere\\missing.flac', size: 1 },
        ],
      },
    })
    await api.post('transfers/downloads/batches', {
      data: { username: slow.username, files: [file(slow, 'Slow\\Big 1.flac')] },
    })
    // Cancelled before it's running, a download can end as errored instead.
    await expect
      .poll(async () => (await downloads(api, slow.username))[0]?.state, { timeout: 30_000 })
      .toBe('InProgress')
    const [running] = await downloads(api, slow.username)
    await api.delete(`transfers/downloads/${encodeURIComponent(slow.username)}/${running!.id}`)
    await expect
      .poll(async () => (await states(api)).sort(), { timeout: 30_000 })
      .toEqual(['Completed, Cancelled', 'Completed, Rejected', 'Completed, Succeeded'])
    await uploadsEnded(slow, username)

    await page.goto(`${instance.base}/`)
    await logInPage(page)
    await expect(page).toHaveURL(/\/slskd\/dashboard$/)
    await expect(page.getByText('1 file from 1 user')).toBeVisible()
    await expect(page.getByText('1 failed (50%)')).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Downloaded from' }).getByRole('button', { name: fast.username }),
    ).toBeVisible()

    await page.getByRole('radio', { name: 'All' }).click()
    await expect(page).toHaveURL(/\/slskd\/dashboard\?range=all$/)
    await expect(page.getByRole('heading', { name: 'By month' })).toBeVisible()
    await expect(page.getByText('1 file from 1 user')).toBeVisible()
  } finally {
    // Before its hubs lose slskd.
    await page.goto('about:blank')
    await api.dispose()
    await instance.stop()
  }
})
