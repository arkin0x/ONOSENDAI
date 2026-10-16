/**
 * shell.ts - the build step that writes /sw.js (see src/offline/sw.js).
 *
 * The service worker's file list is every file the build writes plus every
 * file in public/, less the few nobody needs offline (EXCLUDED). The build id
 * starts with the build time in base 36, so ids sort by age, which is how the
 * worker decides which old cache to keep.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { Plugin } from 'vite'

/** Only for link previews, never drawn by the app. */
export const EXCLUDED = new Set(['/og.png', '/sw.js'])

/** Site paths of every file under `dir`, as /a/b.ext. */
export function filesUnder(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else out.push('/' + relative(dir, p).split(sep).join('/'))
    }
  }
  try { walk(dir) } catch { /* no public dir */ }
  return out
}

/** The worker's file list: sorted, unique, without the excluded, with index.html first. */
export function precacheList(bundleFiles: string[], publicFiles: string[]): string[] {
  const all = new Set([...bundleFiles.map((f) => '/' + f.replace(/^\/+/, '')), ...publicFiles])
  EXCLUDED.forEach((f) => all.delete(f))
  all.delete('/index.html')
  return ['/index.html', ...Array.from(all).sort()]
}

/** The worker's source with the build id and file list filled in. */
export function renderWorker(template: string, build: string, files: string[]): string {
  return template
    .replace("'__ONOSENDAI_BUILD__'", JSON.stringify(build))
    .replace('__ONOSENDAI_FILES__', JSON.stringify(files))
}

export function offlineShell(): Plugin {
  let publicDir = ''
  return {
    name: 'onosendai-offline-shell',
    apply: 'build',
    configResolved(config) { publicDir = config.publicDir },
    generateBundle(_options, bundle) {
      const files = precacheList(Object.keys(bundle), filesUnder(publicDir))
      const build = `${Date.now().toString(36)}-${(Math.random() * 2 ** 32 >>> 0).toString(36)}`
      const template = readFileSync(new URL('./sw.js', import.meta.url), 'utf8')
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: renderWorker(template, build, files) })
    },
  }
}
