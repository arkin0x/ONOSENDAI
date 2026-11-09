/**
 * bagAutoReference.test.ts: a shard goes by reference when its bag would not
 * hold it inline (owner, 2026-11-09: the 16,112-byte cistern-coil into the room
 * "Sealed Crawlspace", its bag already near 236 KB, was refused). The decision
 * is bag-aware (lib/bagFit.ts): the same shard into an empty bag stays inline;
 * a bag full of entries that cannot go by reference still refuses, before
 * anything is signed; the object goes out before the bag that names it, sealed
 * with the bag's own key; a finder reads the same shard back. The real cap,
 * lib/bagSize BAG_SAFE_BYTES. The relay is a mock that keeps what is published
 * and answers by `d`. No network.
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

const relay = vi.hoisted(() => ({ events: [] as Array<{ id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string }>, sent: [] as string[], refuseKind: -1 }))
vi.mock('../../lib/relay', () => {
  const answer = async (f: { kinds?: number[]; authors?: string[]; ids?: string[]; '#d'?: string[] }): Promise<unknown[]> => relay.events.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f.ids || f.ids.includes(e.id)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')))
  return {
    // An addressable event replaces its older version, as a relay does.
    publishMany: vi.fn(async (_r: string[], ev: (typeof relay.events)[number]) => {
      // A relay that refuses one kind, for a write that must fail after its object went out.
      if (relay.refuseKind === ev.kind) return { ok: false }
      const d = ev.tags.find((t) => t[0] === 'd')?.[1]
      if (ev.kind >= 30000 && ev.kind < 40000) relay.events = relay.events.filter((e) => !(e.kind === ev.kind && e.pubkey === ev.pubkey && e.tags.find((t) => t[0] === 'd')?.[1] === d))
      relay.events.push(ev)
      relay.sent.push(ev.id)
      return { ok: true }
    }),
    publishRetried: vi.fn(async () => true),
    query: vi.fn(answer),
    queryAny: vi.fn((_r: string[], f: Parameters<typeof answer>[0]) => answer(f)),
    queryEach: vi.fn(async (f: Parameters<typeof answer>[0]) => [{ url: 'wss://relay.test', outcome: 'answered', events: await answer(f) }]),
    relaySet: () => ['wss://relay.test'],
  }
})

import { newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { forgeKey } from '../../lib/chests'
import { bytesToHex, hexToBytes, type NostrEvent } from '../../lib/events'
import { HIDDEN_KIND, MESSAGE_KIND, OBJECT_KIND, REFERENCE_THRESHOLD_BYTES, SHARD_KIND, bagEntries, bagTemplate, rumorOf, unbag, type BagEntry, type KeyItem, type Rumor } from '../../lib/hidden'
import { BAG_SAFE_BYTES } from '../../lib/bagSize'
import { bagBytes } from '../../lib/bagFit'
import { decryptForRegion } from '../../lib/shardCrypto'
import { withAuthoredConstrain } from '../../lib/walkConstrain'
import { roomKey, roomLookupId, ROOM_BAG_SETTINGS } from '../../lib/doors'
import { resolveReference } from '../../lib/references'
import type { Position } from '../../lib/space'
import { buildPlane } from '../../lib/buildCursor'
import { useStash } from '../../hud/stash'
import { doorSecret, resetDoorSecrets } from '../doorSecrets'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { useWorkshop } from '../useWorkshop'
import { resetOpenedChests } from '../useOpenedChests'
import { bagRowsFor, deployBagMeter, hereInRoom, ownDoors, plannedShard, positionOf, regionOf, useShards, type MyDeployment, type WorldItem } from '../useShards'
import { itemParent, sealedComment, threadComments, type CommentSubject } from '../../lib/comments'
import { hiddenRowFor } from '../../lib/notifications'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const me = (): string => C().identity.pubkey
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a7f0n, y: (1n << 60n) + 0x2b0n, z: (1n << 72n) + 0x7e0n }
const H = 4
type Ev = (typeof relay.events)[number]
const dOf = (e: { tags: string[][] }): string => e.tags.find((t) => t[0] === 'd')?.[1] ?? ''
const newestBag = (lookupId: string): Ev => relay.events.filter((e) => e.kind === HIDDEN_KIND && dOf(e) === lookupId).sort((a, b) => b.created_at - a.created_at)[0]
const payloadOf = (s: ShardModel): string => JSON.stringify(toPayload(withAuthoredConstrain(s)))

/** A shard just under the reference threshold, as the coil was (16,112 bytes): inline by itself. */
let coilModel: ShardModel | null = null
function coil(): ShardModel {
  if (!coilModel) {
    const base = newShard('cistern-coil')
    const vertex = (i: number) => ({ p: [i % 16, (i >> 4) % 16, (i >> 8) % 16] as [number, number, number], c: [0.25, 0.5, 1] as [number, number, number] })
    const of = (n: number): ShardModel => ({ ...base, vertices: Array.from({ length: n }, (_, i) => vertex(i)), faces: [[0, 1, 2]] as Array<[number, number, number]> })
    // Linear in its vertices: two probes give the count, then a few steps settle it.
    const a = payloadOf(of(200)).length
    const b = payloadOf(of(400)).length
    let n = Math.floor(200 + ((16_112 - a) * 200) / (b - a))
    while (payloadOf(of(n)).length > REFERENCE_THRESHOLD_BYTES) n--
    while (payloadOf(of(n + 1)).length <= 16_112) n++
    coilModel = of(n)
  }
  expect(payloadOf(coilModel).length).toBeGreaterThan(15_800)
  expect(payloadOf(coilModel).length).toBeLessThanOrEqual(REFERENCE_THRESHOLD_BYTES)
  useWorkshop.setState({ shards: [coilModel] })
  return coilModel
}

