import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from '../fixtures'
import { dist } from '../slskd'

const html = { Accept: 'text/html' }

for (const urlBase of ['/slskd', '/']) {
  test.describe(`at ${urlBase}`, () => {
    test.use({ config: { urlBase } })

    test('the page is given the url base after it, and loads its assets from under it', async ({ request }) => {
      const response = await request.get('', { headers: html })
      expect(response.status()).toBe(200)
      const page = await response.text()
      const [, after] = page.split('</html>')
      expect(after).toContain(`window.urlBase=${JSON.stringify(urlBase)}`)
      const assets = [...page.matchAll(/(?:src|href)="([^"]+)"/g)].map(([, url]) => url!)
      expect(assets.length).toBeGreaterThan(1)
      for (const asset of assets) {
        expect(asset.startsWith(`${urlBase === '/' ? '' : urlBase}/static/`), asset).toBe(true)
        expect((await request.get(asset)).status(), asset).toBe(200)
      }
    })

    test('the inline theme script is served unchanged', async ({ request }) => {
      const built = await readFile(path.join(dist, 'index.html'), 'utf8')
      const script = /<script>([\s\S]*?)<\/script>/.exec(built)?.[1]
      expect(script).toBeDefined()
      expect(await (await request.get('', { headers: html })).text()).toContain(script)
    })

    test('lazily loaded chunks load from under the url base', async ({ request }) => {
      for (const file of await readdir(path.join(dist, 'static'))) {
        expect((await request.get(`static/${file}`)).status(), file).toBe(200)
      }
    })

    test('a deep link gets the page, with a dot in its search params', async ({ request }) => {
      for (const link of ['system/files', 'searches/0d2bc5a2-24c8-4b0e-a2c8-5ae2f6ca1b9b', 'browse?user=some.one']) {
        const response = await request.get(link, { headers: html })
        expect(response.status(), link).toBe(200)
        expect(await response.text(), link).toContain('window.urlBase=')
      }
    })
  })
}
