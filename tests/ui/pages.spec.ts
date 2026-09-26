import { expect, logInPage, test } from '../fixtures'

const pages = {
  searches: 'Search',
  downloads: 'Downloads',
  uploads: 'Uploads',
  browse: 'Browse',
  users: 'Users',
  rooms: 'Chat',
  chat: 'Chat',
  'system/info': 'Info – System',
  'system/options': 'Options – System',
  'system/shares': 'Shares – System',
  'system/files': 'Files – System',
  'system/events': 'Events – System',
  'system/logs': 'Logs – System',
}

// Pages following a hub show Live while it's connected.
const live = new Set(['searches', 'system/info', 'system/options', 'system/shares', 'system/logs'])

test('logging in at a deep link stays on its page', async ({ page }) => {
  await page.goto('system/files')
  await logInPage(page)
  await expect(page).toHaveURL(/\/slskd\/system\/files$/)
  await expect(page.getByText('Ünïcødé')).toBeVisible()
})

test('every page renders from a deep link', async ({ page }) => {
  await page.goto('')
  await logInPage(page)
  await expect(page).toHaveURL(/\/slskd\/searches$/)
  for (const [path, title] of Object.entries(pages)) {
    await page.goto(path)
    await expect(page).toHaveTitle(`${title} – slskd`)
    if (live.has(path)) await expect(page.getByText('Live', { exact: true })).toBeVisible()
    await expect(page.getByText('This page crashed')).toHaveCount(0)
  }
})

test.describe('at the root without auth', () => {
  test.use({ config: { urlBase: '/', auth: false } })

  test('the app opens without a login', async ({ page, slskd }) => {
    await page.goto('')
    await expect(page).toHaveURL(`${slskd.base}/searches`)
    await expect(page.getByText('Live', { exact: true })).toBeVisible()
    await page.goto('system/info')
    await expect(page.getByText('Live', { exact: true })).toBeVisible()
  })
})
