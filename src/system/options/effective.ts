import { Document, isPair, isScalar, visit } from 'yaml'

import { toStringOptions, yamlVersion } from '../../lib/yaml'
import type { Settings } from './options'

// Keys under these are names the user chose, and changing them would name something else.
const userNamed = new Set([
  'relay.agents',
  'transfers.groups.userDefined',
  'web.authentication.apiKeys',
  'integrations.webhooks',
  'integrations.scripts',
])

// slskd's validator derives each key in the file by putting '_' before every capital of the property's name, so
// logSQL is log_s_q_l.
const toFileKey = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

function toFileKeys(value: unknown, path: string): unknown {
  if (Array.isArray(value)) return value.map((item) => toFileKeys(item, path))
  if (typeof value !== 'object' || value === null) return value
  const named = userNamed.has(path)
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      named ? key : toFileKey(key),
      toFileKeys(child, named ? `${path}.*` : path === '' ? key : `${path}.${key}`),
    ]),
  )
}

// int.MaxValue is the default of every transfer slot count and speed limit, where it means no limit.
const unlimited = 2_147_483_647

const limits = new Set(['slots', 'speed_limit'])

export function effectiveYaml(settings: Settings) {
  const document = new Document(toFileKeys(settings, ''), { version: yamlVersion })
  visit(document, {
    Pair(_, pair, path) {
      if (!isScalar(pair.key) || !isScalar(pair.value) || pair.value.value !== unlimited) return
      if (!limits.has(String(pair.key.value))) return
      const top = path.find(isPair)
      if (top !== undefined && isScalar(top.key) && top.key.value === 'transfers') pair.value.comment = ' unlimited'
    },
  })
  return document.toString(toStringOptions)
}
