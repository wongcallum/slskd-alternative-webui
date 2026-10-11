// oxlint-disable-next-line typescript/unbound-method -- Intl.Collator's compare getter returns a bound function
export const compareNames = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare

// Names are exact: some shares have folders differing only by case, or segments starting with a space.
export const compareExactly = (a: string, b: string) => compareNames(a, b) || (a < b ? -1 : a > b ? 1 : 0)

// By segment, so a folder's subfolders sit right below it: whole strings put `Album 2` between `Album` and
// `Album\Scans`.
export function comparePaths(a: string, b: string) {
  const [left, right] = [a.split(/[\\/]/), b.split(/[\\/]/)]
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const order = compareExactly(left[i] ?? '', right[i] ?? '')
    if (order !== 0) return order
  }
  return left.length - right.length
}

export const byName = <T extends { name: string }>(a: T, b: T) => compareExactly(a.name, b.name)

export const byUsername = <T extends { username: string }>(a: T, b: T) => compareExactly(a.username, b.username)

export type Terms = { include: string[]; exclude: string[] }

// Undefined when the query has no words to match.
export function queryTerms(query: string): Terms | undefined {
  const include: string[] = []
  const exclude: string[] = []
  for (const term of query.toLowerCase().split(/\s+/)) {
    if (!term.startsWith('-')) {
      if (term !== '') include.push(term)
    } else if (term.length > 1) exclude.push(term.slice(1))
  }
  return include.length + exclude.length === 0 ? undefined : { include, exclude }
}

export const matchesTerms = ({ include, exclude }: Terms, text: string) =>
  include.every((term) => text.includes(term)) && !exclude.some((term) => text.includes(term))

export function queryMatcher(query: string) {
  const terms = queryTerms(query)
  return terms && ((text: string) => matchesTerms(terms, text))
}
