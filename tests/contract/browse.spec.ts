import { expect, test } from '../fixtures'
import { toneAttributes } from '../media'
import * as schemas from './schemas'

test.use({ config: { soulseek: true } })

test("browsing a peer gets its whole share, with every folder's full path, bare file names and audio attributes", async ({
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
  const files = new Map(
    share.directories.flatMap((directory) =>
      directory.files.map((file) => [`${directory.name}\\${file.filename}`, file] as const),
    ),
  )
  expect([...files.keys()].sort()).toEqual([...fast.files.keys()].sort())
  expect(files.get('Music\\Artist - Album\\01 Intro.flac')).toMatchObject(toneAttributes.flac)
  expect(files.get('Music\\Artist - Album 2\\02 Other.mp3')).toMatchObject(toneAttributes.mp3)
  expect(files.get('Music\\Artist - Album 2\\02 Other.mp3')?.bitRate).toBeGreaterThan(0)
  expect(files.get('Music\\Artist - Album\\02 Outro.flac')).toEqual({ filename: '02 Outro.flac', size: 60_000 })
})

test("a browse's progress counts the bytes the peer sent, and can be read for a moment after", async ({
  api,
  peers: { fast },
}) => {
  const user = `users/${encodeURIComponent(fast.username)}`
  expect((await api.get(`${user}/browse`)).status()).toBe(200)
  const progress = schemas.parse(schemas.browseProgress, await (await api.get(`${user}/browse/status`)).json())
  expect(progress.size).toBeGreaterThan(0)
  expect(progress).toMatchObject({ bytesTransferred: progress.size, percentComplete: 100 })
})
