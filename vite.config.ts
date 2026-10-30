/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveVersion, UNVERSIONED } from './src/lib/version'
import { ROUTE_PAGES, withCard } from './src/lib/routeCard'
import { VERSION_FILE, versionFileOf } from './src/lib/chainEpoch'

/** tv.html and workshop.html: the built page with each route's link preview, served at /tv and /workshop (src/lib/routeCard.ts). */
function routeCards(): Plugin {
  return {
    name: 'onosendai-route-cards',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const page = bundle['index.html']
      if (!page || page.type !== 'asset') throw new Error('routeCards: no index.html in the bundle')
      for (const [fileName, card] of ROUTE_PAGES) this.emitFile({ type: 'asset', fileName, source: withCard(String(page.source), card) })
    },
  }
}

/**
 * The composer's WebGL2 check, answered without a throwaway context.
 * @react-three/postprocessing's EffectComposer asks three-stdlib's
 * isWebGL2Available() whether it may multisample, and that creates a canvas
 * and a whole second WebGL2 context just to ask, then loses it: a long task
 * at boot (about 300 ms in an earlier headless profile; on Windows a context
 * is an ANGLE/D3D context). The answer is already known when it asks: three
 * r163 and later render with WebGL2 only, and the composer mounts inside a
 * running renderer (arkinox, 2026-10-20: the laptop "still isn't great").
 *
 * Build only: in dev the package is pre-bundled, out of reach of transforms,
 * and one probe per page load is fine there. A dependency upgrade that moves
 * or changes the line only warns, deliberately: it costs speed, never
 * correctness, so it should not block a deploy.
 */
function composerKnowsWebGL2(): Plugin {
  const CALL = 'const webGL2Available = isWebGL2Available();'
  let replaced = false
  return {
    name: 'onosendai-composer-webgl2',
    apply: 'build',
    transform(code, id) {
      if (!/@react-three[\\/]postprocessing[\\/]dist[\\/]EffectComposer\.js$/.test(id)) return null
      if (!code.includes(CALL)) return null
      replaced = true
      return { code: code.replace(CALL, 'const webGL2Available = true;'), map: null }
    },
    buildEnd(error) {
      // A build that failed before reaching the composer has a real error to read.
      if (!error && !replaced) this.warn('composerKnowsWebGL2: never found isWebGL2Available() in @react-three/postprocessing\'s EffectComposer.js; the throwaway WebGL2 context is back. Update or remove this plugin.')
    },
  }
}

/**
 * version.json: the build id and the chain epoch this deploy requires, which
 * every open tab reads to learn whether it may still move (src/lib/chainEpoch.ts,
 * src/lib/versionGate.ts). Emitted beside index.html by the build and served
 * by the dev server, so both answer the way a deploy does. vercel.json keeps
 * it out of every cache.
 */
function versionFile(build: string): Plugin {
  const source = `${JSON.stringify(versionFileOf(build))}\n`
  return {
    name: 'onosendai-version-file',
    configureServer(server) {
      server.middlewares.use(`/${VERSION_FILE}`, (_req, res) => {
        res.setHeader('content-type', 'application/json')
        res.setHeader('cache-control', 'no-store')
        res.end(source)
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: VERSION_FILE, source })
    },
  }
}

/** The commit being built, which is the build's id: Vercel's variable, else git's, else "dev". */
function buildId(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA
  try { return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'dev' } catch { return 'dev' }
}

/** The subject of the commit being built: Vercel's variable, else git's. */
function commitMessage(): string | null {
  if (process.env.VERCEL_GIT_COMMIT_MESSAGE) return process.env.VERCEL_GIT_COMMIT_MESSAGE
  try { return execSync('git log -1 --format=%s', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
}

const BUILD = process.env.VITEST ? 'test' : buildId()

export default defineConfig(async () => ({
  plugins: [react(), routeCards(), composerKnowsWebGL2(), versionFile(BUILD)],
  define: {
    // The same id version.json names, so a tab can tell a newer deploy from its own.
    __ONOSENDAI_BUILD__: JSON.stringify(BUILD),
    // Tests never reach the network for a number; the build and the dev
    // server ask GitHub once (see src/lib/version.ts).
    __ONOSENDAI_VERSION__: JSON.stringify(process.env.VITEST ? UNVERSIONED : await resolveVersion(process.env, commitMessage())),
  },
  // cyberspace-core is a file: dependency, so it resolves through a symlink.
  // Excluding it from pre-bundling keeps edits to the core package live in dev
  // instead of being frozen into an optimized bundle.
  optimizeDeps: {
    exclude: ['cyberspace-core'],
  },
  build: {
    target: 'es2022',
    // Add build hash to filenames for cache busting
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    // Tests never touch a live relay: a WebSocket opened in one fails it (src/test/noNetwork.ts).
    setupFiles: ['src/test/noNetwork.ts'],
    // HOSAKA, in tests, is one that cannot be reached (src/test/noNetwork.ts
    // answers it so, without a connection): every move is routed locally, as
    // the app does when HOSAKA is down, and nothing asks the real one.
    env: { VITE_HOSAKA_URL: 'http://127.0.0.1:9' },
  },
}))
