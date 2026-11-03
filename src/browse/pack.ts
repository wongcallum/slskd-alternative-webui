import { parseFromWebStream } from '@discoveryjs/json-ext'

import { sleep } from '../lib/api'
import type { InputDirectory } from '../lib/tree'

export type RawShare = { directories: InputDirectory[]; lockedDirectories: InputDirectory[] }

// Columns compress far better than slskd's objects, so we store a share as blocks of columns, gzipped (see the facts).
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
const blockFolders = 16_384
const runFolders = 16_384

const byName = (a: InputDirectory, b: InputDirectory) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

// Sorting all of a big share's folders in one task holds the main thread too long, so each run gets its own task, and
// `merged` merges the runs as `blocksOf` makes the blocks.
async function sortedRuns(list: InputDirectory[]) {
  const runs = []
  for (let start = 0; start < list.length; start += runFolders) {
    runs.push(list.slice(start, start + runFolders).sort(byName))
    await sleep(0)
  }
  return runs
}

function* merged(runs: InputDirectory[][]) {
  const heads = runs.map((folders) => ({ folders, index: 0 }))
  for (;;) {
    let first: (typeof heads)[number] | undefined
    for (const head of heads) {
      const folder = head.folders[head.index]
      if (folder !== undefined && (first === undefined || byName(folder, first.folders[first.index]!) < 0)) {
        first = head
      }
    }
    if (first === undefined) return
    yield first.folders[first.index++]!
  }
}

type Lists = (readonly [runs: InputDirectory[][], locked: boolean])[]

// Folders go in name order, so that neighbouring folders share their paths' prefixes.
function* blocksOf(lists: Lists) {
  for (const [runs, locked] of lists) {
    let block: Block | undefined
    for (const { name, files } of merged(runs)) {
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
      if (filenames.length >= blockFiles || names.length >= blockFolders) {
        yield block
        block = undefined
      }
    }
    if (block !== undefined) yield block
  }
}

// Yields the JSON a column at a time, since stringifying and gzipping a whole block in one task takes too long.
function* piecesOf(lists: Lists) {
  let separator = '['
  for (const block of blocksOf(lists)) {
    for (const [index, column] of block.entries()) {
      const start = index === 0 ? `${separator}[` : ','
      yield start + JSON.stringify(column) + (index === block.length - 1 ? ']' : '')
    }
    separator = ','
  }
  yield separator === '[' ? '[]' : ']'
}

// `pull` takes one piece per task, so packing a big share never holds the main thread for long.
export async function packShare({ directories, lockedDirectories }: RawShare) {
  const pieces = piecesOf([
    [await sortedRuns(directories), false],
    [await sortedRuns(lockedDirectories), true],
  ])
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
  const blocks = (await parseFromWebStream(blob.stream().pipeThrough(new DecompressionStream('gzip')))) as Block[]
  const share: RawShare = { directories: [], lockedDirectories: [] }
  for (const block of blocks) {
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
