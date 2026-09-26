import { randomBytes } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { RawState } from '../src/system/application'
import type { RawTransfer, RawUser } from '../src/transfers/transfers'
import { type Config, freePort, type Instance, logIn, sleep, spawnGroup, start, stopGroup } from './slskd'

export type Peer = {
  instance: Instance
  username: string
  // By the name peers see, such as `Music\Artist - Album\01 Intro.flac`.
  files: Map<string, Buffer>
  token: string
}

export type Network = {
  // The environment for an instance that logs in to this network as `username`.
  login: (username: string) => Record<string, string>
  fast: Peer
  // One upload slot at 20 KiB/s, so its 2 MB files stay in progress or queued for as long as a test needs.
  slow: Peer
  stop: () => Promise<void>
}

const fastFiles = {
  'Music/Artist - Album/01 Intro.flac': 50_000,
  'Music/Artist - Album/02 Outro.flac': 60_000,
  'Music/Artist - Album/CD2/01 Encore.flac': 70_000,
  'Music/Artist - Album/CD2/Scans/cover.jpg': 10_000,
  'Music/Artist - Album 2/01 Other.flac': 30_000,
}

const slowFiles = {
  'Slow/Big 1.flac': 2_000_000,
  'Slow/Big 2.flac': 2_000_000,
  'Slow/Big 3.flac': 2_000_000,
}

function soulfindBinary() {
  const binary = process.env.SOULFIND_BIN
  if (binary === undefined || !existsSync(binary)) {
    throw new Error('No Soulfind. Run the tests in the devenv shell, or set SOULFIND_BIN.')
  }
  return binary
}

// Soulfind swaps a client's 127.0.0.1 for the host's own IPv4 address, which it finds from the route to a private
// address, so it needs a route (though not internet access).
const checkRoute = () =>
  new Promise<void>((resolve, reject) => {
    const socket = createSocket('udp4')
    socket.connect(9, '10.255.255.255', (error?: Error) => {
      socket.close()
      if (error === undefined || error === null) resolve()
      else reject(new Error(`Soulfind needs an IPv4 route, though not internet access: ${error.message}`))
    })
  })

const listening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })

export async function waitForState(instance: Instance, done: (state: RawState) => boolean, timeout = 30_000) {
  const token = instance.config.auth ? await logIn(instance) : undefined
  const headers: Record<string, string> = token === undefined ? {} : { Authorization: `Bearer ${token}` }
  const deadline = Date.now() + timeout
  for (;;) {
    const response = await fetch(`${instance.api}/application`, { headers })
    if (response.ok && done((await response.json()) as RawState)) return
    if (Date.now() > deadline) throw new Error(`slskd at ${instance.base} didn't get there`)
    await sleep(100)
  }
}

export const loggedIn = (instance: Instance) => waitForState(instance, (state) => state.server.isLoggedIn)

async function startPeer(
  root: string,
  login: Network['login'],
  username: string,
  sizes: Record<string, number>,
  env: Record<string, string> = {},
): Promise<Peer> {
  const files = new Map<string, Buffer>()
  for (const [name, size] of Object.entries(sizes)) {
    const file = path.join(root, name)
    const content = randomBytes(size)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
    files.set(name.replaceAll('/', '\\'), content)
  }
  const shared = [...new Set(Object.keys(sizes).map((name) => name.split('/')[0]!))]
  const instance = await start(
    {},
    {
      ...login(username),
      SLSKD_SHARED_DIR: shared.map((folder) => path.join(root, folder)).join(';'),
      SLSKD_NO_SHARE_SCAN: 'false',
      ...env,
    },
  )
  try {
    await waitForState(instance, (state) => state.server.isLoggedIn && state.shares.files === files.size)
  } catch (error) {
    await instance.stop()
    throw error
  }
  return { instance, username, files, token: await logIn(instance) }
}

