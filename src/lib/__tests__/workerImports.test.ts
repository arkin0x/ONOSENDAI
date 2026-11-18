/**
 * workerImports.test.ts: the page never imports a worker module for a value.
 *
 * A worker module sets `self.onmessage` when it runs. Imported by the page
 * for a constant, it runs on the page too, where `self` is the window: the
 * terrain worker's handler then answered every window message by posting one
 * back to the window, so a single message from anything started a loop of
 * about 30,000 messages a second for the life of the tab, hidden or not, and
 * its garbage froze the page in long GCs (arkinox, 2026-11-19, 7 GB within 30
 * seconds of opening). Types are fine (`import type` is erased); anything the
 * page and a worker share lives in lib/ (lib/terrainUnknown.ts).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', '..')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) { if (name !== '__tests__') out.push(...sources(path)); continue }
    if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

/** Every import or re-export statement of a file, whole (they can span lines), with what it names and where from. */
function imports(text: string): Array<{ statement: string; from: string; typeOnly: boolean }> {
  const out: Array<{ statement: string; from: string; typeOnly: boolean }> = []
  const re = /^(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*['"]([^'"]+)['"]|^import\s*['"]([^'"]+)['"]/gm
  for (let m; (m = re.exec(text));) {
    const from = m[4] ?? m[5]
    const names = m[3] ?? ''
    // `import type { A }`, or `import { type A, type B }`: erased, nothing runs.
    const inlineTypesOnly = /^\{[\s\S]*\}$/.test(names.trim()) && names.replace(/[{}\s]/g, '').split(',').filter(Boolean).every((n) => /^type\s/.test(n.trim()) || n.trim().startsWith('type'))
    out.push({ statement: m[0], from, typeOnly: m[2] !== undefined || (names.length > 0 && inlineTypesOnly) })
  }
  return out
}

const isWorkerPath = (from: string): boolean => /(^|\/)workers\/[^/]+\.worker(\.ts)?$/.test(from)

describe('the page imports no worker module for a value', () => {
  it('only types come from workers/*.worker.ts outside src/workers', () => {
    const bad: string[] = []
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file)
      if (rel.startsWith('workers/')) continue
      for (const i of imports(readFileSync(file, 'utf8'))) {
        if (isWorkerPath(i.from) && !i.typeOnly) bad.push(`${rel}: ${i.statement.replace(/\s+/g, ' ')}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('the scan sees a value import, and lets a type import through', () => {
    expect(imports("import { UNKNOWN } from '../workers/terrain.worker'\n").map((i) => [isWorkerPath(i.from), i.typeOnly])).toEqual([[true, false]])
    expect(imports("import type { RunRequest } from '../workers/terrain.worker'\n").map((i) => i.typeOnly)).toEqual([true])
    expect(imports("import {\n  type RunRequest,\n  type RunResponse,\n} from '../workers/terrain.worker'\n").map((i) => i.typeOnly)).toEqual([true])
    expect(imports("import { type RunRequest, UNKNOWN } from '../workers/terrain.worker'\n").map((i) => i.typeOnly)).toEqual([false])
    expect(imports("import '../workers/terrain.worker'\n").map((i) => [isWorkerPath(i.from), i.typeOnly])).toEqual([[true, false]])
  })
})

describe('the terrain view leaves the window\'s messages alone', () => {
  afterEach(() => { (globalThis as { onmessage?: unknown }).onmessage = null })

  it('importing the terrain volume and its point field installs no message handler on the page', async () => {
    // On a page `self` is the window; a worker module run here would set its handler on it.
    ;(globalThis as { self?: unknown }).self ??= globalThis
    ;(globalThis as { onmessage?: unknown }).onmessage = null
    await import('../../hooks/useTerrainVolume')
    await import('../../scene/ShaderPointField')
    expect((globalThis as { onmessage?: unknown }).onmessage ?? null).toBeNull()
  }, 60_000)
})
