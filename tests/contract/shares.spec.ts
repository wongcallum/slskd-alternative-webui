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
test('each scan turns ready off and on again, and then the contents are the shared tree', async ({
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
  } finally {
    await hub.stop()
  }

  schemas.parse(v.record(v.string(), schemas.shares), await (await api.get('shares')).json())
  const contents = schemas.parse(schemas.directories, await (await api.get('shares/contents')).json())
  // The app builds the tree from each folder's path, which starts with its share's alias.
  expect(contents.map((directory) => directory.name)).toEqual(
    expect.arrayContaining(['Music\\Album', 'Music\\Album\\CD2', 'Extra']),
  )
})
