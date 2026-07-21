import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // cyberspace-core is a file: dependency, so it resolves through a symlink.
  // Excluding it from pre-bundling keeps edits to the core package live in dev
  // instead of being frozen into an optimized bundle.
  optimizeDeps: {
    exclude: ['cyberspace-core'],
  },
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
})
