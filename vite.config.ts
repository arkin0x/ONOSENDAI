import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveVersion, UNVERSIONED } from './src/lib/version'
import { TV_CARD, withCard } from './src/lib/routeCard'

/** tv.html: the built page with Cyberspace TV's link preview, served at /tv (src/lib/routeCard.ts). */
function routeCards(): Plugin {
  return {
    name: 'onosendai-route-cards',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const page = bundle['index.html']
      if (!page || page.type !== 'asset') throw new Error('routeCards: no index.html in the bundle')
      this.emitFile({ type: 'asset', fileName: 'tv.html', source: withCard(String(page.source), TV_CARD) })
    },
  }
}

/**
 * The composer's WebGL2 check, answered without a throwaway context.
 * @react-three/postprocessing's EffectComposer asks three-stdlib's
 * isWebGL2Available() whether it may multisample, and that creates a canvas
 * and a whole second WebGL2 context just to ask, then loses it: a long task
 * at boot (about 300 ms in a headless profile; on Windows a context is an
 * ANGLE/D3D device). The answer is already known when it asks: three r163 and
 * later render with WebGL2 only, and the composer mounts inside a running
 * renderer. Build only; the dev server pre-bundles the package, so it keeps
 * the check, which costs nothing there worth saving (2026-10-20).
 */
function composerKnowsWebGL2(): Plugin {
  const CALL = 'const webGL2Available = isWebGL2Available();'
  return {
    name: 'onosendai-composer-webgl2',
    apply: 'build',
    transform(code, id) {
      if (!/@react-three[\\/]postprocessing[\\/]dist[\\/]EffectComposer\.js$/.test(id)) return null
      if (!code.includes(CALL)) {
        this.warn('composerKnowsWebGL2: EffectComposer no longer calls isWebGL2Available() as expected; the throwaway WebGL2 context is back')
        return null
      }
      return { code: code.replace(CALL, 'const webGL2Available = true;'), map: null }
    },
  }
}

/** The subject of the commit being built: Vercel's variable, else git's. */
function commitMessage(): string | null {
  if (process.env.VERCEL_GIT_COMMIT_MESSAGE) return process.env.VERCEL_GIT_COMMIT_MESSAGE
  try { return execSync('git log -1 --format=%s', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
}

export default defineConfig(async () => ({
  plugins: [react(), routeCards(), composerKnowsWebGL2()],
  define: {
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
}))
