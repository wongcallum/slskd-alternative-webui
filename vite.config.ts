import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const urlBase = '/slskd'
const slskd = 'http://localhost:5030'

// In production slskd injects window.urlBase into index.html; the dev server has to do it itself.
const injectUrlBase: Plugin = {
  name: 'inject-url-base',
  apply: 'serve',
  transformIndexHtml: () => [
    { tag: 'script', children: `window.urlBase = ${JSON.stringify(urlBase)}`, injectTo: 'head-prepend' },
  ],
}

export default defineConfig(({ command }) => ({
  // The build must not know its url_base: slskd rewrites "./static" in index.html to "{urlBase}/static".
  base: command === 'serve' ? `${urlBase}/` : './',
  plugins: [react(), injectUrlBase],
  build: { assetsDir: 'static' },
  server: {
    strictPort: true,
    proxy: {
      [`${urlBase}/api`]: slskd,
      [`${urlBase}/hub`]: { target: slskd, ws: true },
    },
  },
}))
