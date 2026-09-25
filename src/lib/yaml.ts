import { parseDocument, type ToStringOptions, visit } from 'yaml'

// slskd reads its file with YamlDotNet, where yes, no, on and off are booleans, so strings like those get quoted.
export const yamlVersion = '1.1'

export const toStringOptions: ToStringOptions = { lineWidth: 0 }

export type YamlKind = 'key' | 'string' | 'literal' | 'comment'

export type YamlPart = { start: number; text: string; kind?: YamlKind }

// Everything that isn't a scalar is indentation, punctuation or a comment, so a '#' outside the scalars starts one.
export function highlightYaml(source: string): YamlPart[] {
  const spans: [number, number, YamlKind][] = []
  visit(parseDocument(source, { version: yamlVersion }), {
    Scalar(key, node) {
      if (node.range) {
        const kind = key === 'key' ? 'key' : typeof node.value === 'string' ? 'string' : 'literal'
        spans.push([node.range[0], node.range[1], kind])
      }
    },
  })
  const parts: YamlPart[] = []
  let at = 0
  const between = (end: number) => {
    for (const match of source.slice(at, end).matchAll(/#[^\n]*|[^#]+/g)) {
      const text = match[0]
      parts.push({ start: at + match.index, text, kind: text.startsWith('#') ? 'comment' : undefined })
    }
    at = end
  }
  for (const [start, end, kind] of spans) {
    between(start)
    parts.push({ start, text: source.slice(start, end), kind })
    at = end
  }
  between(source.length)
  return parts
}
