import { expect, logInPage, test } from '../fixtures'

test.use({ config: { soulseek: true } })

const file = (files: Map<string, Buffer>, filename: string) => ({ filename, size: files.get(filename)!.length })

test('downloads move to finished while the page is open, and can be retried, cancelled and cleared', async ({
  page,
  api,
  peers: { fast, slow },
}) => {
  await api.delete('transfers/downloads/all/completed')
  await page.goto('downloads')
  await logInPage(page)
  await api.post('transfers/downloads/batches', {
    data: {
      username: fast.username,
      files: [
        file(fast.files, 'Music\\Artist - Album\\01 Intro.flac'),
        { filename: 'Music\\Nowhere\\missing.flac', size: 1 },
      ],
    },
  })
  await api.post('transfers/downloads/batches', {
    data: { username: slow.username, files: [file(slow.files, 'Slow\\Big 1.flac')] },
  })
  await expect(page.getByText('Big 1.flac')).toBeVisible()
  await expect(page.getByText('1 succeeded, 1 failed')).toBeVisible()

  await page.getByRole('button', { name: 'Retry failed' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText(/^Retried /)).toBeVisible()
  await expect(page.getByText('1 succeeded, 1 failed')).toBeVisible()

  await page.getByRole('row').filter({ hasText: 'Big 1.flac' }).getByRole('checkbox').click()
  await page.getByRole('button', { name: 'Cancel 1' }).click()
  await expect(page.getByText('1 succeeded, 1 failed, 1 cancelled')).toBeVisible()

  await page.getByRole('button', { name: 'Clear finished' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByText(/succeeded/)).toBeHidden()
  expect(JSON.stringify(await (await api.get('transfers/downloads')).json())).not.toContain('Completed')
})

test("a peer's uploads are listed on its own page", async ({ page, api, peers: { slow } }) => {
  await api.post('transfers/downloads/batches', {
    data: { username: slow.username, files: [file(slow.files, 'Slow\\Big 2.flac')] },
  })
  await page.goto(`${slow.instance.base}/uploads`)
  await logInPage(page)
  await expect(page.getByText('Big 2.flac')).toBeVisible()
  await expect(page.getByText(/1 uploading/)).toBeVisible()
})