let lock: KeyItem

/** SEAL A DOOR at the cursor, at height h. */
async function sealDoor(h = H): Promise<MyDeployment> {
  const before = new Set(S().mine.map((d) => d.eventId))
  S().startPlaceDoor()
  S().setDeployHeight(h)
  S().placeChest()
  await S().sealPlacedChest({ name: 'Sealed Crawlspace', lock: { pubkey: lock.itemPubkey, label: lock.name }, requires: 'x', contents: [] })
  expect(S().deployError).toBeNull()
  S().cancelDeploy()
  return S().mine.find((d) => !before.has(d.eventId))!
}

/** Deploy a shard at the cursor at height h; its row, and the deploy's error. */
async function place(model: ShardModel, h = H): Promise<{ row: MyDeployment | undefined; error: string | null }> {
  const before = new Set(S().mine.map((d) => d.eventId))
  S().startDeployShard(model.id)
  S().setDeployHeight(h)
  await S().deploy()
  const error = S().deployError
  S().cancelDeploy()
  return { row: S().mine.find((d) => !before.has(d.eventId)), error }
}

/**
 * A bag at `lookupId` filled with messages (entries that cannot go by
 * reference) to about `target` bytes, on the relay and as rows of this device,
 * newer than whatever stands there.
 */
async function fill(lookupId: string, key: Uint8Array, at: Position, height: number, target: number, room?: { doorId: string }, omit: ReadonlySet<string> = new Set()): Promise<void> {
  const settings = room ? ROOM_BAG_SETTINGS : S().mine.find((d) => d.lookupId === lookupId)?.bag ?? { ...S().deployBag }
  const standing = newestBag(lookupId)
  // `omit`: entries this newer bag leaves out, as another device's rewrite would.
  const entries: BagEntry[] = standing ? (await bagEntries(standing as NostrEvent, key)).filter((e) => Array.isArray(e) || !omit.has(e.id)) : []
  const C_TAG = S().mine.find((d) => d.lookupId === lookupId)?.inner.tags.find((t) => t[0] === 'C') ?? ['C', '']
  const now = Math.floor(Date.now() / 1000)
  const rumors: Rumor[] = []
  const message = (chars: number): Rumor => rumorOf({ kind: MESSAGE_KIND, created_at: now - 100 + rumors.length, content: `${rumors.length} ${'m'.repeat(chars)}`, tags: [C_TAG, ['-']] }, me())
  const add = (r: Rumor): void => { rumors.push(r); entries.push(r) }
  while (bagBytes(entries, lookupId, height, settings) < target - 14_000) add(message(9_000))
  // The last one sized to land just under the target: shrunk until it does.
  let chars = Math.max(0, Math.floor((target - bagBytes(entries, lookupId, height, settings)) * 0.75) - 150)
  while (chars > 0 && bagBytes([...entries, message(chars)], lookupId, height, settings) > target - 80) chars -= Math.max(1, Math.floor((bagBytes([...entries, message(chars)], lookupId, height, settings) - target + 80) * 0.75))
  if (chars > 0) add(message(chars))
  const like = S().mine.find((d) => d.lookupId === lookupId)
  const plane = like?.plane ?? 0
  const bag = await C().signEvent(await bagTemplate(entries, key, lookupId, height, (standing?.created_at ?? now) + 5, HIDDEN_KIND, settings, { at, plane }))
  relay.events.push(bag as Ev)
  const rows: MyDeployment[] = rumors.map((r) => ({ eventId: r.id, inner: r, bagId: bag.id, bagAt: bag.created_at, type: 'message', text: r.content, at: like?.at ?? { x: at.x.toString(), y: at.y.toString(), z: at.z.toString() }, plane, height, lookupId, keyHex: bytesToHex(key), relays: ['wss://relay.test'], createdAt: r.created_at, published: true, bag: settings, ...(room ? { room } : {}) }))
  useShards.setState({ mine: [...S().mine.map((d) => (d.lookupId === lookupId && !omit.has(d.eventId) ? { ...d, bagId: bag.id, bagAt: bag.created_at } : d)), ...rows] })
  const size = JSON.stringify(bag).length
  expect(size).toBeLessThanOrEqual(target)
  expect(size).toBeGreaterThan(target - 1_000)
}

