import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Locator } from '@playwright/test'

import { expect, logInPage, test } from '../fixtures'

// This path's base64 has a '/' in it, so the app has to send it with a join slskd normalises away.
test('a file is deleted from Files, even one that needs its path encoded with a join', async ({ page, slskd }) => {
  const file = path.join(slskd.downloads, 'Album', 'Is it?.flac')
  await writeFile(file, 'x')
  await page.goto(`system/files?path=${encodeURIComponent('Downloads/Album')}`)
  await logInPage(page)
  await page.getByRole('checkbox', { name: 'Select Downloads/Album/Is it?.flac' }).click()
  await page.getByRole('button', { name: /^Delete 1 / }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Is it?.flac')).toBeHidden()
  expect(existsSync(file)).toBe(false)
})

// Each column's width in a row, the header included.
const widths = (row: Locator) =>
  row.evaluate((element) =>
    [...element.children]
      .filter((child) => !child.classList.contains('table-resize'))
      .map((child) => Math.round(child.getBoundingClientRect().width)),
  )

test('a column is resized from its edge or the keyboard and kept, and a double-click on its edge resets it', async ({
  page,
  slskd,
}) => {
  const folder = path.join(slskd.downloads, 'Columns')
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, 'Resized.flac'), 'x')
  await page.goto(`system/files?path=${encodeURIComponent('Downloads/Columns')}`)
  await logInPage(page)
  const pane = page.getByRole('grid', { name: 'Contents' })
  const header = pane.locator('.table-columns')
  const row = pane.getByRole('row', { name: /Resized\.flac/ }).locator('.table-row')
  await expect(row).toBeVisible()
  const sort = pane.getByRole('button', { name: 'Size', exact: true })
  const size = header.locator('.table-cell').filter({ has: page.getByRole('button', { name: 'Size', exact: true }) })
  const edge = async () => {
    const box = await size.boundingBox()
    return { x: box!.x, y: box!.y + box!.height / 2 }
  }

  const index = await size.evaluate((cell) => [...(cell.parentElement?.children ?? [])].indexOf(cell))
  const before = await widths(header)
  expect(before[index]).toBe(100)
  const start = await edge()
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x - 60, start.y, { steps: 4 })
  await page.mouse.up()
  expect((await edge()).x).toBeCloseTo(start.x - 60, 0)
  const dragged = await widths(header)
  expect(dragged[index]).toBe(160)
  expect(await widths(row)).toEqual(dragged)

  await page.reload()
  await expect(row).toBeVisible()
  expect(await widths(header)).toEqual(dragged)
  await sort.focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => (await widths(header))[index]).toBe(170)
  await expect(sort).toHaveAccessibleName('Size')

  const { x, y } = await edge()
  await page.mouse.dblclick(x, y)
  await expect.poll(() => widths(header)).toEqual(before)
})

test('a rescan updates the counts, and the contents open from a share', async ({ page }) => {
  await page.goto('system/shares')
  await logInPage(page)
  await page.getByRole('button', { name: 'Rescan' }).click()
  await expect(page.getByText('4 files in 2 folders shared')).toBeVisible()
  await page.getByText('Music', { exact: true }).click()
  await expect(page.getByText('Album', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('This page crashed')).toHaveCount(0)
})

test('the config file opens in the editor and saves', async ({ page, slskd }) => {
  await page.goto('system/options?view=file')
  await logInPage(page)
  const editor = page.locator('.cm-content')
  await expect(editor).toContainText('instance_name: test')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('# Saved from the editor\n')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(/^Saved\./)).toBeVisible()
  expect(await readFile(slskd.configFile, 'utf8')).toContain('# Saved from the editor')
})

test('stored searches can be deleted and opened while new searches arrive', async ({ page, api }) => {
  await api.post('searches', { data: { searchText: 'stored search' } })
  await page.goto('searches')
  await logInPage(page)
  await expect(page.getByText('Not logged in to Soulseek')).toBeVisible()
  const searches = page.getByRole('grid', { name: 'Searches' })
  const stored = searches.getByRole('row', { name: /stored search/ })
  await expect(stored).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(stored).toBeFocused()
  await api.post('searches', { data: { searchText: 'newer search' } })
  const newer = searches.getByRole('row', { name: /newer search/ })
  await expect(newer).toBeVisible()
  await expect(stored).toBeFocused()
  await expect(stored).toHaveAttribute('tabindex', '0')
  await page.keyboard.press('Delete')
  await expect(stored).toBeHidden()
  await expect(newer).toBeVisible()
  await expect(newer).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveTitle('newer search – Search – slskd')
  await expect(page.getByText('This page crashed')).toHaveCount(0)
})

test.describe('a relay agent', () => {
  test.use({ config: { agent: true } })

  test('lands on System, with its controller in place of Soulseek', async ({ page, slskd }) => {
    await page.goto('')
    await logInPage(page)
    await expect(page).toHaveURL(/\/system\/info$/)
    await expect(page.getByRole('link', { name: 'Downloads' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Controller connected' })).toBeVisible()
    await expect(page.getByText(slskd.controller!.base)).toBeVisible()
    await page.goto('downloads')
    await expect(page.getByRole('heading', { name: 'This slskd is a relay agent' })).toBeVisible()
  })
})
