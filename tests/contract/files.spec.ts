import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from '../fixtures'
import * as schemas from './schemas'

const base64 = (text: string) => Buffer.from(text).toString('base64')

test('a recursive listing holds the whole tree, with paths relative to its root', async ({ slskd, api }) => {
  const response = await api.get('files/downloads/directories', { params: { recursive: true } })
  const listing = schemas.parse(schemas.listing, await response.json())
  expect(listing.name).toBe(path.basename(slskd.downloads))
  expect(listing.directories.map((entry) => entry.fullName)).toEqual(
    expect.arrayContaining(['Album', 'Album/CD2', 'Ünïcødé']),
  )
  const files = new Map(listing.files.map((entry) => [entry.fullName, entry]))
  expect(files.get('Album/CD2/01 Encore.flac')).toMatchObject({ name: '01 Encore.flac', length: 5000 })
  // The app takes a symlink's length as its target's path rather than a size.
  expect(files.get('link.flac')?.attributes.split(', ')).toContain('ReparsePoint')

  const incomplete = await api.get('files/incomplete/directories', { params: { recursive: true } })
  expect(schemas.parse(schemas.listing, await incomplete.json()).files.map((entry) => entry.fullName)).toContain(
    'someone/Album/01 Intro.flac',
  )
})

// The app adds these joins to keep a '/' out of the base64, which would split the route.
test('a file or folder is deleted by its base64 path, which may have ./ and // joins in it', async ({ slskd, api }) => {
  const folder = 'Deleted'
  const names = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'Inner/e.txt']
  for (const name of names) {
    await mkdir(path.dirname(path.join(slskd.downloads, folder, name)), { recursive: true })
    await writeFile(path.join(slskd.downloads, folder, name), name)
  }
  for (const [name, sent] of [
    ['a.txt', `${folder}/a.txt`],
    ['b.txt', `./${folder}/b.txt`],
    ['c.txt', `././${folder}//c.txt`],
    ['d.txt', `${folder}/./d.txt`],
  ]) {
    expect((await api.delete(`files/downloads/files/${base64(sent!)}`)).status(), sent).toBe(204)
    expect(existsSync(path.join(slskd.downloads, folder, name!)), sent).toBe(false)
  }
  expect((await api.delete(`files/downloads/directories/${base64(`${folder}//Inner`)}`)).status()).toBe(204)
  expect(existsSync(path.join(slskd.downloads, folder, 'Inner'))).toBe(false)
  expect((await api.delete(`files/downloads/directories/${base64(folder)}`)).status()).toBe(204)
  expect(existsSync(path.join(slskd.downloads, folder))).toBe(false)
})

// The app sends the requests that read the options one at a time, and retries a listing that fails like this.
test('a listing can fail on the file slskd writes and deletes while another request reads its options', async ({
  api,
}) => {
  test.setTimeout(60_000)
  const deadline = Date.now() + 50_000
  while (Date.now() < deadline) {
    const [listing] = await Promise.all([
      api.get('files/downloads/directories', { params: { recursive: true } }),
      api.get('options'),
      api.get('options'),
    ])
    if (listing.status() === 500) {
      expect(await listing.json()).toMatch(/^Could not find file '.+'\.$/)
      return
    }
  }
  throw new Error("No listing failed, so slskd may no longer trip them, and the app's workaround can go")
})
