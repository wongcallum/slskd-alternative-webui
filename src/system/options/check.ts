import { isMap, isScalar, LineCounter, parseDocument, visit } from 'yaml'

export type Problem = { from: number; to: number; line: number; column: number; message: string }

export type Check = { syntax: boolean; problems: Problem[]; empty: boolean }

const ambiguous = /^(?:yes|no|on|off)$/i

// What slskd's own validator lets through and then breaks on (see docs/facts.md).
export function checkConfig(text: string): Check {
  const lineCounter = new LineCounter()
  const document = parseDocument(text, { lineCounter, prettyErrors: false })
  const problems: Problem[] = []
  const add = (from: number, to: number, message: string) => {
    const { line, col } = lineCounter.linePos(from)
    problems.push({ from, to, line, column: col, message })
  }
  for (const error of document.errors) {
    add(
      error.pos[0],
      error.pos[1],
      error.code === 'DUPLICATE_KEY'
        ? 'This key is already set. slskd accepts the file, but then drops every setting in it.'
        : error.message,
    )
  }
  const syntax = problems.length === 0
  visit(document, {
    Scalar(key, node) {
      if (key === 'key' || node.type !== 'PLAIN' || node.range == null) return
      if (typeof node.value === 'string' && ambiguous.test(node.value)) {
        add(
          node.range[0],
          node.range[1],
          `slskd can't read "${node.value}" as true or false. Write true or false, or quote it if it's meant as text.`,
        )
      }
    },
  })
  const { contents } = document
  const empty =
    contents === null ||
    (isMap(contents) && contents.items.length === 0) ||
    (isScalar(contents) && contents.value == null)
  return { syntax, problems, empty }
}
