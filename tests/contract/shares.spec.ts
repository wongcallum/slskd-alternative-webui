import path from 'node:path'

import * as v from 'valibot'

import type { RawState } from '../../src/system/application'
import { expect, test } from '../fixtures'
import { openHub } from '../hub'
import { logIn, sleep, start } from '../slskd'
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
  } finally {
    await hub.stop()
  }

  const hosts = schemas.parse(v.record(v.string(), schemas.shares), await (await api.get('shares')).json())
  expect(Object.keys(hosts)).toEqual(['local'])
  const byAlias = new Map(hosts.local?.map((share) => [share.alias, share]))
  expect(byAlias.get('Music')).toMatchObject({ isExcluded: false, files: 3 })
  expect(byAlias.get('Extra')).toMatchObject({ localPath: path.join(slskd.shares, 'Other'), files: 1 })
  expect(byAlias.get('Private')?.isExcluded).toBe(true)

  const contents = schemas.parse(schemas.directories, await (await api.get('shares/contents')).json())
  const folders = new Map(contents.map((directory) => [directory.name, directory.files.map((file) => file.filename)]))
  expect(folders.get('Music\\Album')?.sort()).toEqual(['01 Intro.flac', '02 Outro.flac'])
  expect(folders.get('Music\\Album\\CD2')).toEqual(['01 Encore.flac'])
  expect(folders.get('Extra')).toEqual(['notes.txt'])
  expect([...folders.keys()].filter((name) => name.includes('Private'))).toEqual([])
})
