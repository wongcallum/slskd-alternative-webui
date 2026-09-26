import { expect, logInPage, test } from '../fixtures'

test.use({ config: { soulseek: true } })

test("looking up a user shows whether they're online, their description and their picture", async ({
  page,
  peers: { fast },
}) => {
  await page.goto('users')
  await logInPage(page)
  await page.getByRole('textbox', { name: 'Username' }).fill(fast.username)
  await page.getByRole('button', { name: 'Look up' }).click()
  await expect(page.getByRole('heading', { name: fast.username })).toBeVisible()
  await expect(page.getByText('Online')).toBeVisible()
  await expect(page.getByText('A slskd user.')).toBeVisible()
  const picture = page.getByRole('button', { name: `Show ${fast.username}'s picture full size` }).locator('img')
  await expect(picture).toBeVisible()
  await expect.poll(() => picture.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(16)
})
