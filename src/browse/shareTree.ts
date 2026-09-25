import { describeRange, qualityOf, type RawDirectory } from '../lib/files'
import { byName, parseQuery } from '../lib/text'

export type RawShare = { directories: RawDirectory[]; lockedDirectories: RawDirectory[] }

export type ShareFile = {
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
}

// Totals are recursive. The share's top is a folder too, with an empty path.
export type Folder = {
  kind: 'folder'
  id: string
  path: string
  name: string
  parent?: Folder
  folders: Folder[]
  files: ShareFile[]
  locked: boolean
  fileCount: number
  lockedCount: number
  size: number
  lockedSize: number
  length: number
  quality: number
  qualityLabel: string
  worst?: ShareFile
  best?: ShareFile
  search: string
}

export type Share = {
  username: string
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

function detectSeparator({ directories, lockedDirectories }: RawShare) {
  let backslashes = 0
  let slashes = 0
  for (const { name } of [...directories, ...lockedDirectories]) {
    if (name.includes('\\')) backslashes++
    else if (name.includes('/')) slashes++
  }
  return slashes > backslashes ? '/' : '\\'
}

// Files are left in the peer's order, and sorted where a folder is shown: sorting them all takes longer than the
// rest of the build.
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
    if (file.quality < 0) continue
    if (folder.worst === undefined || file.quality < folder.worst.quality) folder.worst = file
    if (folder.best === undefined || file.quality > folder.best.quality) folder.best = file
  }
  for (const child of folder.folders) {
    total(child)
    folder.fileCount += child.fileCount
    folder.lockedCount += child.lockedCount
    folder.size += child.size
    folder.lockedSize += child.lockedSize
    folder.length += child.length
    if (child.worst !== undefined && (folder.worst === undefined || child.worst.quality < folder.worst.quality)) {
      folder.worst = child.worst
    }
    if (child.best !== undefined && (folder.best === undefined || child.best.quality > folder.best.quality)) {
      folder.best = child.best
    }
  }
  ;[folder.quality, folder.qualityLabel] = describeRange(folder.worst, folder.best)
}

// The list is flat and unordered. Folders missing from it are synthesised, and a trailing separator belongs to
// the folder's own name rather than starting an empty one.
export function buildShare(username: string, raw: RawShare): Share {
  const separator = detectSeparator(raw)
  const top = createFolder('', username)
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

  for (const [directories, locked] of [
    [raw.directories, false],
    [raw.lockedDirectories, true],
  ] as const) {
    for (const directory of directories) {
      const folder = folderAt(directory.name)
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
        })
      }
    }
  }
  for (const [folder, locked] of listed) folder.locked = locked
  total(top)
  return { username, separator, top, byPath, folderCount: byPath.size - 1 }
}

export function nearestFolder(share: Share, path: string) {
  let current = path
  for (;;) {
    const folder = share.byPath.get(current)
    if (folder !== undefined) return folder
    const cut = current.lastIndexOf(share.separator, current.length - 2)
    if (cut <= 0) return share.top
    current = current.slice(0, cut)
  }
}

// Matching files per folder, and the recursive count of matches for every folder that leads to one.
export type Matches = { own: ReadonlyMap<Folder, ShareFile[]>; counts: ReadonlyMap<Folder, number> }

export function matchShare(share: Share, query: string): Matches | undefined {
  const { include, exclude } = parseQuery(query)
  if (include.length + exclude.length === 0) return undefined
  const own = new Map<Folder, ShareFile[]>()
  const counts = new Map<Folder, number>()
  function visit(folder: Folder) {
    let count = 0
    const matched: ShareFile[] = []
    for (const file of folder.files) {
      const search = folder.search + share.separator + file.name.toLowerCase()
      if (include.every((term) => search.includes(term)) && !exclude.some((term) => search.includes(term))) {
        matched.push(file)
      }
    }
    if (matched.length > 0) {
      own.set(folder, matched.sort(byName))
      count += matched.length
    }
    for (const child of folder.folders) count += visit(child)
    if (count > 0) counts.set(folder, count)
    return count
  }
  visit(share.top)
  return { own, counts }
}

export function matchesUnder(folder: Folder, matches: Matches) {
  const files: ShareFile[] = []
  function visit(current: Folder) {
    files.push(...(matches.own.get(current) ?? []))
    for (const child of current.folders) if (matches.counts.has(child)) visit(child)
  }
  if (matches.counts.has(folder)) visit(folder)
  return files
}

export function filesUnder(folder: Folder) {
  const files: ShareFile[] = []
  function visit(current: Folder) {
    for (const file of current.files) if (!file.locked) files.push(file)
    for (const child of current.folders) visit(child)
  }
  visit(folder)
  return files
}

export function relativePath(share: Share, from: Folder, folder: Folder) {
  return from.path === '' ? folder.path : folder.path.slice(from.path.length + share.separator.length)
}
