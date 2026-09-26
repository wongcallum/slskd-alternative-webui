import { readFile } from 'node:fs/promises'

import { contextFor, expect, jsonString, test } from '../fixtures'
import { openHub } from '../hub'
import { configYaml, logIn, sleep, start } from '../slskd'
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

test.describe('with the config watch on', () => {
  test('a saved change is applied and pushed, asking for a rescan or restart where it needs one, while a comment changes nothing', async () => {
    const slskd = await start({}, { SLSKD_NO_CONFIG_WATCH: 'false' })
    const api = await contextFor(slskd)
    const hub = await openHub(slskd, 'application', await logIn(slskd), ['STATE', 'OPTIONS'])
    try {
      const pushedOptions = () => hub.received('OPTIONS').map((each) => schemas.parse(schemas.options, each))
      const latest = () => schemas.parse(schemas.state, hub.received('STATE').at(-1))
      const save = async (text: string) => expect((await api.put('options/yaml', jsonString(text))).status()).toBe(200)
      await expect.poll(() => pushedOptions().length).toBe(1)

      await save(`${configYaml}# A comment\n`)
      // slskd reloads about 250 ms after a save.
      await sleep(1000)
      expect(pushedOptions()).toHaveLength(1)
      expect(latest()).toMatchObject({ pendingRestart: false, shares: { scanPending: false } })

      await save(`${configYaml}shares:\n  filters:\n    - '\\.txt$'\n`)
      await expect.poll(() => pushedOptions().at(-1)?.shares.filters).toEqual(['\\.txt$'])
      await expect.poll(() => latest().shares.scanPending).toBe(true)
      expect(latest().pendingRestart).toBe(false)

      await save('instance_name: renamed\n')
      await expect.poll(() => latest().pendingRestart).toBe(true)
    } finally {
      await hub.stop()
      await api.dispose()
      await slskd.stop()
    }
  })
})
