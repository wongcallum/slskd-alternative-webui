import { randomUUID } from 'node:crypto'

import { expect, jsonString, logInPage, test } from '../fixtures'
import { sleep } from '../slskd'
import { startLoggedIn } from '../soulseek'

test('connecting without a Soulseek login shows when it retries and why, until stopped', async ({ page, api }) => {
  await page.goto('searches')
  await logInPage(page)
  try {
    await page.getByRole('button', { name: 'Disconnected' }).click()
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Retrying at \d/ })).toBeVisible()
    await expect(page.getByText(/^Username may not be null or an empty string/)).toBeVisible()
    await page.getByRole('button', { name: 'Stop trying' }).click()
    await expect(page.getByRole('button', { name: 'Disconnected' })).toBeVisible()
    await expect(page.getByText(/^Username may not be null/)).toBeHidden()
  } finally {
    await api.delete('server', jsonString('stopped by a test'))
  }
})

test('the Soulseek menu disconnects for good, and connects again', async ({ page, network }) => {
  test.setTimeout(90_000)
  const instance = await startLoggedIn(await network(), {}, `menu.${randomUUID().slice(0, 8)} test`)
  try {
    await page.goto(`${instance.base}/searches`)
    await logInPage(page)
    await page.getByRole('button', { name: /^Connected as / }).click()
    await page.getByRole('button', { name: 'Disconnect' }).click()
    await expect(page.getByRole('button', { name: 'Disconnected' })).toBeVisible()
    // slskd's watchdog would try again within a second or two if it took this for a lost connection.
    await sleep(3000)
    await expect(page.getByRole('button', { name: 'Disconnected' })).toBeVisible()
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Connected as / })).toBeVisible({ timeout: 15_000 })
  } finally {
    // Before its hubs lose slskd.
    await page.goto('about:blank')
    await instance.stop()
  }
})
