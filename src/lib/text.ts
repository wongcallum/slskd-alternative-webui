// oxlint-disable-next-line typescript/unbound-method -- Intl.Collator's compare getter returns a bound function
export const compareNames = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare

// Names are exact: some shares have folders differing only by case, or segments starting with a space.
export const compareExactly = (a: string, b: string) => compareNames(a, b) || (a < b ? -1 : a > b ? 1 : 0)

export const byName = <T extends { name: string }>(a: T, b: T) => compareExactly(a.name, b.name)

export function parseQuery(query: string) {
  const include: string[] = []
  const exclude: string[] = []
  for (const term of query.toLowerCase().split(/\s+/)) {
    if (!term.startsWith('-')) {
      if (term !== '') include.push(term)
    } else if (term.length > 1) exclude.push(term.slice(1))
  }
  return { include, exclude }
}
