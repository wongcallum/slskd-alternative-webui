import { type Criteria, hasAttributes, judging, passes } from './criteria'
import { describeRange, qualityOf, type RawFile, widenRange } from './files'
import { byName, queryMatcher } from './text'

type InputFile = RawFile & { modifiedAt?: number; hidden?: boolean; link?: boolean }

export type InputDirectory = { name: string; files: InputFile[]; modifiedAt?: number; hidden?: boolean }

export type TreeFile = {
  kind: 'file'
  id: string
  filename: string
  name: string
  folder: Folder
  size: number
  length?: number
  bitRate?: number
  quality: number
  qualityLabel: string
  locked: boolean
  hidden: boolean
  link: boolean
  modifiedAt?: number
}

// Totals are recursive. The tree's top is a folder too, with an empty path.
export type Folder = {
  kind: 'folder'
  id: string
  path: string
  name: string
  parent?: Folder
  folders: Folder[]
  files: TreeFile[]
  locked: boolean
  hidden: boolean
  modifiedAt?: number
  fileCount: number
  lockedCount: number
  size: number
  lockedSize: number
  length: number
  quality: number
  qualityLabel: string
  worst?: TreeFile
  best?: TreeFile
  search: string
}

export type Item = Folder | TreeFile

// The key names the tree across rebuilds, such as a user's share fetched again.
export type Tree = {
  key: string
  separator: string
  top: Folder
  byPath: ReadonlyMap<string, Folder>
  folderCount: number
}

function createFolder(path: string, name: string, parent?: Folder): Folder {
  return {
    kind: 'folder',
    id: path,
    path,
    name,
    parent,
    folders: [],
    files: [],
    locked: false,
    hidden: false,
    fileCount: 0,
    lockedCount: 0,
    size: 0,
    lockedSize: 0,
    length: 0,
    quality: -1,
    qualityLabel: '',
    search: path.toLowerCase(),
  }
}

function detectSeparator(directories: readonly InputDirectory[]) {
  let backslashes = 0
  let slashes = 0
  for (const { name } of directories) {
    if (name.includes('\\')) backslashes++
    else if (name.includes('/')) slashes++
  }
  return slashes > backslashes ? '/' : '\\'
}

// Files are left in the listed order, and sorted in place the first time a folder is shown or filtered: sorting them
// all takes longer than the rest of the build.
const sorted = new WeakSet<Folder>()

export function sortedFiles(folder: Folder) {
  if (!sorted.has(folder)) {
    folder.files.sort(byName)
    sorted.add(folder)
  }
  return folder.files
}

function total(folder: Folder) {
  folder.folders.sort(byName)
  for (const file of folder.files) {
    folder.fileCount++
    folder.size += file.size
    folder.length += file.length ?? 0
    if (file.locked) {
      folder.lockedCount++
      folder.lockedSize += file.size
    }
    widenRange(folder, file)
  }
  for (const child of folder.folders) {
    total(child)
    folder.fileCount += child.fileCount
    folder.lockedCount += child.lockedCount
    folder.size += child.size
    folder.lockedSize += child.lockedSize
    folder.length += child.length
    widenRange(folder, child.worst)
    widenRange(folder, child.best)
  }
  ;[folder.quality, folder.qualityLabel] = describeRange(folder.worst, folder.best)
}

type TreeInput = {
  key: string
  name: string
  separator?: string
  directories: readonly InputDirectory[]
  lockedDirectories?: readonly InputDirectory[]
}

