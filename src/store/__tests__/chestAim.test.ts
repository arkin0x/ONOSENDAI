/**
 * chestAim.test.ts: aiming a shard into a chest (arkinox, 2026-10-10: "When I
 * hid a shard in the chest I never got to position it").
 *
 * AIM in the chest composer lines the shard up as a shard deploy that signs
 * instead of hiding (useShards startDeployIntoChest, hud/stash aimIntoChest).
 * PUT IN CHEST signs the inner event at the build cursor's deploy point, at
 * the bar's size and turn, hides nothing, and hands the chest back to its
 * composer with that shard aimed (useBuilder itemDraft, by way of chestBack);
 * CANCEL hands it back as it was. The seal then takes the aimed event as it
 * is, so the content comes out of the chest where it was aimed when the
 * chest's region holds that point, and at the chest when it does not
 * (lib/chests revealedIn). BUILD mode ending under an aim keeps the chest the
 * way it keeps any chest. Relays are mocked; no network.
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

import { verifyEvent } from 'nostr-tools/pure'
import { fromPayload, newShard, ticksOf, type ShardModel, type ShardPayload } from 'sno-core/shards'
import { forgeKey, openWithSecret, placeOf, readContents, revealedIn } from '../../lib/chests'
import { chestItemOf } from '../../lib/hidden'
import { buildPlane } from '../../lib/buildCursor'
import type { Position } from '../../lib/space'
import { useStash } from '../../hud/stash'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { positionOf, useShards, type ChestContent, type ChestDraft } from '../useShards'
import { useToast } from '../useToast'
import { useWorkshop } from '../useWorkshop'

const S = () => useShards.getState()
const B = () => useBuilder.getState()
const C = () => useCyberspace.getState()

/** A cursor with bits set all the way down, so no cell center is it by accident. */
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a7f9n, y: (1n << 60n) + 0x2b4n, z: (1n << 72n) + 0x7e5n }

/** A shard on the bench at a known size, with enough geometry to be deployable. */
function benchShard(unit: number): ShardModel {
  const shard: ShardModel = {
    ...newShard('Crucifix'),
    unit,
    vertices: [
      { p: [0, 0, 0], c: [1, 0, 0] },
      { p: [1, 0, 0], t: [0, 60, 0], c: [0, 1, 0] },
      { p: [0, 1, 0], c: [0, 0, 1] },
    ],
    faces: [[0, 1, 2]],
  }
  useWorkshop.setState({ shards: [shard], currentId: shard.id })
  return shard
}

/** A draft as the composer parks it by AIM: no lock chosen yet. */
function draftOf(contents: ChestContent[]): ChestDraft {
  return { name: 'Wind Chest', lock: null, requires: '', contents }
}

/** AIM, then PUT IN CHEST, at the cursor: the chest as it comes back to the composer. */
async function aimFirst(draft: ChestDraft, unit: number, turnY = false): Promise<ChestDraft> {
  useStash.getState().aimIntoChest(draft, 0)
  S().setDeployUnit(unit)
  if (turnY) S().turnDeploy(1)
  await S().deploy()
  expect(S().deployError).toBeNull()
  expect(S().deployStatus).toBe('done')
  const back = B().takeItemDraft('chest')
  expect(back?.type).toBe('chest')
  const { type: _type, ...chest } = back as Extract<typeof back, { type: 'chest' }>
  return chest
}

beforeEach(() => {
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null })
  B().exit()
  useBuilder.setState({ itemDraft: null, messageDraft: null })
  useStash.setState({ chest: false, returnToChest: false, returnToModels: false, returnToFeed: false })
  useInventory.setState({ owner: C().identity.pubkey, items: {}, storage: 'memory' })
  useToast.getState().dismiss()
  C().clearFocus()
  useCyberspace.setState({ live: false, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here; items stay in memory */ })
})

describe('AIM from the chest composer', () => {
  it('closes the composer and lines the shard up as a shard deploy carrying the chest, at the model\'s own size', () => {
    const shard = benchShard(3)
    const draft = draftOf([{ kind: 'shard', shardId: shard.id }, { kind: 'message', text: 'hello' }])
    useStash.getState().openChest()
    useStash.getState().aimIntoChest(draft, 0)
    expect(useStash.getState().chest).toBe(false)
    expect(useStash.getState().returnToChest).toBe(true)
    const p = S().pending
    expect(p?.type).toBe('shard')
    if (p?.type !== 'shard') throw new Error('not a shard')
    expect(p.shardId).toBe(shard.id)
    expect(p.intoChest).toEqual({ draft, contentIndex: 0 })
    expect(S().deployUnit).toBe(3)
    expect(S().deployHeightAuto).toBe(true)
    // Every deploy happens in BUILD mode; an aim is a deploy.
    expect(B().active).toBe(true)
  })

  it('does nothing for a content that is not a shard', () => {
    const shard = benchShard(3)
    const draft = draftOf([{ kind: 'shard', shardId: shard.id }, { kind: 'message', text: 'hello' }])
    S().startDeployIntoChest(draft, 1)
    expect(S().pending).toBeNull()
    S().startDeployIntoChest(draft, 7)
    expect(S().pending).toBeNull()
  })
})

