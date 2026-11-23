/**
 * stampLibrary.test.tsx: STAMP's library (owner, 2026-11-23): COPY and LINK
 * as a pair at the top, COPY lit by default; your whole workshop library in
 * the Shard Feed's rows (80px chamfered pictures); at the bottom the fullness
 * bar with what one stamp adds, SNAP with its printed key, and STAMP IT.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { newShard, type ShardModel } from 'sno-core/shards'
import { toModel } from 'sno-core/snoPalette'
import { useWorkshop } from '../../store/useWorkshop'
import { useCyberspace } from '../../store/useCyberspace'
import { useShardFolders } from '../../store/useShardFolders'
import { bakeSource } from '../../lib/stampCopy'
import { StampLibrary, snapLabel } from '../StampLibrary'

const PK = 'e'.repeat(64)
const RED = toModel([200, 30, 40])
const tile = (name: string): ShardModel => ({ ...newShard(name), mode: 'solid', extent: 9, vertices: [[-8, 0, -8], [8, 0, -8], [8, 0, 8]].map((p) => ({ p: p as [number, number, number], c: RED })), faces: [[0, 1, 2]] })
const w = () => useWorkshop.getState()
const html = (): string => {
  // A server render reads each store's initial state (as hud/__tests__/shardFoldersList does).
  Object.assign(useWorkshop.getInitialState(), useWorkshop.getState())
  Object.assign(useCyberspace.getInitialState(), useCyberspace.getState())
  Object.assign(useShardFolders.getInitialState(), useShardFolders.getState())
  return renderToStaticMarkup(<StampLibrary onClose={() => {}} />)
}

beforeEach(() => {
  useCyberspace.setState((s) => ({ identity: { ...s.identity, pubkey: PK } }))
  const a = tile('Ridge'), b = tile('Valley')
  useWorkshop.setState({ shards: [a, b], currentId: b.id, stampForm: 'copy', stampObject: null, stampSnap: true, stampFacing: 0, plane: 1, level: 0 })
})

describe('StampLibrary', () => {
  it('has COPY and LINK as a pair at the top, COPY lit by default', () => {
    const h = html()
    expect(h).toContain('role="radiogroup" aria-label="How it is stamped"')
    expect(h).toMatch(/aria-checked="true" class="stamplib__form is-on"><span class="stamplib__form-head">.*?<b>COPY<\/b>/)
    expect(h).toMatch(/aria-checked="false" class="stamplib__form"><span class="stamplib__form-head">.*?<b>LINK<\/b>/)
  })

  it('lists the whole library with 80px chamfered pictures, as the Shard Feed does', () => {
    const h = html()
    expect(h).toContain('Ridge')
    expect(h).toContain('Valley')
    expect(h).toContain('class="chamfer stamplib__thumb" style="--chamfer-size:80px"')
  })

  it('under LINK, never offers the open shard to place itself, and says what each will be', () => {
    w().setStampForm('link')
    const h = html()
    expect(h).toContain('THIS SHARD')
    expect(h).toContain('NOT PUBLISHED: SEALED WITH YOUR HIDE')
    expect(h).toContain('by address')
  })

  it('keeps the bar, SNAP with its key and STAMP IT at the bottom, waiting for a choice', () => {
    const h = html()
    expect(h).toContain('class="stamplib__foot"')
    expect(h).toContain('role="meter"')
    expect(h).toContain('Choose a shard to see what it adds.')
    expect(h).toMatch(/SNAP: GRID<\/span><kbd class="ws__key" aria-hidden="true">G<\/kbd>/)
    expect(h).toMatch(/<button class="stamplib__act stamplib__act--go" disabled=""/)
  })

  it('shows what one stamp of the chosen shard adds, and its size to snap by', () => {
    const s = w().shards[0]
    const copy = bakeSource(s, [])!
    w().setStampObject({ ref: ['a', `33331:${PK}:${s.id}`], name: s.name, shard: s, copy, size: { min: copy.min!, max: copy.max!, unit: 0 }, local: true })
    const h = html()
    expect(h).toContain('data-testid="fullbar-next"')
    expect(h).toContain('SNAP: 16 × 16')
    expect(h).not.toMatch(/<button class="stamplib__act stamplib__act--go" disabled=""/)
  })

  it('labels the snap by the two axes of the working plane', () => {
    expect(snapLabel([1920, 0, 960], 1)).toBe('16 × 8')
    expect(snapLabel([1920, 960, 0], 2)).toBe('16 × 8')
    expect(snapLabel(null, 1)).toBe('GRID')
  })

  it('has no em dash, and uses lucide icons rather than emoji', () => {
    const src = readFileSync(join(__dirname, '..', 'StampLibrary.tsx'), 'utf8')
    expect(src).not.toContain('—')
    expect(src).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
    expect(src).toContain("from 'lucide-react'")
  })
})
