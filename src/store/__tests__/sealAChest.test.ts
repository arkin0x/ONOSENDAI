/**
 * sealAChest.test.ts: SEAL A CHEST places first, then fills (chest and door
 * design, R18; arkinox 2026-10-31: "tap, choose location, choose contents"),
 * and a chest of yours has EDIT · MOVE · ADD · DELETE (4.8).
 *
 * SEAL A CHEST lines an empty chest up on the hide bar; PLACE CHEST fixes
 * where it lands and opens its modal; SEAL hides it there whatever the
 * cursor did since. MOVE (in the modal) goes back to the bar with the draft
 * kept, and so does BUILD ending, through SEAL A CHEST. A hidden chest of
 * yours moves anywhere with its seal and look; EDIT and ADD seal it again
 * where it stands. Nobody else's chest can be moved or resealed. Relays are
 * mocked; no network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { forgeKey, openWithSecret, readContents } from '../../lib/chests'
import { chestItemOf, type KeyItem } from '../../lib/hidden'
import { heldFromForged } from '../../lib/inventory'
import { lookTagsOf } from '../../lib/looks'
import { deployPoint, type Position } from '../../lib/space'
import { buildStepOf } from '../../lib/buildCursor'
import { useStash } from '../../hud/stash'
import { sealAChest } from '../../hud/ShardsPanel'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { fillingChest, placingChest, pendingEmpty, positionOf, useShards, type ChestDraft, type MyDeployment } from '../useShards'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a7f9n, y: (1n << 60n) + 0x2b4n, z: (1n << 72n) + 0x7e5n }

let lock: KeyItem
const draft = (over: Partial<ChestDraft> = {}): ChestDraft => ({ name: 'Wind Chest', lock: { pubkey: lock.itemPubkey, label: 'Wind Key' }, requires: 'the Wind Key', contents: [{ kind: 'message', text: 'inside' }], ...over })
const chestRow = (): MyDeployment | undefined => S().mine.find((d) => d.type === 'chest')
const opened = (d: MyDeployment, key = lock): string[] => readContents(openWithSecret(chestItemOf(d.inner)!, key.secretHex)).map((e) => e.body.text ?? e.body.key?.name ?? e.body.type)

/** SEAL A CHEST, placed at the cursor at height 4, filled and sealed. */
async function sealOne(over: Partial<ChestDraft> = {}): Promise<MyDeployment> {
  S().startPlaceChest()
  S().setDeployHeight(4)
  S().placeChest()
  await S().sealPlacedChest(draft(over))
  expect(S().deployError).toBeNull()
  return chestRow()!
}

