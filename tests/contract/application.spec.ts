import { expect, test } from '../fixtures'
import { openHub } from '../hub'
import { timeZone } from '../slskd'
import * as schemas from './schemas'

test('the state comes over REST, and from the application hub as it connects', async ({ slskd, api, token }) => {
  schemas.parse(schemas.state, await (await api.get('application')).json())
  const hub = await openHub(slskd, 'application', token, ['STATE', 'OPTIONS'])
  try {
    await expect.poll(() => hub.received('STATE').length).toBeGreaterThan(0)
    const pushed = schemas.parse(schemas.state, hub.received('STATE')[0])
    expect(pushed.server.isLoggedIn).toBe(false)
    await expect.poll(() => hub.received('OPTIONS').length).toBeGreaterThan(0)
    schemas.parse(schemas.options, hub.received('OPTIONS')[0])
  } finally {
    await hub.stop()
  }
})

test('the options come over REST, and the startup options say whether debug is on', async ({ api }) => {
  schemas.parse(schemas.options, await (await api.get('options')).json())
  expect(await (await api.get('options/startup')).json()).toMatchObject({ debug: true })
})

test('process metrics come as JSON when asked for it alone', async ({ api }) => {
  const response = await api.get('telemetry/metrics', { headers: { Accept: 'application/json' } })
  schemas.parse(schemas.processMetrics, await response.json())
})

test('the metrics hub sends transfer counts as it connects', async ({ slskd, token }) => {
  const hub = await openHub(slskd, 'metrics', token, ['Update'])
  try {
    await expect.poll(() => hub.received('Update').length).toBeGreaterThan(0)
    schemas.parse(schemas.metrics, hub.received('Update')[0])
  } finally {
    await hub.stop()
  }
})

test('logs come over REST, and from the logs hub as a buffer and then one at a time', async ({ slskd, api, token }) => {
  const logs = schemas.parse(schemas.logs, await (await api.get('logs')).json())
  expect(logs.length).toBeGreaterThan(0)
  // They're in slskd's local time, which shows the harness put slskd in its zone.
  expect(logs.every((log) => log.timestamp.endsWith(timeZone.offset))).toBe(true)
  const hub = await openHub(slskd, 'logs', token, ['BUFFER', 'LOG'])
  try {
    await expect.poll(() => hub.received('BUFFER').length).toBe(1)
    expect(schemas.parse(schemas.logs, hub.received('BUFFER')[0]).length).toBeGreaterThan(0)
    // Failing to search while disconnected is logged.
    await api.post('searches', { data: { searchText: 'logged' } })
    await expect.poll(() => hub.received('LOG').length).toBeGreaterThan(0)
    schemas.parse(schemas.logs, hub.received('LOG'))
  } finally {
    await hub.stop()
  }
})