describe('PUT IN CHEST', () => {
  it('signs the shard at the deploy point, at the bar\'s size and turn, hides nothing, and hands the chest back with it aimed', async () => {
    const shard = benchShard(3)
    const draft = draftOf([{ kind: 'shard', shardId: shard.id }, { kind: 'message', text: 'hello' }])
    useStash.getState().aimIntoChest(draft, 0)
    S().setDeployUnit(5)
    S().turnDeploy(1) // a quarter about Y: +X goes to -Z
    await S().deploy()

    expect(S().deployStatus).toBe('done')
    expect(S().pending).toBeNull()
    // Nothing hidden, no bag written, and the chest already taken by useBuilder.
    expect(S().mine).toHaveLength(0)
    expect(S().chestBack).toBeNull()

    const back = B().itemDraft
    expect(back?.type).toBe('chest')
    if (back?.type !== 'chest') throw new Error('not a chest')
    expect(back.name).toBe('Wind Chest')
    expect(back.lock).toBeNull()
    const c = back.contents[0]
    if (c.kind !== 'shard' || !c.aimed) throw new Error('not aimed')
    expect(c.shardId).toBe(shard.id)
    expect(c.aimed.unit).toBe(5)
    expect(verifyEvent(c.aimed.signed)).toBe(true)
    expect(c.aimed.signed.pubkey).toBe(C().identity.pubkey)
    // Its C is the deploy point: at zoom 2^0 the cursor itself, in the build plane.
    expect(placeOf(c.aimed.signed)).toEqual({ at: CURSOR, plane: buildPlane(C()) })
    // The payload carries the size and the turn exactly as a hide's would.
    const payload = JSON.parse(c.aimed.signed.content) as ShardPayload
    expect(payload.unit).toBe(5)
    const sent = fromPayload(payload, c.aimed.signed.id)!
    expect(ticksOf(sent.vertices[1])).toEqual([0, 60, -120])
    // The workshop's model is untouched, and so is the message beside it.
    expect(ticksOf(shard.vertices[1])).toEqual([120, 60, 0])
    expect(useWorkshop.getState().shards[0]).toBe(shard)
    expect(back.contents[1]).toEqual({ kind: 'message', text: 'hello' })
    // The composer comes back.
    expect(useStash.getState().chest).toBe(true)
    expect(useStash.getState().returnToChest).toBe(false)
  })

  it('a re-aim starts at the size it was aimed at and replaces the earlier signature', async () => {
    const shard = benchShard(3)
    const once = await aimFirst(draftOf([{ kind: 'shard', shardId: shard.id }]), 5)
    const first = once.contents[0]
    if (first.kind !== 'shard' || !first.aimed) throw new Error('not aimed')
    useStash.getState().aimIntoChest(once, 0)
    expect(S().deployUnit).toBe(5)
    S().setDeployUnit(6)
    await S().deploy()
    const back = B().itemDraft
    if (back?.type !== 'chest') throw new Error('not a chest')
    const again = back.contents[0]
    if (again.kind !== 'shard' || !again.aimed) throw new Error('not aimed')
    expect(again.aimed.unit).toBe(6)
    expect(again.aimed.signed.id).not.toBe(first.aimed.signed.id)
  })
})

describe('CANCEL while aiming', () => {
  it('hands the chest back as it was, that shard not aimed, and the composer comes back', () => {
    const shard = benchShard(3)
    const draft = draftOf([{ kind: 'shard', shardId: shard.id }, { kind: 'message', text: 'hello' }])
    useStash.getState().aimIntoChest(draft, 0)
    S().cancelDeploy()
    expect(S().pending).toBeNull()
    expect(S().mine).toHaveLength(0)
    expect(B().itemDraft).toEqual({ type: 'chest', ...draft })
    expect(useStash.getState().chest).toBe(true)
    expect(useStash.getState().returnToChest).toBe(false)
  })

  it('a canceled re-aim keeps the earlier aim', async () => {
    const shard = benchShard(3)
    const once = await aimFirst(draftOf([{ kind: 'shard', shardId: shard.id }]), 5)
    useStash.getState().aimIntoChest(once, 0)
    S().cancelDeploy()
    expect(B().itemDraft).toEqual({ type: 'chest', ...once })
  })
})

