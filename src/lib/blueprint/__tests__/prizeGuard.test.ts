/**
 * prizeGuard.test.ts - the owner's kits never become a blueprint's prize: a
 * kit piece is barred whatever is said, an object never published is left
 * out unless included by hand, an object carrying kit or unpublished pieces
 * is barred, and published objects are fine. A zip import with PUBLISH off
 * marks what it brings in.
 */

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size }, clear: () => m.clear(), getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null, removeItem: (k: string) => { m.delete(k) }, setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

import { BAR_WORDS, includedPrizes, kitPieces, markKitPieces, prizeBar, setIncluded, type GuardInput } from '../prizeGuard'
import { prizeAllowed } from '../../../hud/blueprint/BlueprintTool'

const me = 'a'.repeat(64)
const other = 'b'.repeat(64)
const g = (over: Partial<GuardInput> = {}): GuardInput => ({ me, ledger: { pub: { at: 1, fp: '', pubkey: me } }, kit: new Set(['sample-kit/piece-a']), included: new Set(), ...over })

describe('which objects may be prizes', () => {
  it('a kit piece never is, even included by hand or published', () => {
    const kit = { id: 'sample-kit/piece-a' }
    expect(prizeBar(kit, g())).toBe('kit')
    expect(prizeBar(kit, g({ included: new Set([kit.id]), ledger: { [kit.id]: { at: 1, fp: '', pubkey: me } } }))).toBe('kit')
    expect(prizeAllowed(kit as never, 'workshop', g())).toBe(false)
    expect(prizeAllowed(kit as never, 'items', g())).toBe(false)
  })

  it('an object never published is left out until included; a published one is fine', () => {
    expect(prizeBar({ id: 'mine-new' }, g())).toBe('unpublished')
    expect(prizeBar({ id: 'mine-new' }, g({ included: new Set(['mine-new']) }))).toBeNull()
    expect(prizeBar({ id: 'pub' }, g())).toBeNull()
    // Published under another key is not published by you.
    expect(prizeBar({ id: 'pub' }, g({ ledger: { pub: { at: 1, fp: '', pubkey: other } } }))).toBe('unpublished')
  })

  it('an object carrying kit pieces, or your pieces never published, is barred; carrying someone else\'s is fine', () => {
    expect(prizeBar({ id: 'pub', objects: { [`33331:${me}:sample-kit/piece-a`]: {} } } as never, g())).toBe('carries')
    expect(prizeBar({ id: 'pub', objects: { [`33331:${me}:secret-piece`]: {} } } as never, g())).toBe('carries')
    expect(prizeBar({ id: 'pub', objects: { [`33331:${other}:their-piece`]: {} } } as never, g())).toBeNull()
  })

  it('a shard from ITEMS came from a bag or a chest: only kit marks bar it', () => {
    expect(prizeAllowed({ id: 'from-a-chest' } as never, 'items', g())).toBe(true)
    expect(prizeAllowed({ id: 'from-a-chest' } as never, 'workshop', g())).toBe(false)
  })

  it('marks and includes are kept on the device; a kit piece cannot be included', () => {
    markKitPieces(['kit-a/one'])
    expect(kitPieces().has('kit-a/one')).toBe(true)
    setIncluded('kit-a/one', true)
    expect(includedPrizes().has('kit-a/one')).toBe(false)
    setIncluded('loose', true)
    expect(includedPrizes().has('loose')).toBe(true)
    setIncluded('loose', false)
    expect(includedPrizes().has('loose')).toBe(false)
    expect(BAR_WORDS.kit).toMatch(/never a prize/)
  })

  it('a zip import with PUBLISH off marks what it brings in as kit pieces', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'store', 'useShardImport.ts'), 'utf8')
    expect(src).toMatch(/if \(get\(\)\.noun === 'zip' && !publish\) markKitPieces\(\[id\]\)/)
  })
})
