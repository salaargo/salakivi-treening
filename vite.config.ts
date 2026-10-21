import fs from 'node:fs'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'

function bundleKell(env: Record<string, string>, minify: boolean): Uint8Array {
  const result = esbuild.buildSync({
    entryPoints: [path.resolve('src/kell-app.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2015'],
    write: false,
    minify,
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || ''),
      'import.meta.env.BASE_URL': JSON.stringify(env.VITE_BASE_PATH || process.env.VITE_BASE_PATH || '/'),
      'import.meta.env.DEV': minify ? 'false' : 'true',
      'import.meta.env.PROD': minify ? 'true' : 'false',
      'import.meta.env.MODE': JSON.stringify(minify ? 'production' : 'development'),
    },
  })
  const file = result.outputFiles[0]
  if (!file) throw new Error('kell.js bundle missing')
  return file.contents
}

function kellVersion(): string {
  return (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 12)
}

function kellPlugin(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '')
  const template = () =>
    fs
      .readFileSync(path.resolve('kell.template.html'), 'utf8')
      .replaceAll('__KELL_V__', kellVersion())

  return {
    name: 'salakivi-kell',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const urlPath = req.url?.split('?')[0]
        if (urlPath === '/kell.html' || urlPath === '/kell.html/') {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(template())
          return
        }
        if (urlPath === '/kell.js') {
          try {
            const js = bundleKell(env, false)
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
            res.end(Buffer.from(js))
          } catch (err) {
            res.statusCode = 500
            res.end(err instanceof Error ? err.message : 'kell.js build failed')
          }
          return
        }
        next()
      })
    },
    closeBundle() {
      const dist = path.resolve('dist')
      fs.mkdirSync(dist, { recursive: true })
      fs.writeFileSync(path.join(dist, 'kell.html'), template())
      fs.writeFileSync(path.join(dist, 'kell.js'), Buffer.from(bundleKell(env, true)))
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), kellPlugin(mode)],
  server: {
    host: true,
    port: 43173,
  },
}))
