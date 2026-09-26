import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

export type Media = { flac: Buffer; mp3: Buffer; png: Buffer }

const outputs = {
  flac: ['-f', 'lavfi', '-i', 'sine=duration=3', '-ar', '44100', '-sample_fmt', 's16', '-c:a', 'flac'],
  mp3: ['-f', 'lavfi', '-i', 'sine=duration=3', '-c:a', 'libmp3lame', '-q:a', '4'],
  png: ['-f', 'lavfi', '-i', 'color=c=red:s=16x16', '-frames:v', '1'],
}

async function generate(): Promise<Media> {
  const root = await mkdtemp(path.join(tmpdir(), 'media-'))
  try {
    const made = await Promise.all(
      Object.entries(outputs).map(async ([extension, args]) => {
        const file = path.join(root, `media.${extension}`)
        await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args, file])
        return [extension, await readFile(file)] as const
      }),
    )
    return Object.fromEntries(made) as Media
  } catch (error) {
    throw new Error("Couldn't make the test media. Run the tests in the devenv shell, which has ffmpeg.", {
      cause: error,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

let made: Promise<Media> | undefined

export const media = () => (made ??= generate())