beforeEach(() => {
  lock = forgeKey('Wind Key')
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, selectedSecret: null })
  useBuilder.getState().exit()
  useBuilder.setState({ itemDraft: null })
  useStash.getState().close()
  useInventory.setState({ owner: C().identity.pubkey, items: {}, storage: 'memory' })
  useCyberspace.setState({ live: false, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('SEAL A CHEST: tap, choose the place, then the contents', () => {
  it('lines an empty chest up on the hide bar, never "empty" while it is being placed', () => {
    S().startPlaceChest()
    const p = S().pending!
    expect(placingChest(p)).toBe(true)
    expect(pendingEmpty(p, null)).toBe(false)
    expect(p).toMatchObject({ type: 'chest', name: '', contents: [], look: { from: 'builtin', name: 'treasure' } })
    expect(useBuilder.getState().active).toBe(true)
  })

  it('PLACE CHEST fixes where it lands and opens its modal; the cursor moving after changes nothing', async () => {
    S().startPlaceChest()
    S().setDeployHeight(4)
    S().placeChest()
    const p = S().pending!
    expect(fillingChest(p)).toBe(true)
    expect(useStash.getState().chest).toBe(true)
    const spot = deployPoint(CURSOR, buildStepOf(C()), 4)
    expect(p.type === 'chest' && p.spot?.at).toEqual(spot)
    const away: Position = { ...CURSOR, x: CURSOR.x + (1n << 20n) }
    useCyberspace.setState({ cursor: away, position: away, anchor: away })
    await S().sealPlacedChest(draft())
    const d = chestRow()!
    expect(positionOf(d)).toEqual(spot)
    expect(d.height).toBe(4)
    expect(opened(d)).toEqual(['inside'])
    // What it holds is kept on this device for EDIT and ADD, and the modal goes.
    expect(d.sealed).toHaveLength(1)
    expect(useStash.getState().chest).toBe(false)
    expect(lookTagsOf(chestItemOf(d.inner)!.look).closed?.name).toMatch(/Treasure/)
  })

  it('MOVE in the modal goes back to the bar with the draft kept; closing it does too', () => {
    S().startPlaceChest()
    S().placeChest()
    S().unplaceChest(draft({ name: 'Kept' }))
    expect(placingChest(S().pending)).toBe(true)
    expect(useStash.getState().chest).toBe(false)
    S().placeChest()
    expect(S().pending).toMatchObject({ name: 'Kept' })
    S().keepChestDraft(draft({ name: 'Typed' }))
    S().unplaceChest()
    expect(S().pending).toMatchObject({ name: 'Typed', contents: [{ kind: 'message', text: 'inside' }] })
  })

  it('BUILD ending under it keeps the draft, and SEAL A CHEST brings it back', () => {
    S().startPlaceChest()
    S().placeChest()
    S().keepChestDraft(draft({ name: 'Unfinished' }))
    // The avatar's chain moves under the mode (a respawn): BUILD ends, and what was being placed is kept.
    const moved: Position = { ...CURSOR, y: CURSOR.y + 9n }
    useCyberspace.setState({ prevEventId: 'e'.repeat(64), cursor: moved, position: moved })
    expect(useBuilder.getState().active).toBe(false)
    expect(S().pending).toBeNull()
    sealAChest()
    expect(placingChest(S().pending)).toBe(true)
    expect(S().pending).toMatchObject({ name: 'Unfinished', contents: [{ kind: 'message', text: 'inside' }] })
  })

  it('typing in the modal while it seals changes nothing, and the seal still finishes', async () => {
    S().startPlaceChest()
    S().setDeployHeight(4)
    S().placeChest()
    const sealing = S().sealPlacedChest(draft())
    expect(S().deployStatus).toBe('working')
    const was = S().pending
    S().keepChestDraft(draft({ name: 'Typed meanwhile' }))
    expect(S().pending).toBe(was)
    await sealing
    expect(S().pending).toBeNull()
    expect(S().deployStatus).toBe('done')
    expect(useStash.getState().chest).toBe(false)
    expect(chestRow()?.chest?.name).toBe('Wind Chest')
  })

  it('seals nothing without a name, a lock or contents', async () => {
    S().startPlaceChest()
    S().placeChest()
    await S().sealPlacedChest(draft({ contents: [] }))
    expect(S().mine).toEqual([])
  })
})

describe('a chest of yours: EDIT, MOVE, ADD', () => {
  it('MOVE takes it anywhere: the same seal and contents at the new place, the old one gone, its look kept', async () => {
    const d = await sealOne()
    const before = chestItemOf(d.inner)!
    S().startMoveChest(d.eventId)
    expect(S().pending).toMatchObject({ type: 'chest', move: { eventId: d.eventId }, look: { from: 'model' } })
    expect(pendingEmpty(S().pending!, null)).toBe(false)
    const far: Position = { ...CURSOR, x: CURSOR.x + (1n << 30n) }
    useCyberspace.setState({ cursor: far, position: far, anchor: far })
    await S().deploy()
    expect(S().deployError).toBeNull()
    const rows = S().mine.filter((x) => x.type === 'chest')
    expect(rows).toHaveLength(1)
    const moved = rows[0]
    expect(moved.eventId).not.toBe(d.eventId)
    expect(positionOf(moved)).toEqual(deployPoint(far, buildStepOf(C()), 4))
    const after = chestItemOf(moved.inner)!
    expect(after.payload).toBe(before.payload)
    expect(after.lockPubkey).toBe(before.lockPubkey)
    expect(after.look).toHaveLength(2)
    expect(moved.sealed).toEqual(d.sealed)
  })

  it('MOVE inside its own bag replaces it in the same rewrite', async () => {
    const d = await sealOne()
    S().startMoveChest(d.eventId)
    const near: Position = { ...CURSOR, x: CURSOR.x + 1n }
    useCyberspace.setState({ cursor: near, position: near, anchor: near })
    await S().deploy()
    expect(S().mine.filter((x) => x.type === 'chest')).toHaveLength(1)
    expect(S().deleted[d.eventId]).toBe(true)
  })

  it('EDIT renames it and changes the lock: only the new key opens it, the contents kept', async () => {
    const d = await sealOne()
    const contents = (await S().chestEntries(d.eventId)) as never[]
    const next = forgeKey('Sun Key')
    const why = await S().resealChest(d.eventId, { name: 'Sun Chest', requires: 'the Sun Key', lock: { pubkey: next.itemPubkey, label: 'Sun Key' }, contents: contents.map((entry) => ({ kind: 'sealed' as const, entry, label: 'x', type: 'message' as const })) })
    expect(why).toBeNull()
    const row = chestRow()!
    const c = chestItemOf(row.inner)!
    expect(c.name).toBe('Sun Chest')
    expect(c.lockPubkey).toBe(next.itemPubkey)
    expect(opened(row, next)).toEqual(['inside'])
    expect(() => openWithSecret(c, lock.secretHex)).toThrow()
    expect(c.look).toEqual(chestItemOf(d.inner)!.look)
    expect(positionOf(row)).toEqual(positionOf(d))
  })

  it('ADD puts more in it where it stands; a forged item inside is held at once', async () => {
    const d = await sealOne()
    const kept = (await S().chestEntries(d.eventId)) as never[]
    const why = await S().resealChest(d.eventId, { ...draft(), lock: draft().lock!, contents: [...kept.map((entry) => ({ kind: 'sealed' as const, entry, label: 'x', type: 'message' as const })), { kind: 'message', text: 'more' }, { kind: 'key', key: forgeKey('Next Key') }] })
    expect(why).toBeNull()
    expect(opened(chestRow()!)).toEqual(['inside', 'more', 'Next Key'])
    expect(Object.values(useInventory.getState().items).some((i) => i.name === 'Next Key')).toBe(true)
  })

  it('a chest claimed from another device opens with the key you hold to be edited; without it, says so', async () => {
    const d = await sealOne()
    useShards.setState({ mine: S().mine.map((x) => (x.eventId === d.eventId ? { ...x, sealed: undefined } : x)) })
    expect(await S().chestEntries(d.eventId)).toBe('Opening the chest needs the key it is sealed to, which this device does not hold.')
    useInventory.getState().add([heldFromForged(C().identity.pubkey, { ...d.inner, sig: d.inner.sig ?? '' } as never, lock, { lookupId: d.lookupId, bagId: d.bagId, at: d.at, plane: d.plane, height: d.height }, 1)])
    const entries = await S().chestEntries(d.eventId)
    expect(Array.isArray(entries) && entries.length).toBe(1)
  })

  it('nobody else’s chest moves or reseals', async () => {
    const d = await sealOne()
    const theirs = { ...d, inner: { ...d.inner, pubkey: 'f'.repeat(64) } }
    useShards.setState({ mine: [theirs] })
    S().startMoveChest(d.eventId)
    expect(S().pending).toBeNull()
    expect(await S().resealChest(d.eventId, { ...draft(), lock: draft().lock! })).toMatch(/Only the chest/)
  })
})
