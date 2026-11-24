/**
 * terrainShare.test.ts - TERRAIN's blocks shared (store/terrainShare.ts,
 * DECK-0009), against a mock relay: nothing here reaches any real relay,
 * and every key is a throwaway (the store's own minted test identity, and
 * keys made here).
 *
 * - The builder tag rides on the next movement action the player puts a signature on
 *   anyway, with no signature of its own, and no layer goes out before an
 *   action carrying it is on the relay.
 * - LOCAL never publishes; back to LIVE, what waited goes out.
 * - The layer's shape: signed by the builder key, sealed to the chunk's
 *   region key, every tag the DECK requires and no other; it reads back.
 * - The cadence: 50 waiting changes with someone near, 3 seconds quiet with
 *   someone near, leaving the chunk by more than 4 blocks, closing TERRAIN.
 * - Retiring this device's key: the next action carries both tags, the next
 *   layer is the new key's, and the old key's layer is emptied.
 * - Another builder's layer, read and merged: drawn and walked on, your own
 *   change drawn over it for you, and gone when you mute them.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
    key: () => null,
    get length() { return mem.size },
  }
}

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { useCyberspace } from '../useCyberspace'
import { useWalk } from '../useWalk'
import { setTerrainSession, terrainSession, useTerrain } from '../useTerrain'
import {
  BATCH_NEAR, chunkRegionKey, confirmTags, flush, liveChanged, readChunks, resetShare, retireDeviceKey, setShareDeps, useShare, LAYER_CONTENT,
} from '../terrainShare'
import { builderRecord, forgetBuilderRecords, namedKey } from '../../lib/terrain/builderKey'
import { fixTags, onActionSigned } from '../../lib/terrain/builderTags'
import { chunkKey, chunkOf, idx, type ChunkBase } from '../../lib/terrain/coords'
import { generate } from '../../lib/terrain/generate'
import { EMPTY, kindId } from '../../lib/terrain/blocks'
import { readLayer } from '../../lib/terrain/layerReader'
import { reachPlaces, readChainOf } from '../../lib/terrain/reachChain'
import { LAYER_KIND, layerTags, plaintextJson, settleId } from '../../lib/terrain/blockLayer'
import { nextPlaintext } from '../../lib/terrain/layerWriter'
import { encryptForRegion } from '../../lib/shardCrypto'
import { hopTemplate, spawnTemplate, type NostrEvent } from '../../lib/events'
import type { Filter } from 'nostr-tools/filter'
import type { RayHit } from '../../lib/terrain/raycast'

const H = '00000000000000000001a7d1f3a2d3c4b5a69788796a5b4c3d2e1f0a1b2c3d4e'
const T = () => useTerrain.getState()
const me = (): string => useCyberspace.getState().identity.pubkey
const settle = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms))
const sign = (t: { kind: number; created_at: number; tags: string[][]; content: string }) => useCyberspace.getState().signEvent(t)

/** The mock canonical relay. */
let held: NostrEvent[] = []
let published: NostrEvent[] = []
let near = false
let muted = new Set<string>()

