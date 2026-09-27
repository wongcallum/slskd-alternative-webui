import type { RawUser } from '../../src/transfers/transfers'
import { expect, logInPage, test } from '../fixtures'

test.use({ config: { soulseek: true } })

const count = (value: number, noun: string) => `${value.toLocaleString()} ${value === 1 ? noun : `${noun}s`}`

// The worker's other tests may have finished downloads too, so the totals are counted from the list, removed ones
// included, as the reports count them.
test('the dashboard totals finished downloads and lists who they came from', async ({ page, api, peers: { fast } }) => {
  await api.post('transfers/downloads/batches', {
    data: {
      username: fast.username,
      files: [
        {
          filename: 'Music\\Artist - Album\\01 Intro.flac',
          size: fast.files.get('Music\\Artist - Album\\01 Intro.flac')!.length,
        },
        { filename: 'Music\\Nowhere\\missing.flac', size: 1 },
      ],
    },
  })
  const finished = async () => {
    const users = (await (
      await api.get('transfers/downloads', { params: { includeRemoved: true } })
    ).json()) as RawUser[]
    return users.flatMap(({ username, directories }) =>
      directories.flatMap((directory) => directory.files.map((file) => ({ username, state: file.state }))),
    )
  }
  await expect
    .poll(async () => (await finished()).every(({ state }) => state.startsWith('Completed')), { timeout: 30_000 })
    .toBe(true)
  const downloads = await finished()
  const succeeded = downloads.filter(({ state }) => state === 'Completed, Succeeded')
  const failed = downloads.filter(({ state }) => !/Succeeded|Cancelled/.test(state))
  const users = new Set(succeeded.map(({ username }) => username)).size

  await page.goto('')
  await logInPage(page)
  await expect(page).toHaveURL(/\/slskd\/dashboard$/)
  await expect(page.getByText(`${count(succeeded.length, 'file')} from ${count(users, 'user')}`)).toBeVisible()
  await expect(page.getByText(`${failed.length.toLocaleString()} failed (`)).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Downloaded from' }).getByRole('button', { name: fast.username }),
  ).toBeVisible()

  await page.getByRole('radio', { name: 'All' }).click()
  await expect(page).toHaveURL(/\/slskd\/dashboard\?range=all$/)
  await expect(page.getByRole('heading', { name: 'By month' })).toBeVisible()
})
