import { expect, logInPage, test } from '../fixtures'

test.use({ failedRequests: true })

test('a restart ends the session, and logging in again returns to the same page', async ({ page }) => {
  await page.goto('system/info')
  await logInPage(page)
  await page.getByRole('button', { name: 'Restart' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restart' }).click()
  await expect(page.getByText('Your session ended. Log in again.')).toBeVisible({ timeout: 30_000 })
  await logInPage(page)
  await expect(page).toHaveURL(/\/slskd\/system\/info$/)
  // By now the hubs retry every 5 s, and logging in doesn't hurry the next attempt.
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 10_000 })
})
