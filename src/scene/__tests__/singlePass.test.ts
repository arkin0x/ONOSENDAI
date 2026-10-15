import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every transparent DoubleSide material sets forceSinglePass.
 *
 * Without it three draws the material twice a frame, back then front, and
 * flips `side` with `needsUpdate = true` around each pass, so every such
 * object costs two shader program lookups a frame that allocate. With ~150
 * shards around, that was ~106 KB of garbage a frame, about a gigabyte a
 * minute at a 144 Hz desktop refresh (arkinox's 10 GB Windows tabs,
 * 2026-10-14). A material that deliberately keeps the two passes says so
 * with `forceSinglePass={...}` (a condition) or a `two passes:` comment.
 */
const roots = ['src/scene', 'src/workshop']

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name)
    if (d.isDirectory()) return d.name === '__tests__' ? [] : files(p)
    return /\.tsx?$/.test(d.name) ? [p] : []
  })
}

describe('transparent DoubleSide materials draw in one pass', () => {
  it('every one sets forceSinglePass', () => {
    const offenders: string[] = []
    for (const f of roots.flatMap(files)) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/side(=\{[^}]*|:\s*)DoubleSide/g)) {
        // The material's own declaration: a JSX element (from its "<" to its
        // close) or an object literal (from its "({" to its "})").
        const at = m.index ?? 0
        const open = Math.max(src.lastIndexOf('<', at), src.lastIndexOf('({', at))
        const closes = [src.indexOf('/>', at), src.indexOf('})', at)].filter((x) => x >= 0)
        const decl = src.slice(open, Math.min(...closes) + 2)
        if (!/transparent/.test(decl)) continue
        if (/forceSinglePass|two passes:/.test(decl)) continue
        offenders.push(`${f}:${src.slice(0, at).split('\n').length}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
