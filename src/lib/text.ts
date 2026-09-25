// oxlint-disable-next-line typescript/unbound-method -- Intl.Collator's compare getter returns a bound function
export const compareNames = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare

// Names are exact: some shares have folders differing only by case, or segments starting with a space.
export const compareExactly = (a: string, b: string) => compareNames(a, b) || (a < b ? -1 : a > b ? 1 : 0)

export const byName = <T extends { name: string }>(a: T, b: T) => compareExactly(a.name, b.name)

export const byUsername = <T extends { username: string }>(a: T, b: T) => compareExactly(a.username, b.username)

// Undefined when the query has no words to match.
export function queryMatcher(query: string) {
  const include: string[] = []
  const exclude: string[] = []
  for (const term of query.toLowerCase().split(/\s+/)) {
    if (!term.startsWith('-')) {
      if (term !== '') include.push(term)
    } else if (term.length > 1) exclude.push(term.slice(1))
  }
  if (include.length + exclude.length === 0) return undefined
  return (text: string) => include.every((term) => text.includes(term)) && !exclude.some((term) => text.includes(term))
}
