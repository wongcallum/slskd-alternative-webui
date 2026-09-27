import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, logInPage, test } from '../fixtures'

test('Files is used from the keyboard alone', async ({ page, slskd }) => {
  const folder = path.join(slskd.downloads, 'Keyboard')
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, 'Delete me.flac'), 'x')
  await writeFile(path.join(folder, 'Keep me.flac'), 'x')
  await page.goto('downloads')
  await logInPage(page)

  await page.keyboard.press('g')
  await page.keyboard.press(',')
  await expect(page.getByRole('link', { name: 'Info' })).toBeFocused()
  // Radix moves focus between the tabs a task after the key.
  for (const name of ['Options', 'Shares', 'Files']) {
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('link', { name })).toBeFocused()
  }
  await page.keyboard.press('Enter')
  const tree = page.getByRole('tree', { name: 'Folders' })
  await expect(tree.getByRole('treeitem', { name: /^Downloads/ })).toBeFocused()

  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(tree.getByRole('treeitem', { name: /^Keyboard/ })).toBeFocused()
  await page.keyboard.press('g')
  await page.keyboard.press('d')
  await expect(page).toHaveURL(/\/downloads$/)
  await page.goBack()
  await expect(tree.getByRole('treeitem', { name: /^Keyboard/ })).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  const pane = page.getByRole('grid', { name: 'Contents' })
  await expect(pane.getByRole('row', { name: /Delete me\.flac/ })).toBeFocused()

  // Selecting and deleting wait for slskd's options, which can arrive after the listing.
  await expect(pane.getByRole('checkbox', { name: 'Select all' })).toBeVisible()
  await page.keyboard.press('Space')
  await page.keyboard.press('Delete')
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Delete 1 file?')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(pane.getByRole('row', { name: /Delete me\.flac/ })).toBeHidden()
  expect(existsSync(path.join(folder, 'Delete me.flac'))).toBe(false)
  await expect(pane.getByRole('row', { name: /Keep me\.flac/ })).toBeFocused()

  await page.keyboard.press('Backspace')
  await expect(pane.getByRole('row', { name: /Keyboard/ })).toBeFocused()
  await page.goBack()
  await expect(pane.getByRole('row', { name: /Keep me\.flac/ })).toBeFocused()
})
