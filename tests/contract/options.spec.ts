import { readFile } from 'node:fs/promises'

import { expect, jsonString, test } from '../fixtures'
import { configYaml } from '../slskd'
import * as schemas from './schemas'

const invalid = 'debug: [\n'

test('the file and its location are read as JSON strings', async ({ slskd, api }) => {
  expect(await (await api.get('options/yaml')).json()).toBe(await readFile(slskd.configFile, 'utf8'))
  expect(await (await api.get('options/yaml/location')).json()).toBe(slskd.configFile)
})

test('validating answers 200 either way, with a message only when the file is invalid', async ({ api }) => {
  const valid = await api.post('options/yaml/validate', jsonString(configYaml))
  expect(valid.status()).toBe(200)
  expect(await valid.text()).toBe('')
  const rejected = await api.post('options/yaml/validate', jsonString(invalid))
  expect(rejected.status()).toBe(200)
  expect(typeof (await rejected.json())).toBe('string')
})

test('saving writes the file and asks for a restart, and an invalid file is a 400 with the message', async ({
  slskd,
  api,
}) => {
  const rejected = await api.put('options/yaml', jsonString(invalid))
  expect(rejected.status()).toBe(400)
  expect(typeof (await rejected.json())).toBe('string')

  const text = `${configYaml}# Saved by a test\n`
  expect((await api.put('options/yaml', jsonString(text))).status()).toBe(200)
  expect(await readFile(slskd.configFile, 'utf8')).toBe(text)
  // With the config watch off, as in the harness, any save is only applied by a restart.
  const state = schemas.parse(schemas.state, await (await api.get('application')).json())
  expect(state.pendingRestart).toBe(true)
})

test('the debug view is a JSON string, since debug was on at startup', async ({ api }) => {
  expect(typeof (await (await api.get('options/debug')).json())).toBe('string')
})

test.describe('without remote configuration', () => {
  test.use({ config: { features: false } })

  test('the file and the debug view are refused', async ({ api }) => {
    expect((await api.get('options/yaml')).status()).toBe(403)
    expect((await api.post('options/yaml/validate', jsonString(configYaml))).status()).toBe(403)
    expect((await api.put('options/yaml', jsonString(configYaml))).status()).toBe(403)
    expect((await api.get('options/debug')).status()).toBe(403)
  })
})
