import { expect, test } from '../fixtures'
import * as schemas from './schemas'

test.use({ config: { soulseek: true } })

test("browsing a peer gets its whole share, with every folder's full path and bare file names", async ({
  api,
  peers: { fast },
}) => {
  const response = await api.get(`users/${encodeURIComponent(fast.username)}/browse`)
  expect(response.status()).toBe(200)
  const share = schemas.parse(schemas.share, await response.json())
  expect(share.lockedDirectories).toEqual([])
  expect(share.directories.map((directory) => directory.name).sort()).toEqual([
    'Music',
    'Music\\Artist - Album',
    'Music\\Artist - Album 2',
    'Music\\Artist - Album\\CD2',
    'Music\\Artist - Album\\CD2\\Scans',
  ])
  const files = share.directories.flatMap((directory) =>
    directory.files.map((file) => `${directory.name}\\${file.filename}`),
  )
  expect(files.sort()).toEqual([...fast.files.keys()].sort())
})

test("a browse's progress can be read for a moment after it ends", async ({ api, peers: { fast } }) => {
  const user = `users/${encodeURIComponent(fast.username)}`
  expect((await api.get(`${user}/browse`)).status()).toBe(200)
  schemas.parse(schemas.browseProgress, await (await api.get(`${user}/browse/status`)).json())
})
