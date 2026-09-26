import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

export type Config = {
  urlBase: string
  auth: boolean
  // remote_configuration, remote_file_management and debug, which are all off by default.
  features: boolean
}

export const defaultConfig: Config = { urlBase: '/slskd', auth: true, features: true }

export const credentials = { username: 'slskd', password: 'slskd' }

export type Instance = {
  config: Config
  // Without a trailing slash, so it's the origin when the url base is the root.
  base: string
  api: string
  root: string
  appDir: string
  configFile: string
  downloads: string
  incomplete: string
  shares: string
  waitUntilUp: () => Promise<void>
  stop: () => Promise<void>
}

const repo = path.resolve(import.meta.dirname, '..')

export const dist = path.join(repo, 'dist')

function binary() {
  const configured = process.env.SLSKD_BIN
  if (configured !== undefined) return path.resolve(configured)
  const state = process.env.DEVENV_STATE ?? path.join(repo, '.devenv/state')
  const dll = path.join(state, 'slskd/artifacts/bin/slskd/debug/slskd.dll')
  if (!existsSync(dll)) throw new Error(`No slskd at ${dll}. Run devenv up once, or set SLSKD_BIN.`)
  return dll
}

// A port the OS hands out can be handed to another worker before this one's slskd binds it, and that worker's
// instance then answers for this one. So each worker takes ports from its own block, below the ephemeral range.
const portBlock = 500
const firstPort = 10_000 + Number(process.env.TEST_PARALLEL_INDEX ?? 0) * portBlock
let portOffset = 0

const canListen = (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, () => server.close(() => resolve(true)))
  })

async function freePort() {
  for (let tries = 0; tries < portBlock; tries++) {
    const port = firstPort + (portOffset++ % portBlock)
    if (await canListen(port)) return port
  }
  throw new Error(`No free port from ${firstPort}`)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function writeFiles(root: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
}

export const shareFiles = {
  'Music/Album/01 Intro.flac': 'a'.repeat(3000),
  'Music/Album/02 Outro.flac': 'b'.repeat(4000),
  'Music/Album/CD2/01 Encore.flac': 'c'.repeat(5000),
  'Music/Private/secret.flac': 'd'.repeat(100),
  'Other/notes.txt': 'notes',
}

export const downloadFiles = {
  'Album/01 Intro.flac': 'a'.repeat(3000),
  'Album/CD2/01 Encore.flac': 'c'.repeat(5000),
  '.hidden': 'hidden',
  'Ünïcødé/файл.txt': 'unicode',
}

export const incompleteFiles = { 'someone/Album/01 Intro.flac': 'a'.repeat(1000) }

// Everything else is set through the environment, since the file would override it.
export const configYaml = 'instance_name: test\n'

// Detached children survive their worker, so any still running when it exits are taken down with it.
const running = new Set<number>()
process.on('exit', () => {
  for (const group of running) {
    try {
      process.kill(-group, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
})

const groupAlive = (group: number) => {
  try {
    process.kill(-group, 0)
    return true
  } catch {
    return false
  }
}

export async function start(overrides: Partial<Config> = {}): Promise<Instance> {
  const config = { ...defaultConfig, ...overrides }
  const root = await mkdtemp(path.join(tmpdir(), 'slskd-test-'))
  const dirs = {
    appDir: path.join(root, 'app'),
    downloads: path.join(root, 'downloads'),
    incomplete: path.join(root, 'incomplete'),
    shares: path.join(root, 'shares'),
  }
  await writeFiles(dirs.shares, shareFiles)
  await writeFiles(dirs.downloads, downloadFiles)
  await symlink('Album/01 Intro.flac', path.join(dirs.downloads, 'link.flac'))
  await writeFiles(dirs.incomplete, incompleteFiles)
  const configFile = path.join(dirs.appDir, 'slskd.yml')
  await writeFiles(dirs.appDir, { 'slskd.yml': configYaml })

  const port = await freePort()
  const executable = binary()
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SLSKD_'))),
    SLSKD_APP_DIR: dirs.appDir,
    SLSKD_HTTP_IP_ADDRESS: '127.0.0.1',
    SLSKD_HTTP_PORT: String(port),
    SLSKD_NO_HTTPS: 'true',
    SLSKD_SLSK_LISTEN_PORT: String(await freePort()),
    SLSKD_URL_BASE: config.urlBase,
    SLSKD_CONTENT_PATH: path.relative(path.dirname(executable), dist),
    SLSKD_USERNAME: credentials.username,
    SLSKD_PASSWORD: credentials.password,
    SLSKD_NO_AUTH: String(!config.auth),
    SLSKD_REMOTE_CONFIGURATION: String(config.features),
    SLSKD_REMOTE_FILE_MANAGEMENT: String(config.features),
    SLSKD_DEBUG: String(config.features),
    SLSKD_DOWNLOADS_DIR: dirs.downloads,
    SLSKD_INCOMPLETE_DIR: dirs.incomplete,
    SLSKD_SHARED_DIR: [
      path.join(dirs.shares, 'Music'),
      `[Extra]${path.join(dirs.shares, 'Other')}`,
      `-${path.join(dirs.shares, 'Music/Private')}`,
    ].join(';'),
    SLSKD_NO_CONNECT: 'true',
    SLSKD_NO_SHARE_SCAN: 'true',
    SLSKD_NO_VERSION_CHECK: 'true',
    SLSKD_NO_CONFIG_WATCH: 'true',
    SLSKD_NO_LOGO: 'true',
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_NOLOGO: '1',
  }

  const log = path.join(root, 'slskd.log')
  const output = openSync(log, 'a')
  const [command, args] = executable.endsWith('.dll') ? ['dotnet', [executable]] : [executable, []]
  // slskd allows one instance per Unix session, so each gets its own.
  const child = spawn(command, args, { env, detached: true, stdio: ['ignore', output, output] })
  closeSync(output)
  if (child.pid === undefined) throw new Error(`Couldn't start ${command}`)
  const group = child.pid
  running.add(group)

  const base = `http://127.0.0.1:${port}${config.urlBase === '/' ? '' : config.urlBase}`
  const api = `${base}/api/v0`

  async function waitUntilUp(timeout = 60_000) {
    const deadline = Date.now() + timeout
    for (;;) {
      try {
        if ((await fetch(`${api}/session/enabled`)).ok) return
      } catch {
        // Not listening yet.
      }
      if (Date.now() > deadline || !groupAlive(group)) {
        throw new Error(`slskd didn't come up (${executable}):\n${readFileSync(log, 'utf8')}`)
      }
      await sleep(100)
    }
  }

  async function stop() {
    for (const [signal, wait] of [
      ['SIGTERM', 10_000],
      ['SIGKILL', 5000],
    ] as const) {
      try {
        process.kill(-group, signal)
      } catch {
        break
      }
      const deadline = Date.now() + wait
      while (groupAlive(group) && Date.now() < deadline) await sleep(50)
      if (!groupAlive(group)) break
    }
    running.delete(group)
    await rm(root, { recursive: true, force: true })
  }

  try {
    await waitUntilUp()
  } catch (error) {
    await stop()
    throw error
  }
  return { config, base, api, root, configFile, ...dirs, waitUntilUp, stop }
}

export async function logIn(instance: Instance) {
  const response = await fetch(`${instance.api}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  if (!response.ok) throw new Error(`Login failed: ${response.status}`)
  return ((await response.json()) as { token: string }).token
}
