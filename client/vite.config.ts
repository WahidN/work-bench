import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST

/*
 * Reads the engine's bearer token the same way engine/src/keychain.ts does.
 *
 * This runs in the Vite dev server, which is node, so the token stays on the node side
 * and is injected into the proxied request's headers. It never reaches browser JS.
 *
 * Why the proxy exists at all: probe 1 established that a Tauri window has no CDP
 * endpoint, so UI work has to be verified against the dev server in Chrome. In Chrome
 * there is no `invoke`, and the engine sends no CORS headers, so without this the
 * screens could only be checked inside a window that cannot be driven. Dev only: the
 * built app routes every request through Rust instead.
 */
function engineToken(): string | null {
  try {
    return execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'workbench', '-a', 'api-token', '-w'],
      { encoding: 'utf8' },
    ).trim()
  } catch {
    return null
  }
}

export default defineConfig(async () => {
  const token = engineToken()
  if (!token) {
    console.warn('[spike] no engine token in the keychain, /engine proxy will return 401')
  }

  return {
    plugins: [react()],

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: 'ws',
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ['**/src-tauri/**'],
      },
      proxy: {
        '/engine': {
          target: 'http://127.0.0.1:4173',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/engine/, ''),
          configure: (proxy: {
            on: (event: string, handler: (proxyRequest: { setHeader: (name: string, value: string) => void }) => void) => void
          }) => {
            proxy.on('proxyReq', (proxyRequest) => {
              if (token) proxyRequest.setHeader('authorization', `Bearer ${token}`)
            })
          },
        },
      },
    },
  }
})
