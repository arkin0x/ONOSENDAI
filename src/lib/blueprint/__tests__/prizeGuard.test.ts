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

import { fromPayload, type ShardModel } from 'sno-core/shards'
import { BAR_WORDS, backfillKitPrints, includedPrizes, kitPieces, kitPrint, markKitPieces, prizeBar, setIncluded, type GuardInput } from '../prizeGuard'
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
    // By id and by the model's fingerprint (the whole model goes in, under its new id).
    expect(src).toMatch(/if \(get\(\)\.noun === 'zip' && !publish\) markKitPieces\(\[\{ \.\.\.model, id \}\], \{ later: true \}\)/)
  })
})

describe('the kit mark follows the model (review of #943, 2026-11-27)', () => {
  const piece = (id: string, name = 'Piece', k = 1): ShardModel => fromPayload({ v: 2, name, unit: 0, mode: 'solid', vertices: [[0, 0, 0], [k, 0, 0], [0, k, 0], [0, 0, k]], colors: Array(4).fill([200, 60, 60]), faces: [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] }, id)!
  const kitG = (kit: ReadonlySet<string>): GuardInput => g({ kit, ledger: {} })

  it('marked at import by id and fingerprint: the same model under any other id or name is barred', () => {
    markKitPieces([piece('kit-b/one')])
    const kit = kitPieces()
    expect(kit.has('kit-b/one')).toBe(true)
    expect(kit.has(kitPrint(piece('kit-b/one'))!)).toBe(true)
    // Renamed, under a new id: still the kit piece.
    expect(prizeBar(piece('some-other-id', 'Renamed'), kitG(kit))).toBe('kit')
    // Another model is not.
    const other = fromPayload({ v: 2, name: 'Mine', unit: 0, mode: 'solid', vertices: [[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2]], colors: Array(4).fill([10, 200, 60]), faces: [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] }, 'mine-1')!
    expect(prizeBar(other, kitG(kit))).toBe('unpublished')
  })

  it('ITEMS: a kit piece hidden in a chest and taken back, keyed by the bag item\'s event id, is never a prize, when picking or at SEAL', () => {
    markKitPieces([piece('kit-c/one')])
    const taken = piece('e'.repeat(64), 'Piece')
    expect(prizeAllowed(taken, 'items', kitG(kitPieces()))).toBe(false)
  })

  it('DUPLICATE: the copy is barred by its model, and still by its id once edited', async () => {
    const { useWorkshop } = await import('../../../store/useWorkshop')
    const src = piece('kit-d/one')
    markKitPieces([src])
    useWorkshop.setState({ shards: [src] })
    const copyId = useWorkshop.getState().duplicate(src.id)
    expect(copyId).not.toBe(src.id)
    const copy = useWorkshop.getState().shards.find((m) => m.id === copyId)!
    expect(prizeAllowed(copy, 'workshop', kitG(kitPieces()))).toBe(false)
    expect(prizeBar(copy, kitG(kitPieces()))).toBe('kit')
    // Edited (a face taken off): a different model, and the carried id mark still bars it.
    const edited: ShardModel = { ...copy, faces: copy.faces.slice(0, 3) }
    expect(kitPrint(edited)).not.toBe(kitPrint(copy))
    expect(prizeBar(edited, kitG(kitPieces()))).toBe('kit')
  })

  it.each([
    ['resized', { deployUnit: 3, deployTurn: [0, 0, 0] }],
    ['turned', { deployUnit: 0, deployTurn: [1, 2, 0] }],
    ['resized and turned, with up, spin and the WALK setting', { deployUnit: -2, deployTurn: [3, 1, 1], deployUp: true, deploySpin: 90, deployConstrain: 'all' }],
  ] as const)('a kit piece AIMed into a chest %s, then taken back into ITEMS, is never a prize', async (_name, bar) => {
    const { posedForDeploy } = await import('../../../store/useShards')
    const src = piece('kit-f/one', 'Piece', 7)
    markKitPieces([src])
    const posed = posedForDeploy(src, false, { deployUp: false, deploySpin: 0, deployConstrain: undefined, ...bar } as never, 0 as never, 0)
    expect(posed).not.toBe(src)
    // Back from a chest: the posed copy, under the bag item's event id.
    const taken = { ...posed, id: 'd'.repeat(64), name: 'Piece' }
    expect(kitPrint(taken)).toBe(kitPrint(src))
    expect(prizeAllowed(taken, 'items', kitG(kitPieces()))).toBe(false)
  })

  it('a different shape is not caught by the turn-free print', () => {
    expect(kitPrint(piece('a1', 'A', 2))).not.toBe(kitPrint(piece('a2', 'A', 3)))
  })

  it('kit pieces marked by id before fingerprints were kept get theirs from the workshop', () => {
    markKitPieces(['kit-e/one'])
    const old = piece('kit-e/one', 'Old', 5)
    expect(kitPieces().has(kitPrint(old)!)).toBe(false)
    backfillKitPrints([old, piece('not-kit')])
    expect(kitPieces().has(kitPrint(old)!)).toBe(true)
  })
})
