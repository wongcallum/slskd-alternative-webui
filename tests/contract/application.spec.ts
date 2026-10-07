import type { APIRequestContext } from '@playwright/test'

import { contextFor, expect, jsonString, test } from '../fixtures'
import { openHub } from '../hub'
import { timeZone } from '../slskd'
import * as schemas from './schemas'

// slskd 0.26.0 has no logs/live, and the app falls back to logs on its 404.
async function logBuffer(api: APIRequestContext) {
  const live = await api.get('logs/live')
  return schemas.parse(schemas.logs, await (live.status() === 404 ? await api.get('logs') : live).json())
}

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
  const logs = await logBuffer(api)
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

test('a failed Soulseek connection is only explained in the log, until stopping cancels it', async ({ api }) => {
  const soulseekLogs = async () => (await logBuffer(api)).filter((log) => log.context === 'slskd.Application')
  const started = Date.now()
  try {
    await api.put('server')
    let failedAt = 0
    await expect
      .poll(async () => {
        const failed = (await soulseekLogs()).find(
          (log) =>
            Date.parse(log.timestamp) >= started - 1000 &&
            log.level === 'Error' &&
            log.message.startsWith('Failed to reconnect: "Username may not be null'),
        )
        failedAt = failed === undefined ? 0 : Date.parse(failed.timestamp)
        return failedAt
      })
      .toBeGreaterThan(0)
    await api.delete('server', jsonString('stopped by a test'))
    await expect
      .poll(async () =>
        (await soulseekLogs()).some(
          (log) => Date.parse(log.timestamp) >= failedAt && log.message === 'Reconnection attempt cancelled',
        ),
      )
      .toBe(true)
  } finally {
    await api.delete('server', jsonString('stopped by a test'))
  }
})

test.describe('a relay agent', () => {
  test.use({ config: { agent: true } })

  test('says it is one, connected to its controller, which lists it', async ({ slskd, api }) => {
    const controllerInstance = slskd.controller!
    const state = schemas.parse(schemas.state, await (await api.get('application')).json())
    expect(state.relay).toMatchObject({
      mode: 'Agent',
      controller: { address: controllerInstance.base, state: 'Connected' },
    })
    const controller = await contextFor(controllerInstance)
    try {
      const options = schemas.parse(schemas.options, await (await controller.get('options')).json())
      expect(options.relay.enabled).toBe(true)
      const controllerState = schemas.parse(schemas.state, await (await controller.get('application')).json())
      expect(controllerState.relay).toMatchObject({ mode: 'Controller', agents: [{ name: 'agent' }] })
    } finally {
      await controller.dispose()
    }
  })
})