function matches(f: Filter, e: NostrEvent): boolean {
  if (f.ids && !f.ids.includes(e.id)) return false
  if (f.kinds && !f.kinds.includes(e.kind)) return false
  if (f.authors && !f.authors.includes(e.pubkey)) return false
  // Single-letter tag filters, as NIP-01 relays match them (#d, #p, #R).
  for (const [k, v] of Object.entries(f)) {
    if (!/^#[a-zA-Z]$/.test(k)) continue
    const want = v as string[]
    if (!e.tags.some((t) => t[0] === k[1] && want.includes(t[1]))) return false
  }
  return true
}

function hold(ev: NostrEvent): void {
  // Addressable: the newest per (pubkey, kind, d) replaces the one before.
  if (ev.kind === LAYER_KIND) {
    const d = ev.tags.find((t) => t[0] === 'd')![1]
    held = held.filter((e) => !(e.kind === LAYER_KIND && e.pubkey === ev.pubkey && e.tags.some((t) => t[0] === 'd' && t[1] === d)))
  }
  held.push(ev)
}

/** Where your spawn stands: your home chunk, where your spawn is your reach event. */
function spawnPlace(): { x: bigint; y: bigint; z: bigint; plane: 0 | 1 } {
  const c = coordToXyz(hexToCoord(me()))
  return { x: c.x, y: c.y, z: c.z, plane: c.plane as 0 | 1 }
}

function standAt(p: { x: bigint; y: bigint; z: bigint; plane: number }): void {
  const at = { x: p.x, y: p.y, z: p.z }
  useCyberspace.setState({ position: { ...at }, cursor: { ...at }, anchor: { ...at }, plane: p.plane as 0 | 1, walking: false, spectate: null, exploreIndex: null, transit: null })
}

let own: NostrEvent[] = []
/** Make the mock relay refuse filters naming #p (the read a new key waits for). */
let refuseP = false

beforeEach(async () => {
  if (T().active) await T().exit()
  setTerrainSession(null)
  useTerrain.setState({ active: false, loading: false })
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  resetShare()
  forgetBuilderRecords()
  held = []
  published = []
  own = []
  near = false
  refuseP = false
  muted = new Set()
  useWalk.setState({ gravity: false })
  useCyberspace.setState({ events: [], signerKind: 'local' })
  setShareDeps({
    live: () => true,
    publish: async (ev) => { published.push(ev); hold(ev); return { ok: true } },
    query: async (f) => {
      if (refuseP && (f as Record<string, unknown>)['#p']) throw new Error('unreachable')
      return held.filter((e) => matches(f, e))
    },
    authorChain: async (pk) => held.filter((e) => e.kind === 3333 && e.pubkey === pk),
    ownEvents: () => own,
    v1List: () => new Set(),
    commitBlock: async () => ({ height: 925_000, hash: H }),
    header: async () => 'ok',
    ground: async (b) => generate(b).blocks,
    muted: () => muted,
    follows: async () => [],
    othersNear: () => near,
    // The witness cannot be reached (it does not serve its query yet): every settle unwitnessed.
    witness: { learn: async () => undefined, status: () => null, settle: () => null },
    verify: (ev) => verifyEvent(ev as never),
    now: () => Date.now(),
  })
})

afterEach(async () => {
  if (T().active) await T().exit()
})

/** Open TERRAIN at your spawn, sign your spawn (it names the builder key), and let the relay hold it. */
async function namedAtSpawn(onRelay = true): Promise<{ spawn: NostrEvent; key: string; base: ChunkBase }> {
  const p = spawnPlace()
  standAt(p)
  await T().enter()
  const key = builderRecord(me())!.current!
  const spawn = await sign(spawnTemplate(me(), Math.floor(Date.now() / 1000)))
  own = [spawn]
  if (onRelay) { hold(spawn); await confirmTags() }
  // What the naming sets going (a flush of what waits) is done before the test builds.
  await settle(100)
  return { spawn, key, base: chunkOf(p.x, p.y, p.z, p.plane) }
}

/** Survey the chunk you stand in. */
async function surveyHere(): Promise<string> {
  const s = terrainSession!
  const head = useCyberspace.getState().cursor
  const key = s.world.slotAtCs(Number(head.x - s.world.origin.x), Number(head.y - s.world.origin.y), Number(head.z - s.world.origin.z))!.key
  await T().survey(key)
  return key
}

/** Mine the first `n` solid cells of the chunk you stand in (cs offsets from the field's origin). */
function mineSome(n: number): number {
  const s = terrainSession!
  let done = 0
  for (let y = 0; y < 32 && done < n; y++) for (let z = 0; z < 32 && done < n; z++) for (let x = 0; x < 32 && done < n; x++) {
    if (s.world.blockCs(x, y, z) === EMPTY) continue
    const hit: RayHit = { cell: [x, y, z], normal: [0, 1, 0], distance: 1 }
    if (T().mine(hit)) done++
  }
  return done
}

describe('the builder key is named on the next move you sign anyway', () => {
  it('the tag rides on the next movement action, with no signature of its own; no layer before the relay holds it', async () => {
    const signed: string[] = []
    const off = onActionSigned((ev) => signed.push(ev.id))
    try {
      const { spawn, key } = await namedAtSpawn(false)
      expect(key).not.toBe(me())
      expect(spawn.tags).toContainEqual(['builder', key])
      // One signature: the move itself. The builder key asked nothing of the signer.
      expect(signed).toEqual([spawn.id])
      // Built on, but the relay does not hold the naming yet: nothing published.
      await surveyHere()
      mineSome(3)
      await flush('test')
      expect(published).toHaveLength(0)
      expect(useShare.getState().words).toMatch(/next move/)
      // The next move carries it again: harmless until one is on the relay.
      const again = await sign({ kind: 3333, created_at: Math.floor(Date.now() / 1000), tags: [['A', 'hop']], content: '' })
      expect(again.tags).toContainEqual(['builder', key])
      // A step whose id is already relied on is never changed.
      const fixed = await sign(fixTags({ kind: 3333, created_at: Math.floor(Date.now() / 1000), tags: [['A', 'hop']], content: '' }))
      expect(fixed.tags.some((t) => t[0] === 'builder')).toBe(false)
      // The relay holds the spawn now: named, and owed no more.
      hold(spawn)
      await confirmTags()
      expect(namedKey(me())?.named).toBe(spawn.id)
      const after = await sign({ kind: 3333, created_at: Math.floor(Date.now() / 1000), tags: [['A', 'hop']], content: '' })
      expect(after.tags.some((t) => t[0] === 'builder')).toBe(false)
    } finally { off() }
  })
})

describe('publishing', () => {
  it('LOCAL never publishes; back to LIVE, the layer goes out: the DECK\'s shape, sealed, and it reads back', async () => {
    // LOCAL, as this module is told it (the store's switch, read through its deps).
    let isLive = false
    setShareDeps({ live: () => isLive })
    const { spawn, key, base } = await namedAtSpawn()
    await surveyHere()
    expect(mineSome(3)).toBe(3)
    await flush('test')
    await T().exit()
    await settle(100)
    expect(published).toHaveLength(0)
    expect(useShare.getState().state).toBe('saved')
    expect(useShare.getState().words).toMatch(/LOCAL/)

    isLive = true
    liveChanged(true)
    await settle(300)
    expect(published).toHaveLength(1)
    const ev = published[0]
    expect(ev.kind).toBe(33339)
    expect(ev.pubkey).toBe(key)
    expect(ev.content).toBe(LAYER_CONTENT)
    const { key: rk, lookupId } = chunkRegionKey(base)
    expect(ev.tags.map((t) => t[0])).toEqual(['d', 'p', 'e', 'settle', 'encrypted', 'version'])
    expect(ev.tags).toContainEqual(['d', lookupId])
    expect(ev.tags).toContainEqual(['p', me()])
    expect(ev.tags).toContainEqual(['e', spawn.id, '', 'reach'])
    expect(ev.tags).toContainEqual(['version', '1'])
    // Nothing public says where it is beyond what the DECK requires: no C, no height, no sector, no client.
    for (const name of ['C', 'H', 'h', 'hint', 'S', 'X', 'Y', 'Z', 'client', '-']) expect(ev.tags.some((t) => t[0] === name), name).toBe(false)
    expect(useShare.getState().state).toBe('shared')
    // It opens with the chunk's key and counts by the DECK's checks, against our own chain.
    const g = generate(base).blocks
    const r = await readLayer(ev, {
      verify: (e) => verifyEvent(e as never), key: rk, lookupId, chunk: base, ground: async () => g,
      reach: async (_a, b, ids) => reachPlaces(readChainOf(me(), own, new Set()), b, ids), header: async () => 'ok',
    })
    expect(r.status).toBe('counted')
    if (r.status !== 'counted') return
    expect(r.layer.planes[0].survey).toBe(true)
    // The three mined, and the walker's own gibson if the survey's ground filled it (it is opened, never left in rock).
    expect(r.layer.planes[0].placements.length).toBeGreaterThanOrEqual(3)
    expect(r.layer.planes[0].placements.length).toBeLessThanOrEqual(4)
    for (const c of r.layer.planes[0].placements) expect(r.layer.planes[0].values[c]).toBe(EMPTY)
    expect(settleId(me(), lookupId, r.plaintext.settles[0])).toBe(ev.tags.find((t) => t[0] === 'settle')![1])
  })

  it('a reach event the relay does not hold yet: nothing goes out', async () => {
    await namedAtSpawn()
    held = []
    await surveyHere()
    mineSome(1)
    await flush('test')
    expect(published).toHaveLength(0)
  })
})

describe('the cadence (DECK-0009 §5.7)', () => {
  it('with someone near: 50 waiting changes publish at once', async () => {
    near = true
    await namedAtSpawn()
    await surveyHere()
    await settle(50)
    // The survey itself waits as one change.
    expect(mineSome(BATCH_NEAR - 1)).toBe(BATCH_NEAR - 1)
    await settle(400)
    expect(published.length).toBeGreaterThanOrEqual(1)
  })

  it('with someone near: 3 seconds without a change', async () => {
    near = true
    await namedAtSpawn()
    await surveyHere()
    mineSome(1)
    await settle(1000)
    expect(published).toHaveLength(0)
    await settle(2600)
    expect(published).toHaveLength(1)
  }, 10_000)

  it('leaving the chunk by more than 4 blocks', async () => {
    const { base } = await namedAtSpawn()
    await surveyHere()
    mineSome(1)
    await settle(50)
    expect(published).toHaveLength(0)
    // Walking out of it: 3 blocks past its wall, then 6.
    expect(useCyberspace.getState().walking).toBe(true)
    useCyberspace.setState({ cursor: { x: base.x - 3n, y: base.y, z: base.z } })
    await settle(200)
    expect(published).toHaveLength(0)
    useCyberspace.setState({ cursor: { x: base.x - 6n, y: base.y, z: base.z } })
    await settle(300)
    expect(published).toHaveLength(1)
  })

  it('closing TERRAIN', async () => {
    await namedAtSpawn()
    await surveyHere()
    mineSome(2)
    await settle(50)
    expect(published).toHaveLength(0)
    await T().exit()
    await settle(300)
    expect(published).toHaveLength(1)
  })
})

describe('retiring this device\'s key', () => {
  it('both tags on the next move; the next layer is the new key\'s, and the old key\'s is emptied', async () => {
    const { key: old } = await namedAtSpawn()
    await surveyHere()
    mineSome(1)
    await flush('test')
    expect(published).toHaveLength(1)
    expect(published[0].pubkey).toBe(old)

    expect(retireDeviceKey()).toBe(true)
    const fresh = builderRecord(me())!.current!
    expect(fresh).not.toBe(old)
    const step = await sign({ ...spawnTemplate(me(), Math.floor(Date.now() / 1000) + 1) })
    expect(step.tags).toContainEqual(['builder', fresh])
    expect(step.tags).toContainEqual(['builder-retire', old])
    own = [step]
    hold(step)
    await confirmTags()
    expect(namedKey(me())?.pub).toBe(fresh)
    await settle(300)
    await flush('test')
    const byNew = published.filter((e) => e.pubkey === fresh)
    const byOld = published.filter((e) => e.pubkey === old)
    expect(byNew).toHaveLength(1)
    expect(byOld).toHaveLength(2)
    // The old key's newest layer has no placements left: same planes, one fresh settle claiming nothing.
    const lookupId = byOld[1].tags.find((t) => t[0] === 'd')![1]
    expect(byNew[0].tags).toContainEqual(['d', lookupId])
    expect(byOld[1].tags.filter((t) => t[0] === 'settle')).toHaveLength(1)
    // The move that retired it carried the R tag beside it (§4.3).
    expect(step.tags).toContainEqual(['R', old])
  })
})

describe('a new key at a chunk where another key of yours built (§5.7)', () => {
  it('holds while the other key\'s layer cannot be read, then starts from its cells', async () => {
    const otherSk = generateSecretKey()
    const other = getPublicKey(otherSk)
    const p = spawnPlace()
    standAt(p)
    await T().enter()
    const key = builderRecord(me())!.current!
    // Your spawn names this device's key and another device's.
    const st = spawnTemplate(me(), Math.floor(Date.now() / 1000))
    const spawn = await sign({ ...st, tags: [...st.tags, ['builder', other]] })
    expect(spawn.tags).toContainEqual(['builder', key])
    own = [spawn]
    hold(spawn)
    await confirmTags()
    await settle(100)
    // The other device's layer here: one Gibsonite in the air.
    const base = chunkOf(p.x, p.y, p.z, p.plane)
    const g = generate(base).blocks
    let air = -1
    for (let c = 32767; c >= 0 && air < 0; c--) if (g[c] === EMPTY) air = c
    const values = g.slice()
    values[air] = 43
    const plain = nextPlaintext({ prev: null, plane: p.plane, values, ground: g, block: { height: 924_990, hash: H } })!
    const { key: rk, lookupId } = chunkRegionKey(base)
    const ids = plain.settles.map((x) => settleId(me(), lookupId, x)!)
    hold(finalizeEvent({ kind: LAYER_KIND, created_at: 1_790_000_050, tags: layerTags({ lookupId, author: me(), reach: [spawn.id], settleIds: ids, encrypted: await encryptForRegion(rk, plaintextJson(plain)) }), content: '' }, otherSk) as unknown as NostrEvent)

    refuseP = true
    await surveyHere()
    mineSome(1)
    await flush('test')
    expect(published).toHaveLength(0)
    expect(useShare.getState().words).toMatch(/other devices/)

    refuseP = false
    await flush('test')
    expect(published).toHaveLength(1)
    const ev = published[0]
    expect(ev.pubkey).toBe(key)
    const r = await readLayer(ev, {
      verify: (e) => verifyEvent(e as never), key: rk, lookupId, chunk: base, ground: async () => g,
      reach: async (_a, b, ids2) => reachPlaces(readChainOf(me(), own, new Set()), b, ids2), header: async () => 'ok',
    })
    expect(r.status).toBe('counted')
    if (r.status !== 'counted') return
    const pl = r.layer.planes[0]
    // The other key's Gibsonite, with its settle carried unchanged, and your own change over it.
    expect(pl.values[air]).toBe(43)
    expect(r.plaintext.settles).toContainEqual(plain.settles[0])
    expect(pl.placements.length).toBeGreaterThanOrEqual(2)
    // Not a key this device holds: no emptied layer for it.
    expect(published.some((e) => e.pubkey === other)).toBe(false)
    // It is your own here now, so the next version keeps it.
    const s = terrainSession!
    const slot = s.world.slotByKey(chunkKey(base))!
    expect(slot.own![air]).toBe(43)
  })
})

describe('reading another builder\'s layer', () => {
  /** A throwaway builder whose chain hops to `to`, with their builder key named on the spawn. */
  function stranger(to: { x: bigint; y: bigint; z: bigint }, plane: 0 | 1): { pubkey: string; builder: Uint8Array; hop: NostrEvent } {
    let sk = generateSecretKey()
    let pubkey = getPublicKey(sk)
    while ((parseInt(pubkey.slice(-1), 16) & 1) !== plane) { sk = generateSecretKey(); pubkey = getPublicKey(sk) }
    const builder = generateSecretKey()
    const st = spawnTemplate(pubkey, 1_790_000_000)
    const spawn = finalizeEvent({ ...st, tags: [...st.tags, ['builder', getPublicKey(builder)]] }, sk) as unknown as NostrEvent
    const hop = finalizeEvent(hopTemplate({ createdAt: 1_790_000_001, genesisId: spawn.id, previousId: spawn.id, prevCoordHex: pubkey, to: { ...to }, plane, proofHash: 'ab'.repeat(32), mn: '0'.repeat(16), mp: '00'.repeat(32) }), sk) as unknown as NostrEvent
    hold(spawn)
    hold(hop)
    return { pubkey, builder, hop }
  }

  async function strangerLayer(who: { pubkey: string; builder: Uint8Array; hop: NostrEvent }, base: ChunkBase, cells: Record<number, number>): Promise<void> {
    const g = generate(base).blocks
    const values = g.slice()
    for (const [c, v] of Object.entries(cells)) values[Number(c)] = v
    const plain = nextPlaintext({ prev: null, plane: base.plane as 0 | 1, values, ground: g, block: { height: 924_990, hash: H } })!
    const { key, lookupId } = chunkRegionKey(base)
    const ids = plain.settles.map((s) => settleId(who.pubkey, lookupId, s)!)
    const encrypted = await encryptForRegion(key, plaintextJson(plain))
    hold(finalizeEvent({ kind: LAYER_KIND, created_at: 1_790_000_100, tags: layerTags({ lookupId, author: who.pubkey, reach: [who.hop.id], settleIds: ids, encrypted }), content: '' }, who.builder) as unknown as NostrEvent)
  }

  it('drawn and walked on like yours; your own change shows over it for you; a mute hides them', async () => {
    const HEAD = { x: 0x1234567890abcdef12350n, y: 0xfedcba0987654321fed90n, z: 0x0f0f0f0f0f0f0f0f0f0f0n, plane: 0 as const }
    standAt(HEAD)
    await T().enter()
    const base = chunkOf(HEAD.x, HEAD.y, HEAD.z, 0)
    const g = generate(base).blocks
    // Two cells the stranger changes: one that is air in the ground (they place Prismite), one you will mine too.
    let air = -1
    let rock = -1
    for (let c = 0; c < 32768 && (air < 0 || rock < 0); c++) { if (g[c] === EMPTY && air < 0) air = c; if (g[c] !== EMPTY && rock < 0) rock = c }
    const who = stranger({ x: HEAD.x + 1n, y: HEAD.y, z: HEAD.z }, 0)
    await strangerLayer(who, base, { [air]: 8, [rock]: 42 })
    await readChunks([base])
    await settle(300)
    const s = terrainSession!
    const at = (c: number): [number, number, number] => [Number(base.x - s.world.origin.x) + (c & 31), Number(base.y - s.world.origin.y) + (c >> 10), Number(base.z - s.world.origin.z) + ((c >> 5) & 31)]
    // Shown, though you never surveyed here: they did.
    expect(s.world.blockCs(...at(air))).toBe(8)
    expect(s.world.blockCs(...at(rock))).toBe(42)
    // Not yours to change until you survey it yourself.
    expect(T().mine({ cell: at(rock), normal: [0, 1, 0], distance: 1 })).toBe(false)
    // Surveyed: you mine their Glowcore; you see your change, while their block stays theirs for everyone else.
    await T().survey(s.world.slotAtCs(...at(rock))!.key)
    expect(s.world.blockCs(...at(air))).toBe(8)
    const glow = kindId(42)
    const before = T().inventory.counts[glow] ?? 0
    expect(T().mine({ cell: at(rock), normal: [0, 1, 0], distance: 1 })).toBe(true)
    expect(s.world.blockCs(...at(rock))).toBe(EMPTY)
    // Their block is never carried: you get what was yours there (the ground's rock), not their Glowcore.
    expect(T().inventory.counts[glow] ?? 0).toBe(before)
    expect(T().inventory.counts[kindId(g[rock])]).toBeGreaterThan(0)
    await readChunks([base])
    await settle(100)
    expect(s.world.blockCs(...at(rock))).toBe(EMPTY)
    expect(s.world.blockCs(...at(air))).toBe(8)
    // Muted: they never built here, for you.
    muted = new Set([who.pubkey])
    await readChunks([base])
    await settle(100)
    expect(s.world.blockCs(...at(air))).toBe(EMPTY)
    expect(idx(0, 0, 0)).toBe(0)
  })
})
