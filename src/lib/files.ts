export type RawFile = {
  filename: string
  size: number
  bitRate?: number
  bitDepth?: number
  sampleRate?: number
  length?: number
  isVariableBitRate?: boolean
}

export type RawDirectory = { name: string; files: RawFile[] }

export const lastSeparator = (path: string, from = path.length) =>
  Math.max(path.lastIndexOf('/', from), path.lastIndexOf('\\', from))

export const nameOf = (path: string) => path.slice(lastSeparator(path) + 1)

export const countFiles = (groups: readonly { files: readonly unknown[] }[]) =>
  groups.reduce((count, group) => count + group.files.length, 0)

// Lossless ranks above any bitrate, by depth and then sample rate. A file without attributes ranks lowest.
export const losslessQuality = (bitDepth: number, sampleRate = 0) => 100_000 + bitDepth * 1000 + sampleRate / 1000

const lossless = losslessQuality(0)

export function qualityOf(file: RawFile): [number, string] {
  if (file.bitDepth && file.sampleRate) {
    return [losslessQuality(file.bitDepth, file.sampleRate), `${file.bitDepth}/${file.sampleRate / 1000} kHz`]
  }
  if (file.bitRate) return [file.bitRate, `${file.bitRate} kbps${file.isVariableBitRate ? ' VBR' : ''}`]
  return [-1, '']
}

type Rated = { quality: number; qualityLabel: string; bitRate?: number }

// A file without attributes doesn't count.
export function widenRange<F extends Rated>(range: { worst?: F; best?: F }, file: F | undefined) {
  if (file === undefined || file.quality < 0) return
  if (range.worst === undefined || file.quality < range.worst.quality) range.worst = file
  if (range.best === undefined || file.quality > range.best.quality) range.best = file
}

export function describeRange(worst: Rated | undefined, best: Rated | undefined): [number, string] {
  if (worst === undefined || best === undefined) return [-1, '']
  if (worst.qualityLabel === best.qualityLabel) return [worst.quality, worst.qualityLabel]
  if (best.quality >= lossless) return [worst.quality, `${worst.qualityLabel} – ${best.qualityLabel}`]
  if (worst.bitRate === best.bitRate) return [worst.quality, worst.qualityLabel]
  return [worst.quality, `${worst.bitRate}–${best.bitRate} kbps`]
}