/** The room bag behind a door: its key and lookup id. */
function roomOf(door: MyDeployment): { key: Uint8Array; lookupId: string } {
  const key = roomKey(hexToBytes(door.keyHex), hexToBytes(doorSecret(me(), door.eventId)!))
  return { key, lookupId: roomLookupId(key) }
}

beforeEach(() => {
  relay.events = []
  relay.sent = []
  relay.refuseKind = -1
  lock = forgeKey('Silver Key')
  localStorage.removeItem('onosendai:door-secrets')
  localStorage.removeItem('onosendai:chests-opened')
  resetDoorSecrets()
  resetOpenedChests()
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, selectedSecret: null, deployLeaveOut: [], deployRoomSnap: null, deployInto: null, deployDoorHeight: null, placedLast: null })
  useBuilder.getState().exit()
  useStash.getState().close()
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useCyberspace.setState({ live: true, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('a shard goes by reference when its bag would not hold it inline', () => {
  it('the owner’s case: the coil into a room bag at ~236 KB goes by reference, the object first, and the room fits', async () => {
    const model = coil()
    const door = await sealDoor()
    const room = roomOf(door)
    // A first small thing behind the door makes the room bag, so the fill has a place to stand.
    S().startDeployMessage('first')
    S().setDeployHeight(H)
    await S().deploy()
    expect(S().deployError).toBeNull()
    S().cancelDeploy()
    expect(S().mine.find((d) => d.text === 'first')?.room).toEqual({ doorId: door.eventId })
    await fill(room.lookupId, room.key, positionOf(door), H, 236_000, { doorId: door.eventId })
    const sent = relay.sent.length
    const { row, error } = await place(model)
    expect(error).toBeNull()
    expect(row?.room).toEqual({ doorId: door.eventId })
    expect(row?.ref?.[0]).toBe('a')
    expect(row?.ref?.[1]).toBe(`${OBJECT_KIND}:${me()}:${dOf(row!.inner)}`)
    expect(row?.inner.kind).toBe(OBJECT_KIND)
    const bag = newestBag(room.lookupId)
    expect(JSON.stringify(bag).length).toBeLessThanOrEqual(BAG_SAFE_BYTES)
    // The object went out before the bag that names it.
    const out = relay.sent.slice(sent)
    const objectAt = out.indexOf(row!.inner.id)
    const bagAt = out.indexOf(bag.id)
    expect(objectAt).toBeGreaterThanOrEqual(0)
    expect(bagAt).toBeGreaterThan(objectAt)
    // Sealed with the room's key, as private as the room bag: the region's key does not open it.
    const enc = row!.inner.tags.find((t) => t[0] === 'encrypted')!
    expect(enc[3]).toBe('cyberspace:region')
    expect(await decryptForRegion(room.key, enc[2])).toBe(payloadOf(model))
    expect(await decryptForRegion(hexToBytes(door.keyHex), enc[2])).toBeNull()
    expect(row!.inner.tags.some((t) => t[0] === 'C' || t[0] === 'H' || t[0] === '-')).toBe(false)
  }, 60000)

  it('a reader opens the bag, resolves the reference, and gets the same shard', async () => {
    const model = coil()
    const seed = await place({ ...model }, H)
    expect(seed.row?.ref).toBeUndefined()
    const lookupId = seed.row!.lookupId
    const key = hexToBytes(seed.row!.keyHex)
    await fill(lookupId, key, positionOf(seed.row!), H, 236_000)
    // A second shard with the same geometry: the same one at the same point in
    // the same second would be the very same event, and the bag holds it once.
    const twin: ShardModel = { ...model, id: 'coil-twin', name: 'cistern-coil twin' }
    useWorkshop.setState({ shards: [model, twin] })
    const { row, error } = await place(twin)
    expect(error).toBeNull()
    expect(row?.ref).toBeDefined()
    // The first coil, inline before, keeps its form: only what this write wrote changed.
    const entries = await bagEntries(newestBag(lookupId) as NostrEvent, key)
    expect(entries.some((e) => !Array.isArray(e) && e.id === seed.row!.eventId && e.kind === SHARD_KIND)).toBe(true)
    const found = await unbag(newestBag(lookupId) as NostrEvent, key, resolveReference, undefined, H)
    const byRef = found.find((h) => h.eventId === row!.inner.id)!
    const inline = found.find((h) => h.eventId === seed.row!.eventId)!
    expect(byRef.type).toBe('shard')
    expect(byRef.ref).toEqual(row!.ref)
    expect(byRef.shard!.vertices).toEqual(inline.shard!.vertices)
    expect(byRef.shard!.vertices).toHaveLength(model.vertices.length)
    expect(byRef.shard!.name).toBe(twin.name)
    // The object's payload is the inline item's content, byte for byte.
    const enc = row!.inner.tags.find((t) => t[0] === 'encrypted')!
    expect(await decryptForRegion(key, enc[2])).toBe(payloadOf(twin))
  }, 60000)

  it('the same shard into an empty bag stays inline', async () => {
    const { row, error } = await place(coil())
    expect(error).toBeNull()
    expect(row?.ref).toBeUndefined()
    expect(row?.inner.kind).toBe(SHARD_KIND)
    expect(relay.events.some((e) => e.kind === OBJECT_KIND)).toBe(false)
  }, 60000)

  it('a bag full of entries that cannot go by reference still refuses, in the same words, with nothing signed or sent', async () => {
    const model = coil()
    // Start the bag with a message, so the fill is all messages.
    S().startDeployMessage('first')
    S().setDeployHeight(H)
    await S().deploy()
    S().cancelDeploy()
    const first = S().mine.find((d) => d.text === 'first')!
    await fill(first.lookupId, hexToBytes(first.keyHex), positionOf(first), H, BAG_SAFE_BYTES - 40)
    const sent = relay.events.length
    const real = C().signEvent
    let signed = 0
    useCyberspace.setState({ signEvent: ((...args: Parameters<typeof real>) => { signed++; return real(...args) }) as typeof real })
    try {
      const { row, error } = await place(model)
      expect(error).toMatch(/^Too large for one bag: [\d,]+ of 240,000 bytes\. Nothing was sent\.$/)
      expect(row).toBeUndefined()
      expect(relay.events.length).toBe(sent)
      expect(signed).toBe(0)
    } finally {
      useCyberspace.setState({ signEvent: real })
    }
  }, 60000)

  it('SEAL of an inline shard into a full room moves it by reference; the room fits and reads it back', async () => {
    const model = coil()
    const { row: before } = await place(model)
    expect(before?.ref).toBeUndefined()
    const door = await sealDoor()
    const room = roomOf(door)
    expect(hereInRoom(S().mine, door).map((m) => m.eventId)).toEqual([before!.eventId])
    // A room bag already near the cap.
    S().startDeployMessage('behind')
    S().setDeployHeight(H)
    await S().deploy()
    expect(S().deployError).toBeNull()
    S().cancelDeploy()
    await fill(room.lookupId, room.key, positionOf(door), H, 236_000, { doorId: door.eventId })
    expect(await S().sealIntoRoom(door.eventId, [before!.eventId])).toBeNull()
    const moved = S().mine.find((d) => d.type === 'shard')!
    expect(moved.room).toEqual({ doorId: door.eventId })
    expect(moved.ref).toBeDefined()
    expect(moved.inner.kind).toBe(OBJECT_KIND)
    expect(JSON.stringify(newestBag(room.lookupId)).length).toBeLessThanOrEqual(BAG_SAFE_BYTES)
    const found = await unbag(newestBag(room.lookupId) as NostrEvent, room.key, resolveReference, undefined, H, undefined, { doorId: door.eventId })
    expect(found.find((h) => h.eventId === moved.inner.id)?.shard?.vertices).toHaveLength(model.vertices.length)
    // The ordinary bag no longer names it.
    const left = await bagEntries(newestBag(door.lookupId) as NostrEvent, hexToBytes(door.keyHex))
    expect(left.some((e) => !Array.isArray(e) && e.id === before!.eventId)).toBe(false)
    expect(ownDoors(S().mine, me())).toHaveLength(1)
  }, 60000)
})

describe('HIDE AGAIN', () => {
  it('a copy of an inline shard gone from a bag that is now full goes back by reference, the object first', async () => {
    const model = coil()
    const { row: gone } = await place(model)
    expect(gone?.ref).toBeUndefined()
    // Another device's newer bag, without it and near the cap; a read here marks it gone from its bag.
    await fill(gone!.lookupId, hexToBytes(gone!.keyHex), positionOf(gone!), H, 236_000, undefined, new Set([gone!.eventId]))
    S().startDeployMessage('one more, to read the bag')
    S().setDeployHeight(H)
    await S().deploy()
    expect(S().deployError).toBeNull()
    S().cancelDeploy()
    expect(S().mine.find((d) => d.eventId === gone!.eventId)?.goneFrom).toBeDefined()
    const sent = relay.sent.length
    expect(await S().hideAgain(gone!.eventId)).toBeNull()
    const copy = S().mine.find((d) => d.type === 'shard')!
    expect(copy.eventId).not.toBe(gone!.eventId)
    expect(copy.ref).toBeDefined()
    expect(copy.inner.kind).toBe(OBJECT_KIND)
    const bag = newestBag(gone!.lookupId)
    expect(JSON.stringify(bag).length).toBeLessThanOrEqual(BAG_SAFE_BYTES)
    expect(relay.sent.slice(sent)).toEqual([copy.inner.id, bag.id])
    const found = await unbag(bag as NostrEvent, hexToBytes(gone!.keyHex), resolveReference, undefined, H)
    expect(found.find((h) => h.eventId === copy.inner.id)?.shard?.vertices).toHaveLength(model.vertices.length)
  }, 60000)
})

describe('the deploy bar’s meter shows the form it goes out in', () => {
  it('inline into an empty bag; by reference into a full one, and it fits; too large when nothing can fit', async () => {
    // A region of its own (height 5), so nothing a test before this one left
    // behind under load can stand in the bag it measures.
    const H = 5
    const model = coil()
    const at = CURSOR
    const planned = plannedShard(model, me())
    const meterAt = (point: Position, plane: number, settings: MyDeployment['bag'] & object) => deployBagMeter(bagRowsFor(S().mine, { region: regionOf(point, plane as 0 | 1, H), door: null }), planned, { height: H, settings, owner: me(), room: false, place: { at: point, plane: plane as 0 | 1 } })
    const empty = meterAt(at, buildPlane(C()), S().deployBag)
    expect(empty).toMatchObject({ byReference: false, fitted: false, refusal: null })
    S().startDeployMessage('first')
    S().setDeployHeight(H)
    await S().deploy()
    expect(S().deployError).toBeNull()
    S().cancelDeploy()
    const first = S().mine.find((d) => d.text === 'first')!
    const point = positionOf(first)
    await fill(first.lookupId, hexToBytes(first.keyHex), point, H, 236_000)
    const full = meterAt(point, first.plane, first.bag!)
    expect(full).toMatchObject({ byReference: true, fitted: true, refusal: null })
    expect(full.bytes).toBeLessThanOrEqual(BAG_SAFE_BYTES)
    // What the meter says is what goes out.
    const { row } = await place(model, H)
    expect(row?.ref).toBeDefined()
    expect(Math.abs(full.bytes - JSON.stringify(newestBag(first.lookupId)).length)).toBeLessThanOrEqual(64)
    // Filled past what even a reference fits.
    await fill(first.lookupId, hexToBytes(first.keyHex), point, H, BAG_SAFE_BYTES - 40)
    const over = meterAt(point, first.plane, first.bag!)
    expect(over.refusal).toMatch(/Too large for one bag/)
  }, 60000)
})

/** What the comment panel is given for a world item (hud/SecretModal): its lineage when it has one, else its key. */
function subjectOf(w: WorldItem): CommentSubject {
  return { author: w.author!, lookupId: w.lookupId!, itemId: w.lineage ?? w.key, type: w.type, target: w.target, at: w.at, height: w.height, bagKeyHex: w.bagKeyHex }
}

describe('an inline shard that converts keeps what names it (owner ruling 2026-10-16: comments survive EDIT)', () => {
  it('EDIT in its own bag, now full: by reference, the object first; old comments and notifications still find it', async () => {
    const model = coil()
    const { row: first } = await place(model)
    expect(first?.ref).toBeUndefined()
    const key = hexToBytes(first!.keyHex)
    // A comment on it as it stands inline, sealed to its bag.
    const before = S().worldItems().find((w) => w.key === first!.eventId)!
    const old = subjectOf(before)
    const comment = await C().signEvent(await sealedComment(old, itemParent(old), 'nice coil', Math.floor(Date.now() / 1000), key)) as NostrEvent
    // The bag fills to just under the cap around it; the EDIT turns it, which makes it larger.
    await fill(first!.lookupId, key, positionOf(first!), H, BAG_SAFE_BYTES - 200)
    const sent = relay.sent.length
    S().startEditShard(first!.eventId)
    S().setDeployHeight(H)
    S().turnDeploy(2)
    await S().deploy()
    expect(S().deployError).toBeNull()
    S().cancelDeploy()
    const shards = S().mine.filter((d) => d.type === 'shard')
    expect(shards).toHaveLength(1)
    const row = shards[0]
    expect(row.ref).toBeDefined()
    expect(row.inner.kind).toBe(OBJECT_KIND)
    expect(row.lookupId).toBe(first!.lookupId)
    expect(row.lineage).toBe(first!.eventId)
    const bag = newestBag(first!.lookupId)
    expect(relay.sent.slice(sent)).toEqual([row.inner.id, bag.id])
    expect(JSON.stringify(bag).length).toBeLessThanOrEqual(BAG_SAFE_BYTES)
    // The old inline entry is gone from the bag.
    const entries = await bagEntries(bag as NostrEvent, key)
    expect(entries.some((e) => !Array.isArray(e) && e.id === first!.eventId)).toBe(false)
    // The comment made on the inline version threads under the converted item.
    const after = S().worldItems().find((w) => w.key === row.eventId)!
    expect(after.lineage).toBe(first!.eventId)
    expect(threadComments([comment], subjectOf(after)).map((c) => c.id)).toEqual([comment.id])
    // A comment made now names the object's address too, so a finder (no lineage) threads it.
    const next = subjectOf(after)
    const fresh = await C().signEvent(await sealedComment(next, itemParent(next), 'still nice', Math.floor(Date.now() / 1000), key)) as NostrEvent
    const finder: CommentSubject = { ...next, itemId: row.inner.id }
    expect(threadComments([fresh], finder).map((c) => c.id)).toEqual([fresh.id])
    // A reaction or comment naming the old id still reaches this row.
    expect(hiddenRowFor(S().mine, { id: first!.eventId })?.eventId).toBe(row.eventId)
  }, 60000)

  it('EDIT whose bag no relay takes: the new object is retracted, and the old row stands', async () => {
    const model = coil()
    const { row: first } = await place(model)
    await fill(first!.lookupId, hexToBytes(first!.keyHex), positionOf(first!), H, BAG_SAFE_BYTES - 200)
    relay.refuseKind = HIDDEN_KIND
    const sent = relay.sent.length
    S().startEditShard(first!.eventId)
    S().setDeployHeight(H)
    S().turnDeploy(2)
    await S().deploy()
    const error = S().deployError
    S().cancelDeploy()
    relay.refuseKind = -1
    expect(error).toMatch(/No relay took/)
    const out = relay.events.filter((e) => relay.sent.slice(sent).includes(e.id))
    const object = out.find((e) => e.kind === OBJECT_KIND)
    expect(object).toBeDefined()
    const deletion = out.find((e) => e.kind === 5)
    expect(deletion?.tags.some((t) => t[0] === 'a' && t[1] === `${OBJECT_KIND}:${me()}:${dOf(object!)}`) || deletion?.tags.some((t) => t[0] === 'e' && t[1] === object!.id)).toBe(true)
    expect(S().mine.find((d) => d.eventId === first!.eventId)).toBeDefined()
    expect(S().mine.filter((d) => d.type === 'shard')).toHaveLength(1)
  }, 60000)
})

describe('CONVERT of a chest holding a shard into a full room', () => {
  /** A chest at the cursor, height H, holding the coil, sealed before any door stands there. */
  async function chestWithCoil(): Promise<MyDeployment> {
    coil()
    const before = new Set(S().mine.map((d) => d.eventId))
    S().startPlaceChest()
    S().setDeployHeight(H)
    S().placeChest()
    await S().sealPlacedChest({ name: 'Crate', lock: { pubkey: lock.itemPubkey, label: lock.name }, requires: 'x', contents: [{ kind: 'shard', shardId: coil().id }] })
    expect(S().deployError).toBeNull()
    S().cancelDeploy()
    return S().mine.find((d) => !before.has(d.eventId) && d.type === 'chest')!
  }

  it('the shard goes by reference, its object before the room bag, keeping its lineage; the room reads it', async () => {
    const chest = await chestWithCoil()
    expect(chest.room).toBeUndefined()
    const door = await sealDoor()
    const room = roomOf(door)
    S().startDeployMessage('behind')
    S().setDeployHeight(H)
    await S().deploy()
    expect(S().deployError).toBeNull()
    S().cancelDeploy()
    await fill(room.lookupId, room.key, positionOf(door), H, 236_000, { doorId: door.eventId })
    const sent = relay.sent.length
    expect(await S().convertToDoor(chest.eventId)).toBeNull()
    const moved = S().mine.find((d) => d.type === 'shard')!
    expect(moved.ref).toBeDefined()
    expect(moved.inner.kind).toBe(OBJECT_KIND)
    expect(moved.lookupId).toBe(room.lookupId)
    expect(moved.lineage).toMatch(/^[0-9a-f]{64}$/)
    expect(moved.ref![2]).toBe('wss://relay.test')
    const bag = newestBag(room.lookupId)
    const out = relay.sent.slice(sent)
    expect(out.indexOf(moved.inner.id)).toBeGreaterThanOrEqual(0)
    expect(out.indexOf(bag.id)).toBeGreaterThan(out.indexOf(moved.inner.id))
    expect(JSON.stringify(bag).length).toBeLessThanOrEqual(BAG_SAFE_BYTES)
    const found = await unbag(bag as NostrEvent, room.key, resolveReference, undefined, H, undefined, { doorId: door.eventId })
    expect(found.find((h) => h.eventId === moved.inner.id)?.shard?.vertices).toHaveLength(coil().vertices.length)
  }, 90000)

  it('while LOCAL, a CONVERT that fails takes nothing back: no retraction is signed or sent', async () => {
    useCyberspace.setState({ live: false })
    const chest = await chestWithCoil()
    const door = await sealDoor()
    const room = roomOf(door)
    S().startDeployMessage('behind')
    S().setDeployHeight(H)
    await S().deploy()
    expect(S().deployError).toBeNull()
    S().cancelDeploy()
    await fill(room.lookupId, room.key, positionOf(door), H, 236_000, { doorId: door.eventId })
    const sent = relay.sent.length
    const real = C().signEvent
    const kinds: number[] = []
    // The new door's chest is refused by the signer, after the room bag and the object are signed.
    useCyberspace.setState({ signEvent: ((t: Parameters<typeof real>[0], p?: number) => { kinds.push(t.kind); if (t.kind === 3341) return Promise.reject(new Error('refused')); return real(t, p) }) as typeof real })
    try {
      expect(await S().convertToDoor(chest.eventId)).toMatch(/refused/)
    } finally {
      useCyberspace.setState({ signEvent: real })
    }
    expect(kinds).toContain(OBJECT_KIND)
    expect(kinds).not.toContain(5)
    expect(relay.sent.length).toBe(sent)
  }, 90000)
})

describe('the plan measures what is signed (review of #640: the client tag)', () => {
  it('a sweep across the line: never refused when by reference would fit, and never past the cap', async () => {
    const model = coil()
    const seen: string[] = []
    for (let target = 217_560; target <= 217_700; target += 10) {
      relay.events = []
      relay.sent = []
      useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {} })
      S().startDeployMessage('seed')
      S().setDeployHeight(H)
      await S().deploy()
      expect(S().deployError).toBeNull()
      S().cancelDeploy()
      const seed = S().mine[0]
      await fill(seed.lookupId, hexToBytes(seed.keyHex), positionOf(seed), H, target)
      const { row, error } = await place(model)
      expect(error, `at ${target}`).toBeNull()
      expect(JSON.stringify(newestBag(seed.lookupId)).length, `at ${target}`).toBeLessThanOrEqual(BAG_SAFE_BYTES)
      seen.push(row?.ref ? 'ref' : 'inline')
    }
    // The sweep crosses the line: some went inline, some by reference.
    expect(seen).toContain('inline')
    expect(seen).toContain('ref')
  }, 240000)
})