// The list is flat and unordered. Folders missing from it are synthesised, and a trailing separator belongs to
// the folder's own name rather than starting an empty one.
export function buildTree({
  key,
  name,
  directories,
  lockedDirectories = [],
  separator = detectSeparator([...directories, ...lockedDirectories]),
}: TreeInput): Tree {
  const top = createFolder('', name)
  const byPath = new Map<string, Folder>([['', top]])
  const listed = new Map<Folder, boolean>()

  function folderAt(path: string): Folder {
    const existing = byPath.get(path)
    if (existing !== undefined) return existing
    const cut = path.lastIndexOf(separator, path.length - 2)
    const parent = cut <= 0 ? top : folderAt(path.slice(0, cut))
    const folder = createFolder(path, path.slice(cut + 1), parent)
    parent.folders.push(folder)
    byPath.set(path, folder)
    return folder
  }

  for (const [list, locked] of [
    [directories, false],
    [lockedDirectories, true],
  ] as const) {
    for (const directory of list) {
      const folder = folderAt(directory.name)
      folder.modifiedAt ??= directory.modifiedAt
      folder.hidden ||= directory.hidden === true
      const seen = listed.has(folder) ? new Set(folder.files.map((file) => file.filename)) : undefined
      listed.set(folder, (listed.get(folder) ?? true) && locked)
      const prefix = directory.name + separator
      for (const file of directory.files) {
        const filename = file.filename.startsWith(prefix) ? file.filename : prefix + file.filename
        if (seen?.has(filename)) continue
        const [quality, qualityLabel] = qualityOf(file)
        folder.files.push({
          kind: 'file',
          id: filename,
          filename,
          name: filename.slice(prefix.length),
          folder,
          size: file.size,
          length: file.length,
          bitRate: file.bitRate,
          quality,
          qualityLabel,
          locked,
          hidden: file.hidden === true,
          link: file.link === true,
          modifiedAt: file.modifiedAt,
        })
      }
    }
  }
  for (const [folder, locked] of listed) folder.locked = locked
  total(top)
  return { key, separator, top, byPath, folderCount: byPath.size - 1 }
}

export function nearestFolder(tree: Tree, path: string) {
  let current = path
  for (;;) {
    const folder = tree.byPath.get(current)
    if (folder !== undefined) return folder
    const cut = current.lastIndexOf(tree.separator, current.length - 2)
    if (cut <= 0) return tree.top
    current = current.slice(0, cut)
  }
}

// Matching files per folder, and the recursive count of matches for every folder that leads to one.
export type Matches = { own: ReadonlyMap<Folder, TreeFile[]>; counts: ReadonlyMap<Folder, number> }

export function matchTree(tree: Tree, query: string, criteria: Criteria): Matches | undefined {
  const matches = queryMatcher(query)
  const judged = judging(criteria)
  if (matches === undefined && !judged) return undefined
  const own = new Map<Folder, TreeFile[]>()
  const counts = new Map<Folder, number>()
  const visit = (folder: Folder): number => {
    let count = 0
    const files = sortedFiles(folder)
    let matched =
      matches === undefined
        ? files
        : files.filter((file) => matches(folder.search + tree.separator + file.name.toLowerCase()))
    if (judged) {
      matched = matched.filter((file) => passes(criteria, file))
      if (!matched.some(hasAttributes)) matched = []
    }
    if (matched.length > 0) {
      own.set(folder, matched)
      count += matched.length
    }
    for (const child of folder.folders) count += visit(child)
    if (count > 0) counts.set(folder, count)
    return count
  }
  visit(tree.top)
  return { own, counts }
}

export function matchesUnder(folder: Folder, matches: Matches) {
  const files: TreeFile[] = []
  function visit(current: Folder) {
    files.push(...(matches.own.get(current) ?? []))
    for (const child of current.folders) if (matches.counts.has(child)) visit(child)
  }
  if (matches.counts.has(folder)) visit(folder)
  return files
}

export function filesUnder(folder: Folder, withLocked = false) {
  const files: TreeFile[] = []
  function visit(current: Folder) {
    for (const file of current.files) if (withLocked || !file.locked) files.push(file)
    for (const child of current.folders) visit(child)
  }
  visit(folder)
  return files
}

export function relativePath(tree: Tree, from: Folder, folder: Folder) {
  return from.path === '' ? folder.path : folder.path.slice(from.path.length + tree.separator.length)
}
