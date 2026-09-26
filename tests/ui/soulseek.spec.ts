import { randomUUID } from 'node:crypto'

import { expect, jsonString, logInPage, test } from '../fixtures'
import { startLoggedIn } from '../soulseek'

test('connecting without a Soulseek login shows when it retries, until stopped', async ({ page, api }) => {
  await page.goto('searches')
  await logInPage(page)
  try {
    await page.getByRole('button', { name: 'Disconnected' }).click()
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Retrying at \d/ })).toBeVisible()
    await page.getByRole('button', { name: 'Stop trying' }).click()
    await expect(page.getByRole('button', { name: 'Disconnected' })).toBeVisible()
  } finally {
    await api.delete('server', jsonString('stopped by a test'))
  }
})

test('the Soulseek menu disconnects, and connects again', async ({ page, network }) => {
  test.setTimeout(90_000)
  const instance = await startLoggedIn(await network(), {}, `menu.${randomUUID().slice(0, 8)} test`)
  try {
    await page.goto(`${instance.base}/searches`)
    await logInPage(page)
    await page.getByRole('button', { name: /^Connected as / }).click()
    await page.getByRole('button', { name: 'Disconnect' }).click()
    await expect(page.getByRole('button', { name: 'Disconnected' })).toBeVisible()
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Connected as / })).toBeVisible({ timeout: 15_000 })
  } finally {
    // Before its hubs lose slskd.
    await page.goto('about:blank')
    await instance.stop()
  }
})
