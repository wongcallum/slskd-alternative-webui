import { readFile } from 'node:fs/promises'

import { effectiveYaml } from '../../src/system/options/effective'
import type { Settings } from '../../src/system/options/options'
import { contextFor, expect, jsonString, test } from '../fixtures'
import { openHub } from '../hub'
import { configYaml, logIn, start } from '../slskd'
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

test('the effective options, with the keys named as the Options page names them, are a file the validator accepts', async ({
  api,
}) => {
  // Redacted secrets would fail the JWT key's minimum length of 32.
  const redacted = JSON.stringify(await (await api.get('options')).json())
  const settings = JSON.parse(redacted.replaceAll('"*****"', JSON.stringify('x'.repeat(32)))) as Settings
  const response = await api.post('options/yaml/validate', jsonString(effectiveYaml(settings)))
  expect(await response.text()).toBe('')
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

test('the debug view is a JSON string only if the startup options say debug was on', async ({ api }) => {
  expect(await (await api.get('options/startup')).json()).toMatchObject({ debug: true })
  expect(typeof (await (await api.get('options/debug')).json())).toBe('string')

  const slskd = await start({}, { SLSKD_DEBUG: 'false' })
  const off = await contextFor(slskd)
  try {
    expect(await (await off.get('options/startup')).json()).toMatchObject({ debug: false })
    expect((await off.get('options/debug')).status()).toBe(403)
  } finally {
    await off.dispose()
    await slskd.stop()
  }
})

test.describe('with the config watch on', () => {
  test('a saved change is applied and pushed', async () => {
    const slskd = await start({}, { SLSKD_NO_CONFIG_WATCH: 'false' })
    const api = await contextFor(slskd)
    const hub = await openHub(slskd, 'application', await logIn(slskd), ['OPTIONS'])
    try {
      const pushedOptions = () => hub.received('OPTIONS').map((each) => schemas.parse(schemas.options, each))
      await expect.poll(() => pushedOptions().length).toBe(1)
      const text = `${configYaml}shares:\n  filters:\n    - '\\.txt$'\n`
      expect((await api.put('options/yaml', jsonString(text))).status()).toBe(200)
      await expect.poll(() => pushedOptions().at(-1)?.shares.filters).toEqual(['\\.txt$'])
    } finally {
      await hub.stop()
      await api.dispose()
      await slskd.stop()
    }
  })
})
