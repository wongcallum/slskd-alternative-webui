export type RawFile = {
  filename: string
  size: number
  bitRate?: number
  bitDepth?: number
  sampleRate?: number
  length?: number
  isVariableBitRate?: boolean
}

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

export type Rated = { quality: number; qualityLabel: string; bitRate?: number }

export function describeRange(worst: Rated | undefined, best: Rated | undefined): [number, string] {
  if (worst === undefined || best === undefined) return [-1, '']
  if (worst.qualityLabel === best.qualityLabel) return [worst.quality, worst.qualityLabel]
  if (best.quality >= lossless) return [worst.quality, `${worst.qualityLabel} – ${best.qualityLabel}`]
  if (worst.bitRate === best.bitRate) return [worst.quality, worst.qualityLabel]
  return [worst.quality, `${worst.bitRate}–${best.bitRate} kbps`]
}
