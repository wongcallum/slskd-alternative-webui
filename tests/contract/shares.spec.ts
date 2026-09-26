import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import * as v from 'valibot'

import type { RawState } from '../../src/system/application'
import { contextFor, expect, test } from '../fixtures'
import { openHub } from '../hub'
import { toneAttributes } from '../media'
import { logIn, sleep, start, writeFiles } from '../slskd'
import * as schemas from './schemas'

test('before the first scan, the contents are a 500 about a missing table', async () => {
  const slskd = await start()
  try {
    const response = await fetch(`${slskd.api}/shares/contents`, {
      headers: { Authorization: `Bearer ${await logIn(slskd)}` },
    })
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('no such table')
  } finally {
    await slskd.stop()
  }
})

// The app counts a scan as finished when ready turns true.
test('each scan turns ready off and on again, and then the counts and contents are the shared tree', async ({
  slskd,
  api,
  token,
}) => {
  const hub = await openHub(slskd, 'application', token, ['STATE'])
  try {
    const pushed = () => hub.received<RawState>('STATE').map((state) => state.shares)
    for (let scan = 0; scan < 2; scan++) {
      // A scan lets go a moment after ready turns true, and a rescan in between is dropped.
      if (scan > 0) await sleep(500)
      const from = pushed().length
      expect((await api.put('shares')).status()).toBe(200)
      await expect
        .poll(() => {
          const shares = pushed().slice(from)
          const off = shares.findIndex((each) => !each.ready)
          return off !== -1 && shares.slice(off).some((each) => each.ready && !each.scanning && !each.scanPending)
        })
        .toBe(true)
    }
    expect(pushed().at(-1)).toMatchObject({ files: 4, faulted: false, cancelled: false })
    // The app shows it as a percentage.
    const progress = pushed()
      .filter((shares) => shares.scanning)
      .map((shares) => shares.scanProgress)
    expect(progress.every((fraction) => fraction >= 0 && fraction <= 1)).toBe(true)
    expect(Math.max(...progress)).toBeGreaterThan(0)
  } finally {
    await hub.stop()
  }

  const hosts = schemas.parse(v.record(v.string(), schemas.shares), await (await api.get('shares')).json())
  expect(Object.keys(hosts)).toEqual(['local'])
  const byAlias = new Map(hosts.local?.map((share) => [share.alias, share]))
  expect(byAlias.get('Music')).toMatchObject({ isExcluded: false, files: 3, directories: 2 })
  expect(byAlias.get('Extra')).toMatchObject({ localPath: path.join(slskd.shares, 'Other'), files: 1, directories: 0 })
  expect(byAlias.get('Private')?.isExcluded).toBe(true)

  const contents = schemas.parse(schemas.directories, await (await api.get('shares/contents')).json())
  const folders = new Map(contents.map((directory) => [directory.name, directory.files]))
  const names = (name: string) => folders.get(name)?.map((file) => file.filename)
  expect(names('Music\\Album')?.sort()).toEqual(['01 Intro.flac', '02 Outro.mp3'])
  expect(names('Music\\Album\\CD2')).toEqual(['01 Encore.flac'])
  expect(names('Extra')).toEqual(['notes.txt'])
  expect([...folders.keys()].filter((name) => name.includes('Private'))).toEqual([])
  const album = new Map(folders.get('Music\\Album')?.map((file) => [file.filename, file]))
  expect(album.get('01 Intro.flac')).toMatchObject(toneAttributes.flac)
  expect(album.get('02 Outro.mp3')).toMatchObject(toneAttributes.mp3)
  expect(album.get('02 Outro.mp3')?.bitRate).toBeGreaterThan(0)
})

test('a running scan can be cancelled, and then finishes like a successful one, marked cancelled', async () => {
  const shared = await mkdtemp(path.join(tmpdir(), 'slskd-many-'))
  const slskd = await start({}, { SLSKD_SHARED_DIR: shared })
  try {
    // Enough that a scan takes a while.
    for (let folder = 0; folder < 200; folder++) {
      await writeFiles(
        path.join(shared, `Folder ${folder}`),
        Object.fromEntries(Array.from({ length: 50 }, (_, file) => [`File ${file}.txt`, 'x'])),
      )
    }
    const token = await logIn(slskd)
    const api = await contextFor(slskd)
    expect((await api.delete('shares')).status()).toBe(404)
    const hub = await openHub(slskd, 'application', token, ['STATE'])
    try {
      const latest = () => hub.received<RawState>('STATE').at(-1)?.shares
      expect((await api.put('shares')).status()).toBe(200)
      await expect.poll(() => latest()?.scanning).toBe(true)
      expect((await api.delete('shares')).status()).toBe(204)
      await expect
        .poll(latest, { timeout: 30_000 })
        .toMatchObject({ scanning: false, scanPending: false, ready: true, cancelled: true, faulted: false })
    } finally {
      await hub.stop()
      await api.dispose()
    }
  } finally {
    await slskd.stop()
    await rm(shared, { recursive: true, force: true })
  }
})
