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

import { forgeKey, openWithSecret, openerFor, readContents } from '../../lib/chests'
import { chestItemOf, type KeyItem } from '../../lib/hidden'
import { heldFromForged, openingKeys, sealableKeys, splitPanels, unarchived } from '../../lib/inventory'
import { lookTagsOf } from '../../lib/looks'
import { deployPoint, type Position } from '../../lib/space'
import { buildStepOf } from '../../lib/buildCursor'
import { useStash } from '../../hud/stash'
import { sealAChest } from '../../hud/ShardsPanel'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { fillingChest, itemStillNeeded, keyStillNeeded, lookTagsFor, placingChest, pendingEmpty, positionOf, useShards, type ChestDraft, type LookChoice, type MyDeployment } from '../useShards'

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

  it('ADD puts more in it where it stands; a forged item inside is not held until taken out (arkinox, 2026-11-06)', async () => {
    const d = await sealOne()
    const kept = (await S().chestEntries(d.eventId)) as never[]
    const why = await S().resealChest(d.eventId, { ...draft(), lock: draft().lock!, contents: [...kept.map((entry) => ({ kind: 'sealed' as const, entry, label: 'x', type: 'message' as const })), { kind: 'message', text: 'more' }, { kind: 'key', key: forgeKey('Next Key') }] })
    expect(why).toBeNull()
    expect(opened(chestRow()!)).toEqual(['inside', 'more', 'Next Key'])
    expect(Object.values(useInventory.getState().items).some((i) => i.name === 'Next Key')).toBe(false)
  })

  it('a chest claimed from another device opens with the key you hold to be edited; without it, says so', async () => {
    const d = await sealOne()
    useShards.setState({ mine: S().mine.map((x) => (x.eventId === d.eventId ? { ...x, sealed: undefined } : x)) })
    expect(await S().chestEntries(d.eventId)).toBe('Opening the chest needs the key it is sealed to, which this device does not hold.')
    useInventory.getState().add([heldFromForged(C().identity.pubkey, { ...d.inner, sig: d.inner.sig ?? '' } as never, lock, { lookupId: d.lookupId, bagId: d.bagId, at: d.at, plane: d.plane, height: d.height }, 1)])
    const entries = await S().chestEntries(d.eventId)
    expect(Array.isArray(entries) && entries.length).toBe(1)
  })

  it('a chest sealed to a key you placed and never picked up still opens for EDIT and ADD (arkinox, 2026-11-06)', async () => {
    S().startDeployKey(lock)
    S().setDeployHeight(5)
    await S().deploy()
    expect(S().deployError).toBeNull()
    S().cancelDeploy()
    expect(Object.keys(useInventory.getState().items)).toEqual([])
    const d = await sealOne()
    useShards.setState({ mine: S().mine.map((x) => (x.eventId === d.eventId ? { ...x, sealed: undefined } : x)) })
    const entries = await S().chestEntries(d.eventId)
    expect(Array.isArray(entries) && entries.length).toBe(1)
    expect(Object.keys(useInventory.getState().items)).toEqual([])
  })

  it('CONVERT TO DOOR opens a chest sealed to a key you placed and never picked up (review of #614)', async () => {
    S().startDeployKey(lock)
    S().setDeployHeight(5)
    await S().deploy()
    expect(S().deployError).toBeNull()
    S().cancelDeploy()
    const d = await sealOne()
    // Claimed from another device: no sealed copy kept, so CONVERT must open it.
    useShards.setState({ mine: S().mine.map((x) => (x.eventId === d.eventId ? { ...x, sealed: undefined } : x)) })
    expect(Object.keys(useInventory.getState().items)).toEqual([])
    expect(await S().convertToDoor(d.eventId)).toBeNull()
    expect(S().mine.find((m) => m.type === 'chest')?.chest?.door).toBeDefined()
  })

  it('DELETE refuses the key while a chest of yours is sealed to it and nothing else keeps its secret, naming what it opens (review of #614)', async () => {
    S().startDeployKey(lock)
    S().setDeployHeight(5)
    await S().deploy()
    S().cancelDeploy()
    const key = S().mine.find((m) => m.type === 'key')!
    const chest = await sealOne()
    const why = keyStillNeeded(key, S().mine, useInventory.getState().items, C().identity.pubkey)
    expect(why).toBe('This key opens chest “Wind Chest”. Delete or reseal that first.')
    await S().deleteInstance(key.eventId)
    expect(S().mine.some((m) => m.eventId === key.eventId)).toBe(true)
    // FORGET on the same row, gone from its bag, refuses with the same words.
    useShards.setState({ mine: S().mine.map((m) => (m.eventId === key.eventId ? { ...m, goneFrom: 1 } : m)) })
    expect(S().forgetRow(key.eventId)).toBe(why)
    expect(S().mine.some((m) => m.eventId === key.eventId)).toBe(true)
    useShards.setState({ mine: S().mine.map((m) => (m.eventId === key.eventId ? { ...m, goneFrom: undefined } : m)) })
    // Picked up, its secret is in ITEMS: DELETE goes ahead.
    S().takeFound([key.eventId])
    expect(keyStillNeeded(key, S().mine, useInventory.getState().items, C().identity.pubkey)).toBeNull()
    await S().deleteInstance(key.eventId)
    expect(S().mine.some((m) => m.eventId === key.eventId)).toBe(false)
    void chest
  })

  it('DELETE of that key goes ahead once nothing of yours is sealed to it, or another copy keeps its secret', async () => {
    S().startDeployKey(lock)
    S().setDeployHeight(5)
    await S().deploy()
    S().cancelDeploy()
    const key = S().mine.find((m) => m.type === 'key')!
    const me = C().identity.pubkey
    expect(keyStillNeeded(key, S().mine, {}, me)).toBeNull()
    const chest = await sealOne()
    expect(keyStillNeeded(key, S().mine, {}, me)).not.toBeNull()
    // A second row of the same keypair (a copy placed again) keeps its secret.
    expect(keyStillNeeded(key, [...S().mine, { ...key, eventId: 'copy' }], {}, me)).toBeNull()
    // Nothing sealed to it any more.
    expect(keyStillNeeded(key, S().mine.filter((m) => m.eventId !== chest.eventId), {}, me)).toBeNull()
    // A door counts as a chest does, and says so.
    const asDoor = S().mine.map((m) => (m.eventId === chest.eventId ? { ...m, chest: { ...m.chest!, door: 4 } } : m))
    expect(keyStillNeeded(key, asDoor, {}, me)).toBe('This key opens door “Wind Chest”. Delete or reseal that first.')
  })

  it('ARCHIVE instead of DELETE (arkinox, 2026-11-06): the refused key is filed away with its secret, DELETE then goes ahead, its chest still opens and seals, UNARCHIVE brings it back', async () => {
    S().startDeployKey(lock)
    S().setDeployHeight(5)
    await S().deploy()
    S().cancelDeploy()
    const key = S().mine.find((m) => m.type === 'key')!
    const chest = await sealOne()
    const me = C().identity.pubkey
    expect(keyStillNeeded(key, S().mine, useInventory.getState().items, me)).not.toBeNull()
    // ARCHIVE on the never-picked-up key: an archived ITEMS row holding its secret.
    const row = useInventory.getState().archiveMade(key.inner as never, key.key!, { lookupId: key.lookupId, bagId: key.bagId, at: key.at, plane: key.plane, height: key.height })
    expect(row.archived).toBeGreaterThan(0)
    expect(row.key?.secretHex).toBe(lock.secretHex)
    expect(splitPanels([], Object.values(useInventory.getState().items)).loot).toMatchObject({ keys: [], archived: [{ id: key.eventId }] })
    // The secret is kept here now, so DELETE of the world copy goes ahead.
    expect(keyStillNeeded(key, S().mine, useInventory.getState().items, me)).toBeNull()
    await S().deleteInstance(key.eventId)
    expect(S().mine.some((m) => m.eventId === key.eventId)).toBe(false)
    // The archived key still opens its chest, in play and for EDIT, and can still be sealed to.
    expect(openerFor(chest.chest!, openingKeys(useInventory.getState().items), me)).toMatchObject({ by: 'key' })
    useShards.setState({ mine: S().mine.map((x) => (x.eventId === chest.eventId ? { ...x, sealed: undefined } : x)) })
    const inside = await S().chestEntries(chest.eventId)
    expect(Array.isArray(inside) && inside.length).toBe(1)
    expect(sealableKeys(useInventory.getState().items, S().mine, me).map((k) => k.key.itemPubkey)).toContain(lock.itemPubkey)
    // ITEMS DELETE of that archived row is now the last copy: refused, naming the chest.
    expect(itemStillNeeded(row, S().mine, useInventory.getState().items, me)).toBe('This key opens chest “Wind Chest”. Delete or reseal that first.')
    // UNARCHIVE: back in INVENTORY.
    useInventory.getState().unarchive(row.id)
    expect(useInventory.getState().items[row.id].archived).toBeUndefined()
    expect(splitPanels([], Object.values(useInventory.getState().items)).loot.keys.map((k) => k.id)).toEqual([row.id])
  })

  it('ARCHIVE on any row files it away and keeps it held for what a key does; a keypair already in ITEMS is archived where it stands', async () => {
    S().startDeployKey(lock)
    S().setDeployHeight(5)
    await S().deploy()
    S().cancelDeploy()
    const key = S().mine.find((m) => m.type === 'key')!
    S().takeFound([key.eventId])
    useInventory.getState().archive(key.eventId)
    const items = useInventory.getState().items
    expect(Object.keys(items)).toEqual([key.eventId])
    expect(items[key.eventId].archived).toBeGreaterThan(0)
    expect(openingKeys(items).map((k) => k.itemPubkey)).toEqual([lock.itemPubkey])
    // Not drawn as held in the world.
    expect(unarchived(items)).toEqual({})
    // archiveMade on the same keypair archives that row, never a second one.
    useInventory.getState().unarchive(key.eventId)
    useInventory.getState().archiveMade(key.inner as never, key.key!, { lookupId: key.lookupId, bagId: key.bagId, at: key.at, plane: key.plane, height: key.height })
    expect(Object.keys(useInventory.getState().items)).toEqual([key.eventId])
    expect(useInventory.getState().items[key.eventId].archived).toBeGreaterThan(0)
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

describe('MOVE of a chest wearing a default look', () => {
  it('stays by reference: moved, it never goes out inline', async () => {
    const lock = forgeKey('Silver Key')
    S().startPlaceChest(); S().setDeployHeight(4); S().placeChest()
    await S().sealPlacedChest({ name: 'Mover', lock: { pubkey: lock.itemPubkey, label: 'Silver Key' }, requires: '', contents: [{ kind: 'message', text: 'inside' }] })
    const row = S().mine.find((d) => d.chest?.name === 'Mover')!
    S().startMoveChest(row.eventId)
    const look = (S().pending as { look: LookChoice }).look
    const tags = lookTagsFor(look, { unit: 2, turn: [0, 1, 0], constrain: 'all' })
    expect(JSON.stringify(tags).length).toBeLessThan(1024)
    for (const t of tags) expect((JSON.parse(t[1]) as { refs: unknown[][] }).refs[0][1]).toMatch(/^33331:/)
    S().cancelDeploy()
  })
})
