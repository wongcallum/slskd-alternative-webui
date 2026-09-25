import { onSessionEnd } from '../session/session'

const span = 3000

// Bytes per second over the samples of the last few seconds, and always at least the latest one.
export function createRate() {
  let samples: { at: number; elapsed: number; bytes: number }[] = []
  onSessionEnd(() => {
    samples = []
  })
  return {
    reset() {
      samples = []
    },
    add(at: number, elapsed: number, bytes: number) {
      samples = samples.filter((sample) => sample.at > at - span)
      samples.push({ at, elapsed, bytes })
      let moved = 0
      let time = 0
      for (const sample of samples) {
        moved += sample.bytes
        time += sample.elapsed
      }
      return time > 0 ? (moved / time) * 1000 : 0
    },
  }
}
