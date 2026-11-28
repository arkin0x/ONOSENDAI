/**
 * gameBlueprint.test.ts - the Compiler's own blueprint, granted once per
 * identity the first time it holds a block of a type in the recipe
 * (Ferrovein, Rustband or Glowcore), on a pickup or on load, kept per npub
 * in IndexedDB; every block revealed and the prize's pictures in it.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) }, clear: () => { mem.clear() }, key: () => null, get length() { return mem.size },
  }
}

import { useBlueprints } from '../../../store/useBlueprints'
import { useCyberspace } from '../../../store/useCyberspace'
import { useTerrain } from '../../../store/useTerrain'
import { noteInventory, resetInventorySync, setInventoryDeps } from '../../../store/inventorySync'
import { carriedInto, emptyInventory } from '../../terrain/terrainDb'
import { COMPILER_CARD_ID, COMPILER_KEY_HEX, COMPILER_LOOKUP, GAME_MAKER, QUARRY_CARD_ID, QUARRY_KEY_HEX, QUARRY_LOOKUP, QUARRY_TYPES, grantCompilerIfDue, grantQuarryIfDue, isGameCard, startCompilerGrant } from '../gameBlueprint'
import { isItemBlueprint } from '../itemMark'
import { readRecord, finderView } from '../format'
import { keyOf } from '../keyClient'
import { CINDERROCK, COMPILER_RECIPE, FERROVEIN, GLOWCORE, QUARRY_CHARGE_RECIPE, RUSTBAND, UMBERSLATE } from '../recipes'
import { openPrize } from '../format'
import { hexToBytes } from '../../events'
import { bytesToHex } from '../../events'

const pic = 'data:image/png;base64,iVBORw0KGgo='
const draw = async () => ({ iso: pic, z: pic })
let n = 0
const fresh = (): string => (++n).toString(16).padStart(64, 'a')
const as = async (pk: string): Promise<void> => {
  useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: pk } })
  await useBlueprints.getState().load(pk)
}
const has = (pk: string): boolean => useBlueprints.getState().cards.some((c) => c.rowKey === `${pk}/${COMPILER_CARD_ID}`)

describe('the Compiler blueprint, the game\'s gift', () => {
  it('its key and lookup are the recipe\'s, by the real derivation', async () => {
    const k = await keyOf(COMPILER_RECIPE)
    expect(bytesToHex(k.key)).toBe(COMPILER_KEY_HEX)
    expect(k.lookup).toBe(COMPILER_LOOKUP)
  }, 60_000)

  it.each([FERROVEIN, RUSTBAND, GLOWCORE])('the first block of type %i held grants it; nothing else does', async (id) => {
    const pk = fresh()
    await as(pk)
    expect(await grantCompilerIfDue(pk, { 1: 9 }, draw)).toBe(false)
    expect(has(pk)).toBe(false)
    expect(await grantCompilerIfDue(pk, { [id]: 1 }, draw)).toBe(true)
    expect(has(pk)).toBe(true)
  })

  it('is granted once: a second pickup changes nothing', async () => {
    const pk = fresh()
    await as(pk)
    expect(await grantCompilerIfDue(pk, { [FERROVEIN]: 1 }, draw)).toBe(true)
    expect(await grantCompilerIfDue(pk, { [FERROVEIN]: 2, [GLOWCORE]: 1 }, draw)).toBe(false)
    expect(useBlueprints.getState().cards.filter((c) => c.rowKey === `${pk}/${COMPILER_CARD_ID}`)).toHaveLength(1)
  })

  it('is kept per npub: another identity does not have it, and the first keeps it after switching back', async () => {
    const a = fresh(), b = fresh()
    await as(a)
    await grantCompilerIfDue(a, { [RUSTBAND]: 1 }, draw)
    await as(b)
    expect(has(b)).toBe(false)
    await as(a)
    expect(has(a)).toBe(true)
  })

  it('on load: an identity already holding a recipe block gets it as BLUEPRINTS loads', async () => {
    const pk = fresh()
    startCompilerGrant(draw)
    // The identity on screen and its TERRAIN inventory (already holding a Glowcore) come first; BLUEPRINTS loads after.
    useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: pk } })
    // The identity switch settles (TERRAIN starts that identity's inventory afresh) before its blocks are read in.
    await new Promise((r) => setTimeout(r, 50))
    useTerrain.setState({ inventory: { ...useTerrain.getState().inventory, counts: { [GLOWCORE]: 3 } } })
    expect(has(pk)).toBe(false)
    await useBlueprints.getState().load(pk)
    await vi.waitFor(() => expect(has(pk)).toBe(true), { timeout: 4000 })
  })

  it('every block revealed, the prize public with its pictures, by the game, never placed, an item blueprint', async () => {
    const pk = fresh()
    await as(pk)
    await grantCompilerIfDue(pk, { [FERROVEIN]: 1 }, draw)
    // (The watcher started above may have granted it first: either way it arrives once.)
    await vi.waitFor(() => expect(has(pk)).toBe(true), { timeout: 4000 })
    const card = useBlueprints.getState().cards.find((c) => c.rowKey === `${pk}/${COMPILER_CARD_ID}`)!
    expect(isGameCard(card)).toBe(true)
    expect(isItemBlueprint(card)).toBe(true)
    expect(card.record.pubkey).toBe(GAME_MAKER)
    const v = readRecord(card.record)!
    expect(v.title).toBe('The Compiler')
    expect(v.sheet.prize.reveal).toBe('render')
    expect(Object.keys(v.views).sort()).toEqual(['iso', 'z'])
    const f = finderView(v)
    expect(f.revealed.size).toBe(5)
    expect(f.occupied.filter(Boolean)).toHaveLength(5)
    expect(useBlueprints.getState().fresh.has(card.rowKey)).toBe(true)
  })
})

describe('a gift earned on another device (the inventory synced: store/inventorySync.ts)', () => {
  it('a recipe block collected anywhere, even spent since, grants it here as BLUEPRINTS loads', async () => {
    const pk = fresh()
    const m = new Map<string, string>()
    setInventoryDeps({ self: () => pk, storage: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) }, removeItem: (k) => { m.delete(k) } } })
    try {
      startCompilerGrant(draw)
      useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: pk } })
      await new Promise((r) => setTimeout(r, 50))
      useTerrain.setState({ inventory: emptyInventory() })
      // Collected and placed again: the bag holds none of it now, the record remembers.
      const one = carriedInto(emptyInventory(), FERROVEIN)
      noteInventory(pk, emptyInventory(), one)
      noteInventory(pk, one, emptyInventory())
      expect(useTerrain.getState().inventory.counts).toEqual({})
      await useBlueprints.getState().load(pk)
      await vi.waitFor(() => expect(has(pk)).toBe(true), { timeout: 4000 })
    } finally {
      resetInventorySync()
      setInventoryDeps(null)
    }
  })
})

const hasQuarry = (pk: string): boolean => useBlueprints.getState().cards.some((c) => c.rowKey === `${pk}/${QUARRY_CARD_ID}`)

describe('the Quarry Charge blueprint, granted the same way', () => {
  it('its key and lookup are the recipe\'s, by the real derivation', async () => {
    const k = await keyOf(QUARRY_CHARGE_RECIPE)
    expect(bytesToHex(k.key)).toBe(QUARRY_KEY_HEX)
    expect(k.lookup).toBe(QUARRY_LOOKUP)
  }, 60_000)

  it.each([UMBERSLATE, RUSTBAND, CINDERROCK, FERROVEIN])('the first block of type %i held grants it; nothing else does', async (id) => {
    expect(QUARRY_TYPES).toContain(id)
    const pk = fresh()
    await as(pk)
    // Gridstone and Glowcore are not in its recipe.
    expect(await grantQuarryIfDue(pk, { 1: 9, [GLOWCORE]: 2 }, draw)).toBe(false)
    expect(hasQuarry(pk)).toBe(false)
    expect(await grantQuarryIfDue(pk, { [id]: 1 }, draw)).toBe(true)
    expect(hasQuarry(pk)).toBe(true)
  })

  it('is granted once, and per npub: another identity does not have it, the first keeps it', async () => {
    const a = fresh(), b = fresh()
    await as(a)
    expect(await grantQuarryIfDue(a, { [CINDERROCK]: 1 }, draw)).toBe(true)
    expect(await grantQuarryIfDue(a, { [CINDERROCK]: 4, [UMBERSLATE]: 2 }, draw)).toBe(false)
    expect(useBlueprints.getState().cards.filter((c) => c.rowKey === `${a}/${QUARRY_CARD_ID}`)).toHaveLength(1)
    await as(b)
    expect(hasQuarry(b)).toBe(false)
    await as(a)
    expect(hasQuarry(a)).toBe(true)
  })

  it('the watch grants it too, beside the Compiler\'s, on the first pickup', async () => {
    const pk = fresh()
    startCompilerGrant(draw)
    useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: pk } })
    // The identity switch settles (TERRAIN starts that identity's inventory afresh) before its blocks are read in.
    await new Promise((r) => setTimeout(r, 50))
    useTerrain.setState({ inventory: { ...useTerrain.getState().inventory, counts: { [UMBERSLATE]: 1 } } })
    await useBlueprints.getState().load(pk)
    await vi.waitFor(() => expect(hasQuarry(pk)).toBe(true), { timeout: 4000 })
    // Umberslate is not in the Compiler's recipe.
    expect(has(pk)).toBe(false)
  })

  it('every block revealed, its prize the seven charges, by the game, never placed, an item blueprint (the orange mark)', async () => {
    const pk = fresh()
    await as(pk)
    await grantQuarryIfDue(pk, { [RUSTBAND]: 1 }, draw)
    await vi.waitFor(() => expect(hasQuarry(pk)).toBe(true), { timeout: 4000 })
    const card = useBlueprints.getState().cards.find((c) => c.rowKey === `${pk}/${QUARRY_CARD_ID}`)!
    expect(isGameCard(card)).toBe(true)
    expect(isItemBlueprint(card)).toBe(true)
    expect(card.prizeKind).toBe('tool')
    expect(card.record.pubkey).toBe(GAME_MAKER)
    const v = readRecord(card.record)!
    expect(v.title).toBe('The Quarry Charge')
    expect(v.lookup).toBe(QUARRY_LOOKUP)
    const f = finderView(v)
    expect(f.revealed.size).toBe(7)
    expect(await openPrize(hexToBytes(QUARRY_KEY_HEX), v.sealed)).toEqual({ type: 'tool', tool: 'quarry-charge', count: 7 })
  })
})