export async function startNetwork(): Promise<Network> {
  await checkRoute()
  const root = await mkdtemp(path.join(tmpdir(), 'soulseek-test-'))
  const port = await freePort()
  const log = path.join(root, 'soulfind.log')
  const group = spawnGroup(
    soulfindBinary(),
    ['-d', path.join(root, 'soulfind.db'), '-p', String(port)],
    process.env,
    log,
    root,
  )
  const stopSoulfind = async () => {
    await stopGroup(group)
    await rm(root, { recursive: true, force: true })
  }

  const login = (username: string) => ({
    SLSKD_NO_CONNECT: 'false',
    SLSKD_SLSK_ADDRESS: '127.0.0.1',
    SLSKD_SLSK_PORT: String(port),
    SLSKD_SLSK_USERNAME: username,
    SLSKD_SLSK_PASSWORD: 'password',
    SLSKD_SLSK_DIAG_LEVEL: 'Debug',
    // Keeps peer connections for the worker's lifetime rather than 15 s, since opening one can fail (see startLoggedIn).
    SLSKD_SLSK_INACTIVITY_TIMEOUT: String(60 * 60 * 1000),
  })

  try {
    // Soulfind logs that it's listening before it binds.
    for (const deadline = Date.now() + 10_000; !(await listening(port)); await sleep(50)) {
      if (Date.now() > deadline) throw new Error(`Soulfind didn't come up:\n${readFileSync(log, 'utf8')}`)
    }
    const peers = await Promise.allSettled([
      startPeer(path.join(root, 'fast'), login, 'fast.peer one', fastFiles),
      startPeer(path.join(root, 'slow'), login, 'slow.peer one', slowFiles, {
        SLSKD_UPLOAD_SLOTS: '1',
        SLSKD_UPLOAD_SPEED_LIMIT: '20',
      }),
    ])
    const [fast, slow] = peers
    if (fast.status === 'rejected' || slow.status === 'rejected') {
      await Promise.all(peers.flatMap((peer) => (peer.status === 'fulfilled' ? [peer.value.instance.stop()] : [])))
      throw fast.status === 'rejected' ? fast.reason : (slow as PromiseRejectedResult).reason
    }
    return {
      login,
      fast: fast.value,
      slow: slow.value,
      stop: async () => {
        await Promise.all([fast.value.instance.stop(), slow.value.instance.stop()])
        await stopSoulfind()
      },
    }
  } catch (error) {
    await stopSoulfind()
    throw error
  }
}

async function reachesPeers(network: Network, instance: Instance) {
  const token = await logIn(instance)
  for (const peer of [network.fast, network.slow]) {
    const response = await fetch(`${instance.api}/users/${encodeURIComponent(peer.username)}/info`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return false
  }
  return true
}

// When a direct and an indirect connection between two peers arrive together, as they tend to on one host, Soulseek.NET
// 10.0.2 can drop the direct one from its cache without reading from it, and whatever the other side sends on it is
// lost until it times out. So an instance opens its connections to the peers once and checks them, starting again if
// one fails.
export async function startLoggedIn(network: Network, overrides: Partial<Config>, username: string) {
  const instance = await start(overrides, network.login(username))
  try {
    await loggedIn(instance)
    for (let attempt = 1; !(await reachesPeers(network, instance)); attempt++) {
      if (attempt === 3) throw new Error(`${username} couldn't reach the peers`)
      await instance.relaunch()
      await loggedIn(instance)
    }
  } catch (error) {
    await instance.stop()
    throw error
  }
  return instance
}

const endedAWhileAgo = ({ state, endedAt }: RawTransfer) =>
  state.startsWith('Completed') && (endedAt === undefined || Date.now() - Date.parse(endedAt.replace(/Z?$/, 'Z')) > 500)

// A peer ignores a request for a file while its upload of an earlier request for it is still ending, which leaves the
// new download queued for good. So after cancelling, wait for the peer to finish its uploads to `username`. An upload's
// record completes a few milliseconds before the upload lets go of the file, so they must have ended a while ago.
export async function uploadsEnded(peer: Peer, username: string, timeout = 15_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const response = await fetch(`${peer.instance.api}/transfers/uploads`, {
      headers: { Authorization: `Bearer ${peer.token}` },
    })
    const users = (await response.json()) as RawUser[]
    const files = users.find((user) => user.username === username)?.directories.flatMap((directory) => directory.files)
    if (files === undefined || files.every(endedAWhileAgo)) return
    if (Date.now() > deadline) throw new Error(`${peer.username} is still uploading to ${username}`)
    await sleep(100)
  }
}
