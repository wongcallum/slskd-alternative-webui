import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests',
  forbidOnly: process.env.CI !== undefined,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    launchOptions: { executablePath: process.env.CHROMIUM },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'contract', testDir: 'tests/contract' },
    { name: 'ui', testDir: 'tests/ui' },
  ],
})
