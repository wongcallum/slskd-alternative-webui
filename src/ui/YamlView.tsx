import { useMemo } from 'react'

import { highlightYaml, type YamlKind } from '../lib/yaml'
import { Preformatted } from './details'

export const yamlColors: Record<YamlKind, string> = {
  key: 'var(--accent-11)',
  string: 'var(--green-11)',
  literal: 'var(--orange-11)',
  comment: 'var(--gray-10)',
}

export function YamlView({ source }: { source: string }) {
  const parts = useMemo(() => highlightYaml(source), [source])
  return (
    <Preformatted>
      {parts.map(({ start, text, kind }) => (
        <span key={start} style={kind === undefined ? undefined : { color: yamlColors[kind] }}>
          {text}
        </span>
      ))}
    </Preformatted>
  )
}
