import { sleep } from '../lib/api'
import type { InputDirectory } from '../lib/tree'

export type RawShare = { directories: InputDirectory[]; lockedDirectories: InputDirectory[] }

// Columns compress far better than slskd's objects, so a share is stored as blocks of columns, gzipped (see the facts).
// An attribute the peer didn't send is null.
type Block = [
  locked: boolean,
  names: string[],
  counts: number[],
  filenames: string[],
  sizes: number[],
  bitRates: (number | null)[],
  bitDepths: (number | null)[],
  sampleRates: (number | null)[],
  lengths: (number | null)[],
  variable: (boolean | null)[],
]

const blockFiles = 16_384

const byName = (a: InputDirectory, b: InputDirectory) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

// Sorted, so that neighbouring folders share their paths' prefixes.
function* blocksOf({ directories, lockedDirectories }: RawShare) {
  for (const [list, locked] of [
    [directories, false],
    [lockedDirectories, true],
  ] as const) {
    let block: Block | undefined
    for (const { name, files } of list.toSorted(byName)) {
      block ??= [locked, [], [], [], [], [], [], [], [], []]
      const [, names, counts, filenames, sizes, bitRates, bitDepths, sampleRates, lengths, variable] = block
      names.push(name)
      counts.push(files.length)
      const prefix = name + '\\'
      for (const file of files) {
        filenames.push(file.filename.startsWith(prefix) ? file.filename.slice(prefix.length) : file.filename)
        sizes.push(file.size)
        bitRates.push(file.bitRate ?? null)
        bitDepths.push(file.bitDepth ?? null)
        sampleRates.push(file.sampleRate ?? null)
        lengths.push(file.length ?? null)
        variable.push(file.isVariableBitRate ?? null)
      }
      if (filenames.length >= blockFiles) {
        yield block
        block = undefined
      }
    }
    if (block !== undefined) yield block
  }
}

// The JSON text a column at a time, since a whole block stringified and gzipped in one task takes too long.
function* piecesOf(share: RawShare) {
  let separator = '['
  for (const block of blocksOf(share)) {
    for (const [index, column] of block.entries()) {
      const start = index === 0 ? `${separator}[` : ','
      yield start + JSON.stringify(column) + (index === block.length - 1 ? ']' : '')
    }
    separator = ','
  }
  yield separator === '[' ? '[]' : ']'
}

// One piece per task, so packing a big share never holds the main thread for long.
export function packShare(share: RawShare) {
  const pieces = piecesOf(share)
  const text = new ReadableStream<string>({
    async pull(controller) {
      await sleep(0)
      const next = pieces.next()
      if (next.done) controller.close()
      else controller.enqueue(next.value)
    },
  })
  const packed = text.pipeThrough(new TextEncoderStream()).pipeThrough(new CompressionStream('gzip'))
  return new Response(packed).blob()
}

export async function unpackShare(blob: Blob): Promise<RawShare> {
  const text = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
  const share: RawShare = { directories: [], lockedDirectories: [] }
  for (const block of JSON.parse(text) as Block[]) {
    const [locked, names, counts, filenames, sizes, bitRates, bitDepths, sampleRates, lengths, variable] = block
    const list = locked ? share.lockedDirectories : share.directories
    let index = 0
    for (const [position, name] of names.entries()) {
      const files = []
      for (const end = index + counts[position]!; index < end; index++) {
        files.push({
          filename: filenames[index]!,
          size: sizes[index]!,
          bitRate: bitRates[index] ?? undefined,
          bitDepth: bitDepths[index] ?? undefined,
          sampleRate: sampleRates[index] ?? undefined,
          length: lengths[index] ?? undefined,
          isVariableBitRate: variable[index] ?? undefined,
        })
      }
      list.push({ name, files })
    }
  }
  return share
}
