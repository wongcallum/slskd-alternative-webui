import path from 'node:path'

import { expect, test } from '../fixtures'
import { openHub } from '../hub'
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

test('the options name the directories and shares slskd was started with', async ({ slskd, api }) => {
  const options = schemas.parse(schemas.options, await (await api.get('options')).json())
  expect(options.remoteConfiguration).toBe(true)
  expect(options.remoteFileManagement).toBe(true)
  expect(options.directories).toEqual({ downloads: slskd.downloads, incomplete: slskd.incomplete })
  expect(options.shares.directories).toEqual([
    path.join(slskd.shares, 'Music'),
    `[Extra]${path.join(slskd.shares, 'Other')}`,
    `-${path.join(slskd.shares, 'Music/Private')}`,
  ])
  expect(await (await api.get('options/startup')).json()).toMatchObject({ debug: true })
})

test('process metrics come as JSON when asked for it alone', async ({ api }) => {
  const response = await api.get('telemetry/metrics', { headers: { Accept: 'application/json' } })
  const metrics = schemas.parse(schemas.processMetrics, await response.json())
  expect(metrics.process_start_time_seconds?.samples[0]?.value).toBeGreaterThan(0)
  expect(metrics.process_working_set_bytes?.samples[0]?.value).toBeGreaterThan(0)
  expect(Object.keys(metrics.dotnet_build_info?.samples[0]?.labels ?? {})).toEqual(
    expect.arrayContaining(['runtime_version', 'os_version', 'process_architecture']),
  )
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
  expect(schemas.parse(schemas.logs, await (await api.get('logs')).json()).length).toBeGreaterThan(0)
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
