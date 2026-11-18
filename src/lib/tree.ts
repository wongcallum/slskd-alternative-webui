import { type Criteria, hasAttributes, isJudging, passes } from './criteria'
import { describeRange, qualityOf, type RawFile, widenRange } from './files'
import { byName, matchesTerms, queryTerms, type Terms } from './text'

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
  search: string
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

// Files are left in the listed order, and sorted in place the first time they're needed in order: sorting them all
// takes longer than the rest of the build.
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
          search: filename.slice(prefix.length).toLowerCase(),
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

// A file matches a term when its path does. Terms without the separator can't span the folder and the name, so a term
// in the folder's path covers all its files, and the rest are tested against each name without building its path.
function fileMatcher(tree: Tree, terms: Terms) {
  const { separator } = tree
  const spanning = [...terms.include, ...terms.exclude].some((term) => term.includes(separator))
  const tester = (include: string[]) => {
    const remaining = { include, exclude: terms.exclude }
    return (file: TreeFile) => matchesTerms(remaining, file.search)
  }
  const anywhere = tester(terms.include)
  return (folder: Folder): ((file: TreeFile) => boolean) | boolean => {
    const path = folder.search
    if (spanning) return (file) => matchesTerms(terms, path + separator + file.search)
    if (terms.exclude.some((term) => path.includes(term))) return false
    if (!terms.include.some((term) => path.includes(term))) return anywhere
    const include = terms.include.filter((term) => !path.includes(term))
    return include.length + terms.exclude.length === 0 || tester(include)
  }
}

// Every path the next terms match, the previous ones matched too.
const narrows = (next: Terms | undefined, previous: Terms | undefined) =>
  previous === undefined ||
  (next !== undefined &&
    previous.include.every((term) => next.include.some((each) => each.includes(term))) &&
    previous.exclude.every((term) => next.exclude.some((each) => term.includes(each))))

const sameCriteria = (a: Criteria, b: Criteria) =>
  a.quality === b.quality && a.lossy === b.lossy && a.size === b.size && a.length === b.length

// A tree's last match, from which a narrower query, such as one being typed, only has to look through what it found.
const lastMatches = new WeakMap<Tree, { terms?: Terms; criteria: Criteria; matches: Matches }>()

export function matchTree(tree: Tree, query: string, criteria: Criteria): Matches | undefined {
  const terms = queryTerms(query)
  const judged = isJudging(criteria)
  if (terms === undefined && !judged) return undefined
  const last = lastMatches.get(tree)
  const previous =
    last !== undefined && sameCriteria(last.criteria, criteria) && narrows(terms, last.terms) ? last.matches : undefined
  const matcher = terms && fileMatcher(tree, terms)
  const own = new Map<Folder, TreeFile[]>()
  const filter = (folder: Folder, files: TreeFile[]) => {
    const matches = files.length === 0 || (matcher?.(folder) ?? true)
    let matched = matches === true ? files : matches === false ? [] : files.filter(matches)
    if (judged) {
      matched = matched.filter((file) => passes(criteria, file))
      if (!matched.some(hasAttributes)) matched = []
    }
    return matched
  }
  // Only folders with a match are sorted, since sorting every folder makes the first filter several times slower.
  const visit = (folder: Folder, files: TreeFile[]) => {
    let matched = filter(folder, files)
    if (matched.length > 0 && !sorted.has(folder)) matched = filter(folder, sortedFiles(folder))
    if (matched.length > 0) own.set(folder, matched)
  }
  if (previous === undefined) for (const folder of tree.byPath.values()) visit(folder, folder.files)
  else for (const [folder, files] of previous.own) visit(folder, files)
  const counts = new Map<Folder, number>()
  for (const [folder, matched] of own) {
    for (let current: Folder | undefined = folder; current !== undefined; current = current.parent) {
      counts.set(current, (counts.get(current) ?? 0) + matched.length)
    }
  }
  const matches = { own, counts }
  lastMatches.set(tree, { terms, criteria, matches })
  return matches
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
    for (const file of sortedFiles(current)) if (withLocked || !file.locked) files.push(file)
    for (const child of current.folders) visit(child)
  }
  visit(folder)
  return files
}

export function relativePath(tree: Tree, from: Folder, folder: Folder) {
  return from.path === '' ? folder.path : folder.path.slice(from.path.length + tree.separator.length)
}