describe('the seal takes the aimed event as it is', () => {
  it('and the chest reveals the shard where it was aimed when its region holds that point, else at the chest', async () => {
    const shard = benchShard(3)
    const aimed = await aimFirst(draftOf([{ kind: 'shard', shardId: shard.id }, { kind: 'message', text: 'hello' }]), 5)
    const first = aimed.contents[0]
    if (first.kind !== 'shard' || !first.aimed) throw new Error('not aimed')

    // The chest goes three gibsons east of where the shard was aimed, in the
    // same 2^4 cube, at height 4.
    const moved: Position = { ...CURSOR, x: CURSOR.x + 3n }
    useCyberspace.setState({ position: moved, anchor: moved, cursor: moved })
    const lock = forgeKey('Wind Key')
    S().startDeployChest({ ...aimed, lock: { pubkey: lock.itemPubkey, label: 'Wind Key' } })
    // With a shard aimed inside, the height follows the fit (the bar applies it).
    expect(S().deployHeightAuto).toBe(true)
    S().setDeployHeight(4)
    await S().deploy()
    expect(S().deployError).toBeNull()
    expect(S().deployStatus).toBe('done')

    const d = S().mine.find((x) => x.type === 'chest')!
    expect(d.height).toBe(4)
    expect(positionOf(d)).toEqual(moved)
    const chest = chestItemOf(d.inner)!
    const contents = readContents(openWithSecret(chest, lock.secretHex))
    expect(contents.map((c) => c.body.type)).toEqual(['shard', 'message'])
    // The very event signed at the aim, not a new signature at the chest.
    expect(contents[0].id).toBe(first.aimed.signed.id)
    expect(contents[0].event.sig).toBe(first.aimed.signed.sig)
    expect(contents[0].verified).toBe(true)
    expect(contents[0].body.shard?.unit).toBe(5)
    // The message, never aimed, was signed at the chest.
    expect(placeOf(contents[1].event)).toEqual({ at: moved, plane: d.plane })

    const found = revealedIn({ eventId: d.eventId, bagId: d.bagId, lookupId: d.lookupId, author: C().identity.pubkey, at: positionOf(d), plane: d.plane, height: d.height, bag: d.bag, keyHex: d.keyHex }, contents)
    expect(found[0].at).toEqual(CURSOR)
    expect(found[1].at).toEqual(moved)
    // Hidden at height 0 instead, the region is the chest's own gibson: the
    // aimed point is outside it, and the shard stands at the chest.
    const low = revealedIn({ eventId: d.eventId, bagId: d.bagId, lookupId: d.lookupId, author: C().identity.pubkey, at: positionOf(d), plane: d.plane, height: 0, bag: d.bag, keyHex: d.keyHex }, contents)
    expect(low[0].at).toEqual(moved)
  })

  it('refuses an aim signed by another identity, in words, and hides nothing', async () => {
    const shard = benchShard(3)
    const aimed = await aimFirst(draftOf([{ kind: 'shard', shardId: shard.id }]), 5)
    const first = aimed.contents[0]
    if (first.kind !== 'shard' || !first.aimed) throw new Error('not aimed')
    const foreign: ChestDraft = { ...aimed, contents: [{ ...first, aimed: { ...first.aimed, signed: { ...first.aimed.signed, pubkey: 'ab'.repeat(32) } } }] }
    const lock = forgeKey('Wind Key')
    S().startDeployChest({ ...foreign, lock: { pubkey: lock.itemPubkey, label: 'Wind Key' } })
    await S().deploy()
    expect(S().deployStatus).toBe('error')
    expect(S().deployError).toMatch(/aimed by another identity/)
    expect(S().mine).toHaveLength(0)
  })

  it('a chest with nothing aimed inside keeps its height where the composer left it', () => {
    const shard = benchShard(3)
    const lock = forgeKey('Wind Key')
    S().startDeployChest({ ...draftOf([{ kind: 'shard', shardId: shard.id }]), lock: { pubkey: lock.itemPubkey, label: 'Wind Key' } })
    expect(S().deployHeightAuto).toBe(false)
  })
})

describe('BUILD mode ending under an aim', () => {
  it('keeps the chest for SEAL A CHEST, says so, and does not reopen the composer', () => {
    const shard = benchShard(3)
    const draft = draftOf([{ kind: 'shard', shardId: shard.id }])
    useStash.getState().aimIntoChest(draft, 0)
    expect(B().active).toBe(true)
    // An Earth tap: the view the build cursor rides ends.
    C().focusOn(C().position, 0, 'EARTH · tap')
    expect(B().active).toBe(false)
    expect(S().pending).toBeNull()
    expect(B().itemDraft).toEqual({ type: 'chest', ...draft })
    expect(useStash.getState().chest).toBe(false)
    expect(useStash.getState().returnToChest).toBe(false)
    const meta = useToast.getState().toast?.meta ?? ''
    expect(meta).toMatch(/Your chest is kept: SEAL A CHEST in CREATE opens it again/)
    expect(meta).toMatch(/"Crucifix" is not aimed/)
  })
})
