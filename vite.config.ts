import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveVersion, UNVERSIONED } from './src/lib/version'

/** The subject of the commit being built: Vercel's variable, else git's. */
function commitMessage(): string | null {
  if (process.env.VERCEL_GIT_COMMIT_MESSAGE) return process.env.VERCEL_GIT_COMMIT_MESSAGE
  try { return execSync('git log -1 --format=%s', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
}

export default defineConfig(async () => ({
  plugins: [react()],
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
