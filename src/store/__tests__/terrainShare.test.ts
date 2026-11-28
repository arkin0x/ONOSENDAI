/**
 * terrainShare.test.ts - TERRAIN's blocks shared (store/terrainShare.ts,
 * DECK-0009), against a mock relay: nothing here reaches any real relay,
 * and every key is a throwaway (the store's own minted test identity, and
 * keys made here).
 *
 * - The builder tag rides on the next movement action the player puts a
 *   signature on anyway, with no signature of its own, and no layer goes out
 *   before an action carrying it is on the relay.
 * - LOCAL never publishes; back to LIVE, the layer goes out: only the DECK's
 *   tags, sealed, within the free-text bounds, carrying your Crew.
 * - The Crew: written into every layer you publish; adding or removing
 *   someone publishes your layers again; ADD BACK.
 * - The cadence, and pacing for the relay's rate limit.
 * - Retiring this device's key: both tags on the next move, then your blocks
 *   again under the new key.
 * - Reading by the Stack: a stranger's blocks drawn; their newer layer never
 *   overrides yours; whom you follow outranks a newer stranger; a mute hides
 *   them; a retired key voids its layers.
 * - The cursor's outline colour: yours, your home, a builder who lists you,
 *   someone else's, unbuilt ground.
 * - Two identities: A publishes; B, another throwaway on the same device,
 *   reads and draws A's holes and surveyed ground in HOP, WALK and TERRAIN,
 *   LIVE or LOCAL, against a mock relay that refuses a tag filter mixing a
 *   key with a word, as the canonical relay does.
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
import { nip19 } from 'nostr-tools'
import { useCyberspace } from '../useCyberspace'
import { useWalk } from '../useWalk'
import { setTerrainSession, surveyTarget, terrainSession, useTerrain } from '../useTerrain'
import {
  AIM_COLORS, BATCH_NEAR, LAYER_CONTENT, RATE_BACKOFF_MS, addCrew, aimAt, chunkRegionKey, confirmTags, flush, liveChanged, readChunks,
  removeCrew, resetShare, retireDeviceKey, sceneDraws, setShareDeps, shownRevision, useShare,
} from '../terrainShare'
import { groundFor, groundRevisionFor } from '../useTerrain'
import { explicitCells } from '../terrainShare'
import { setGroundWriteRevisionForTests } from '../../lib/terrain/groundRevision'
import { SURVEYED, foldChunk, openTerrainDb, readOwner } from '../../lib/terrain/terrainDb'
import { encodeLayer } from '../../lib/terrain/layer'
import { putMany } from '../../lib/idb'
import BLOCKS from '../../lib/__tests__/fixtures/deck0009-blocks-vectors.json'
import { builderRecord, forgetBuilderRecords, namedKey } from '../../lib/terrain/builderKey'
import { fixTags, onActionSigned } from '../../lib/terrain/builderTags'
import { chunkKey, chunkOf, type ChunkBase } from '../../lib/terrain/coords'
import { generate, type GroundRevision } from '../../lib/terrain/generate'
import { EMPTY, kindId } from '../../lib/terrain/blocks'
import { readLayer, type KeyStatus } from '../../lib/terrain/layerReader'
import { keyStatusOn } from '../../lib/terrain/builderStatus'
import { wallItems } from '../walkWalls'
import { LAYER_KIND, builderKeyValid, encodePlane, inHome, resolveStack, expandRuns, freeTextWithinBounds, layerTags, nextPlaintext, parsePlaintext, plaintextJson } from '../../lib/terrain/blockLayer'
import { encryptForRegion, decryptForRegion } from '../../lib/shardCrypto'
import { spawnTemplate, type NostrEvent } from '../../lib/events'
import type { Filter } from 'nostr-tools/filter'
import type { RayHit } from '../../lib/terrain/raycast'

const T = () => useTerrain.getState()
const me = (): string => useCyberspace.getState().identity.pubkey
const settle = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms))
const sign = (t: { kind: number; created_at: number; tags: string[][]; content: string }) => useCyberspace.getState().signEvent(t)

/** The mock canonical relay. */
let held: NostrEvent[] = []
let published: NostrEvent[] = []
let near = false
let muted = new Set<string>()
let follows: string[] = []
const sentAt = new Map<string, number>()

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

/** Where your spawn stands: the chunk of your home. */
function spawnPlace(): { x: bigint; y: bigint; z: bigint; plane: 0 | 1 } {
  const c = coordToXyz(hexToCoord(me()))
  return { x: c.x, y: c.y, z: c.z, plane: c.plane as 0 | 1 }
}

function standAt(p: { x: bigint; y: bigint; z: bigint; plane: number }): void {
  const at = { x: p.x, y: p.y, z: p.z }
  useCyberspace.setState({ position: { ...at }, cursor: { ...at }, anchor: { ...at }, plane: p.plane as 0 | 1, walking: false, spectate: null, exploreIndex: null, transit: null })
}

beforeEach(async () => {
  if (T().active) await T().exit()
  setTerrainSession(null)
  useTerrain.setState({ active: false, loading: false })
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  resetShare()
  // The scene draws blocks (scene/TerrainLayer.tsx mounts this in the app): others' layers are read.
  sceneDraws(true)
  forgetBuilderRecords()
  held = []
  published = []
  near = false
  muted = new Set()
  follows = []
  useWalk.setState({ gravity: false })
  useCyberspace.setState({ events: [], signerKind: 'local' })
  setShareDeps({
    live: () => true,
    publish: async (ev) => { sentAt.set(ev.id, Date.now()); published.push(ev); hold(ev); return { ok: true } },
    query: async (f) => held.filter((e) => matches(f, e)),
    keyStatus: async (author, keys) => new Map<string, KeyStatus>(keys.map((k) => [k, builderKeyValid(k, held.filter((e) => e.pubkey === author && e.kind === 3333)) ? 'valid' : 'void'])),
    ground: async (b, r) => generate(b, null, r).blocks,
    muted: () => muted,
    follows: async () => follows,
    othersNear: () => near,
    verify: (ev) => verifyEvent(ev as never),
    now: () => Date.now(),
  })
})

afterEach(async () => {
  if (T().active) await T().exit()
  sceneDraws(false)
})

/** Open TERRAIN at `at` (your spawn when not given), sign your spawn (it names the builder key), and let the relay hold it. */
async function named(onRelay = true, at?: { x: bigint; y: bigint; z: bigint; plane: number }): Promise<{ spawn: NostrEvent; key: string; base: ChunkBase }> {
  const p = at ?? spawnPlace()
  standAt(p)
  await T().enter()
  const key = builderRecord(me())!.current!
  const spawn = await sign(spawnTemplate(me(), Math.floor(Date.now() / 1000)))
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

/** A published layer's plaintext, opened with its chunk's key. */
async function opened(ev: NostrEvent, base: ChunkBase) {
  const text = await decryptForRegion(chunkRegionKey(base).key, ev.tags.find((t) => t[0] === 'encrypted')![2])
  return parsePlaintext(text!)!
}

describe('the builder key is named on the next move you sign anyway', () => {
  it('the tag rides on the next movement action, with no signature of its own; no layer before the relay holds it', async () => {
    const signed: string[] = []
    const off = onActionSigned((ev) => signed.push(ev.id))
    try {
      const { spawn, key } = await named(false)
      expect(key).not.toBe(me())
      expect(spawn.tags).toContainEqual(['builder', key])
      expect(signed).toEqual([spawn.id])
      await surveyHere()
      mineSome(3)
      await flush('test')
      expect(published).toHaveLength(0)
      expect(useShare.getState().words).toMatch(/next move/)
      const again = await sign({ kind: 3333, created_at: Math.floor(Date.now() / 1000), tags: [['A', 'hop']], content: '' })
      expect(again.tags).toContainEqual(['builder', key])
      const fixed = await sign(fixTags({ kind: 3333, created_at: Math.floor(Date.now() / 1000), tags: [['A', 'hop']], content: '' }))
      expect(fixed.tags.some((t) => t[0] === 'builder')).toBe(false)
      hold(spawn)
      await confirmTags()
      expect(namedKey(me())?.named).toBe(spawn.id)
      const after = await sign({ kind: 3333, created_at: Math.floor(Date.now() / 1000), tags: [['A', 'hop']], content: '' })
      expect(after.tags.some((t) => t[0] === 'builder')).toBe(false)
    } finally { off() }
  })
})

describe('publishing', () => {
  it('LOCAL never publishes; back to LIVE the layer goes out: the DECK\'s tags only, sealed, within bounds, and it reads back', async () => {
    let isLive = false
    setShareDeps({ live: () => isLive })
    const { key, base } = await named()
    await surveyHere()
    expect(mineSome(3)).toBe(3)
    await flush('test')
    await T().exit()
    await settle(100)
    expect(published).toHaveLength(0)
    expect(useShare.getState().words).toMatch(/LOCAL/)
    isLive = true
    liveChanged(true)
    await settle(300)
    expect(published).toHaveLength(1)
    const ev = published[0]
    expect(ev.kind).toBe(33339)
    expect(ev.pubkey).toBe(key)
    expect(ev.content).toBe(LAYER_CONTENT)
    expect(ev.tags.map((t) => t[0])).toEqual(['d', 'p', 'encrypted', 'version'])
    expect(ev.tags).toContainEqual(['p', me()])
    expect(freeTextWithinBounds(ev)).toBe(true)
    expect(useShare.getState().state).toBe('shared')
    const { key: rk, lookupId } = chunkRegionKey(base)
    const g = generate(base).blocks
    const r = await readLayer(ev, { verify: (e) => verifyEvent(e as never), key: rk, lookupId, ground: async () => g, keyStatus: async () => 'valid' })
    expect(r.status).toBe('counted')
    if (r.status !== 'counted') return
    expect(r.layer.planes[0].changed.length).toBeGreaterThanOrEqual(3)
    expect(r.plaintext.cobuilders).toEqual([])
  })
})

describe('a block placed in open air', () => {
  it('is stored and goes out in your layer exactly as any placed block, touching nothing', async () => {
    const { base } = await named()
    const key = await surveyHere()
    const s = terrainSession!
    expect(mineSome(1)).toBe(1)
    const id = Number(Object.keys(T().inventory.counts)[0])
    T().selectSlot(T().inventory.hotbar.indexOf(id))
    // An open cell with open space on all six sides, in the chunk you stand in, clear of your body's column.
    const sl = s.world.slotByKey(key)!
    const head = useCyberspace.getState().cursor
    const w = [Number(head.x - s.world.origin.x), Number(head.y - s.world.origin.y), Number(head.z - s.world.origin.z)]
    const open = (x: number, y: number, z: number): boolean => s.world.blockCs(x, y, z) === EMPTY
    let cell: [number, number, number] | null = null
    for (let y = 30; y > 1 && !cell; y--) for (let z = 2; z < 30 && !cell; z++) for (let x = 2; x < 30 && !cell; x++) {
      const c: [number, number, number] = [32 * sl.off[0] + x, 32 * sl.off[1] + y, 32 * sl.off[2] + z]
      if (c[0] === w[0] && c[2] === w[2]) continue
      if (open(...c) && open(c[0] - 1, c[1], c[2]) && open(c[0] + 1, c[1], c[2]) && open(c[0], c[1] - 1, c[2]) && open(c[0], c[1] + 1, c[2]) && open(c[0], c[1], c[2] - 1) && open(c[0], c[1], c[2] + 1)) cell = c
    }
    expect(cell).not.toBeNull()
    expect(T().place(null, { cell: cell!, eye: null })).toBe(true)
    await flush('test')
    await settle(100)
    const ev = published.at(-1)!
    expect(ev.kind).toBe(LAYER_KIND)
    const plain = await opened(ev, base)
    const at = s.world.locate(...cell!).cell
    const placed = plain.planes.some((pl) => {
      const idxs = expandRuns(pl.cells, 32768, pl.pal.length)
      return !!idxs && pl.pal[idxs[at]] === id
    })
    expect(placed).toBe(true)
  })
})

describe('the Crew', () => {
  it('is written into every layer you publish; adding and removing someone publishes them again', async () => {
    const friend = getPublicKey(generateSecretKey())
    const { base } = await named()
    await surveyHere()
    mineSome(1)
    await flush('test')
    expect(published).toHaveLength(1)
    expect((await opened(published[0], base)).cobuilders).toEqual([])
    expect(await addCrew(friend)).toBe(true)
    await settle(800)
    expect(useShare.getState().crew).toEqual([friend])
    const withFriend = published.at(-1)!
    expect(published.length).toBe(2)
    expect((await opened(withFriend, base)).cobuilders).toEqual([friend])
    // A new change carries it too.
    mineSome(1)
    await flush('test')
    expect((await opened(published.at(-1)!, base)).cobuilders).toEqual([friend])
    const before = published.length
    expect(await removeCrew(friend)).toBe(true)
    await settle(800)
    expect(published.length).toBe(before + 1)
    expect((await opened(published.at(-1)!, base)).cobuilders).toEqual([])
  })
})

describe('the Crew as kept', () => {
  it('a layer that goes out before TERRAIN opens again still carries the Crew kept on the device', async () => {
    const friend = getPublicKey(generateSecretKey())
    const { base } = await named()
    expect(await addCrew(friend)).toBe(true)
    await settle(300)
    await surveyHere()
    mineSome(1)
    await settle(50)
    // Everything held in memory is let go (a reload of this module's state); only the device remembers the Crew.
    resetShare()
    expect(useShare.getState().crew).toEqual([])
    mineSome(1)
    await settle(50)
    await flush('test')
    await settle(200)
    const last = published.at(-1)!
    expect((await opened(last, base)).cobuilders).toEqual([friend])
  })
})

describe('the cadence (DECK-0009 §5.7)', () => {
  it('with someone near: 50 waiting changes publish at once', async () => {
    near = true
    await named()
    await surveyHere()
    await settle(50)
    expect(mineSome(BATCH_NEAR - 1)).toBe(BATCH_NEAR - 1)
    await settle(400)
    expect(published.length).toBeGreaterThanOrEqual(1)
  })

  it('with someone near: 3 seconds without a change', async () => {
    near = true
    await named()
    await surveyHere()
    mineSome(1)
    await settle(1000)
    expect(published).toHaveLength(0)
    await settle(2600)
    expect(published).toHaveLength(1)
  }, 10_000)

  it('leaving the chunk by more than 4 blocks', async () => {
    const { base } = await named()
    await surveyHere()
    mineSome(1)
    await settle(50)
    expect(useCyberspace.getState().walking).toBe(true)
    useCyberspace.setState({ cursor: { x: base.x - 3n, y: base.y, z: base.z } })
    await settle(200)
    expect(published).toHaveLength(0)
    useCyberspace.setState({ cursor: { x: base.x - 6n, y: base.y, z: base.z } })
    await settle(300)
    expect(published).toHaveLength(1)
  })

  it('closing TERRAIN', async () => {
    await named()
    await surveyHere()
    mineSome(2)
    await settle(50)
    expect(published).toHaveLength(0)
    await T().exit()
    await settle(300)
    expect(published).toHaveLength(1)
  })
})

describe('pacing for the relay\'s rate limit', () => {
  it('a rate-limit refusal waits and tries again, longer each time, until the layer goes', async () => {
    const tries: number[] = []
    let refusals = 2
    let isLive = false
    setShareDeps({
      live: () => isLive,
      publish: async (ev) => {
        tries.push(Date.now())
        if (ev.kind === LAYER_KIND && refusals > 0) { refusals--; return { ok: false, reason: 'rate-limited: slow down' } }
        published.push(ev); hold(ev); return { ok: true }
      },
    })
    await named()
    await surveyHere()
    mineSome(2)
    await flush('test')
    expect(tries).toHaveLength(0)
    isLive = true
    liveChanged(true)
    const until = Date.now() + 8_000
    while (published.length === 0 && Date.now() < until) await settle(100)
    expect(published).toHaveLength(1)
    expect(tries).toHaveLength(3)
    expect(tries[1] - tries[0]).toBeGreaterThanOrEqual(RATE_BACKOFF_MS - 50)
    expect(tries[2] - tries[1]).toBeGreaterThanOrEqual(2 * RATE_BACKOFF_MS - 50)
  }, 15_000)

  it('back to LOCAL while it waits: the retry never goes out', async () => {
    let isLive = true
    let calls = 0
    setShareDeps({ live: () => isLive, publish: async () => { calls++; return { ok: false, reason: 'rate-limited: slow down' } } })
    await named()
    await surveyHere()
    mineSome(1)
    void flush('test')
    const until = Date.now() + 3_000
    while (calls === 0 && Date.now() < until) await settle(50)
    expect(calls).toBe(1)
    isLive = false
    await settle(RATE_BACKOFF_MS + 500)
    expect(calls).toBe(1)
  }, 10_000)
})

describe('retiring this device\'s key', () => {
  it('both tags on the next move; then your blocks go out again under the new key, paced', async () => {
    const { key: old, base } = await named()
    await surveyHere()
    mineSome(1)
    await flush('test')
    expect(published.map((e) => e.pubkey)).toEqual([old])
    expect(retireDeviceKey()).toBe(true)
    const fresh = builderRecord(me())!.current!
    expect(fresh).not.toBe(old)
    const step = await sign(spawnTemplate(me(), Math.floor(Date.now() / 1000) + 1))
    expect(step.tags).toContainEqual(['builder', fresh])
    expect(step.tags).toContainEqual(['builder-retire', old])
    expect(step.tags).toContainEqual(['R', old])
    hold(step)
    await confirmTags()
    expect(namedKey(me())?.pub).toBe(fresh)
    await settle(800)
    await flush('test')
    const byNew = published.filter((e) => e.pubkey === fresh)
    expect(byNew).toHaveLength(1)
    // The same blocks, under the new key; the old key's layer is void, never emptied.
    expect(published.filter((e) => e.pubkey === old)).toHaveLength(1)
    expect((await opened(byNew[0], base)).planes).toEqual((await opened(published[0], base)).planes)
  })
})

describe('reading by the Stack', () => {
  const HEAD = { x: 0x1234567890abcdef12350n, y: 0xfedcba0987654321fed90n, z: 0x0f0f0f0f0f0f0f0f0f0f0n, plane: 0 as const }

  /** A throwaway builder whose spawn names their builder key (held by the relay). */
  function stranger(): { pubkey: string; builder: Uint8Array; sk: Uint8Array } {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const builder = generateSecretKey()
    const st = spawnTemplate(pubkey, 1_790_000_000)
    hold(finalizeEvent({ ...st, tags: [...st.tags, ['builder', getPublicKey(builder)]] }, sk) as unknown as NostrEvent)
    return { pubkey, builder, sk }
  }

  async function layerBy(who: { pubkey: string; builder: Uint8Array }, base: ChunkBase, cells: Record<number, number>, createdAt: number, crew: string[] = [], revision: GroundRevision = 2, surveyed = createdAt): Promise<void> {
    const g = generate(base, null, revision).blocks
    const values = g.slice()
    for (const [c, v] of Object.entries(cells)) values[Number(c)] = v
    const plain = nextPlaintext(null, base.plane as 0 | 1, values, g, { revision, surveyed }, crew)!
    const { key, lookupId } = chunkRegionKey(base)
    hold(finalizeEvent({ kind: LAYER_KIND, created_at: createdAt, tags: layerTags({ lookupId, author: who.pubkey, encrypted: await encryptForRegion(key, plaintextJson(plain)) }), content: '' }, who.builder) as unknown as NostrEvent)
  }

  /** Open TERRAIN at HEAD with the chunk surveyed; returns the chunk, its ground and a cell helper. */
  async function atHead() {
    await named(true, HEAD)
    const base = chunkOf(HEAD.x, HEAD.y, HEAD.z, 0)
    const g = generate(base).blocks
    const s = terrainSession!
    const at = (c: number): [number, number, number] => [Number(base.x - s.world.origin.x) + (c & 31), Number(base.y - s.world.origin.y) + (c >> 10), Number(base.z - s.world.origin.z) + ((c >> 5) & 31)]
    let air = -1
    let rock = -1
    for (let c = 32767; c >= 0 && (air < 0 || rock < 0); c--) { if (g[c] === EMPTY && air < 0) air = c; if (g[c] !== EMPTY && rock < 0) rock = c }
    return { base, g, at, air, rock, s }
  }

  it('a stranger\'s blocks are drawn; their newer layer never overrides yours; a mute hides them; a retired key voids its layers', async () => {
    const { base, at, air, rock, s } = await atHead()
    const who = stranger()
    await layerBy(who, base, { [air]: 8 }, 1_790_000_100)
    await readChunks([base])
    await settle(300)
    expect(s.world.blockCs(...at(air))).toBe(8)
    // You survey and mine a rock; the stranger, later, puts Glowcore in that cell: yours shows for you.
    await T().survey(s.world.slotAtCs(...at(rock))!.key)
    expect(T().mine({ cell: at(rock), normal: [0, 1, 0], distance: 1 })).toBe(true)
    await layerBy(who, base, { [air]: 8, [rock]: 42 }, 1_790_000_200)
    await readChunks([base])
    await settle(200)
    expect(s.world.blockCs(...at(rock))).toBe(EMPTY)
    expect(s.world.blockCs(...at(air))).toBe(8)
    // Muted: they never built here, for you.
    muted = new Set([who.pubkey])
    await readChunks([base])
    await settle(200)
    expect(s.world.blockCs(...at(air))).toBe(EMPTY)
    // Unmuted, but their key retired: every layer it signed is void.
    muted = new Set()
    resetStatuses()
    const ret = finalizeEvent({ kind: 3333, created_at: 1_790_000_300, tags: [['A', 'hop'], ['builder-retire', getPublicKey(who.builder)], ['R', getPublicKey(who.builder)]], content: '' }, who.sk) as unknown as NostrEvent
    hold(ret)
    await readChunks([base])
    await settle(200)
    expect(s.world.blockCs(...at(air))).toBe(EMPTY)
  })

  it('mining someone else\'s block in open air is an explicit change at the ground value, published as one (§5.4)', async () => {
    const { base, at, air, s } = await atHead()
    const who = stranger()
    await layerBy(who, base, { [air]: 8 }, 1_790_000_100)
    await readChunks([base])
    await settle(300)
    await T().survey(s.world.slotAtCs(...at(air))!.key)
    expect(s.world.blockCs(...at(air))).toBe(8)
    expect(T().mine({ cell: at(air), normal: [0, 1, 0], distance: 1 })).toBe(true)
    expect(s.world.blockCs(...at(air))).toBe(EMPTY)
    await settle(50)
    await flush('test')
    const ev = published.at(-1)!
    const plain = await opened(ev, base)
    const pl = plain.planes.find((p) => p.plane === 0)!
    expect(pl.form).toBe('diff')
    const idxs = expandRuns(pl.cells, 32768, pl.pal.length)!
    expect(pl.pal[idxs[air]]).toBe(0)
    // Read again, yours stands over theirs for you.
    await readChunks([base])
    await settle(200)
    expect(s.world.blockCs(...at(air))).toBe(EMPTY)
  })

  it('whom you follow outranks a newer stranger', async () => {
    const { base, at, air, s } = await atHead()
    const friend = stranger(), other = stranger()
    follows = [friend.pubkey]
    resetFollows()
    await terrainOpenedAgain()
    await layerBy(friend, base, { [air]: 40 }, 1_790_000_100)
    await layerBy(other, base, { [air]: 41 }, 1_790_000_900)
    await readChunks([base])
    await settle(300)
    expect(s.world.blockCs(...at(air))).toBe(40)
  })

  it('the cursor\'s colour: yours mint, theirs amber, a builder who lists you mint with the crew mark, unbuilt ground white; ADD BACK', async () => {
    const { base, at, air, rock, s } = await atHead()
    const them = stranger(), crewing = stranger()
    let air2 = -1
    const g = generate(base).blocks
    for (let c = air - 1; c >= 0 && air2 < 0; c--) if (g[c] === EMPTY) air2 = c
    await layerBy(them, base, { [air]: 8 }, 1_790_000_100)
    await layerBy(crewing, base, { [air2]: 9 }, 1_790_000_100, [me()])
    await T().survey(s.world.slotAtCs(...at(rock))!.key)
    await readChunks([base])
    await settle(300)
    const key = chunkKey(base)
    const aim = (c: number) => { const [x, y, z] = at(c); return aimAt(key, s.world.locate(x, y, z).cell) }
    expect(aim(air)).toBe('other')
    expect(AIM_COLORS.other).toBe('#ffb347')
    expect(aim(air2)).toBe('crew')
    let ground = -1
    for (let c = 0; c < 32768 && ground < 0; c++) if (g[c] !== EMPTY && c !== rock) ground = c
    expect(aim(ground)).toBe('ground')
    expect(T().mine({ cell: at(rock), normal: [0, 1, 0], distance: 1 })).toBe(true)
    // Redrawn with your change: it is yours.
    await readChunks([base])
    s.world.setBlocks(key, g, (await import('../terrainShare')).viewOf(key, g, s.world.slotByKey(key)!.own!))
    expect(aim(rock)).toBe('mine')
    // They list you: "You build on theirs", with ADD BACK until they are in yours.
    expect(useShare.getState().crewOf).toEqual([crewing.pubkey])
    expect(await addCrew(crewing.pubkey)).toBe(true)
    expect(useShare.getState().crew).toContain(crewing.pubkey)
  })

  it('in your home every block is yours to the cursor', async () => {
    const p = spawnPlace()
    await named(true, p)
    const base = chunkOf(p.x, p.y, p.z, p.plane)
    const who = stranger()
    const g = generate(base).blocks
    let air = -1
    for (let c = 32767; c >= 0 && air < 0; c--) if (g[c] === EMPTY) air = c
    await layerBy(who, base, { [air]: 8 }, 1_790_000_100)
    await readChunks([base])
    await settle(300)
    expect(aimAt(chunkKey(base), air)).toBe('mine')
  })

  it('a chunk someone else surveyed: you mine at once with no SURVEY, your layer surveys it too, and your hole stays when you mute them', async () => {
    const { base, g, at, rock, s } = await atHead()
    const who = stranger()
    // Theirs surveys the chunk and changes nothing.
    await layerBy(who, base, {}, 1_790_000_100)
    await readChunks([base])
    await settle(300)
    expect(s.world.blockCs(...at(rock))).toBe(g[rock])
    // SURVEY is only for chunks nobody surveyed.
    expect(surveyTarget()).not.toBe(chunkKey(base))
    expect(T().mine({ cell: at(rock), normal: [0, 1, 0], distance: 1 })).toBe(true)
    expect(T().message ?? '').not.toMatch(/Survey/)
    expect(s.world.blockCs(...at(rock))).toBe(EMPTY)
    await flush('test')
    await settle(300)
    const ev = published.filter((e) => e.kind === LAYER_KIND && e.tags.some((t) => t[0] === 'p' && t[1] === me())).at(-1)!
    const { key: rk, lookupId } = chunkRegionKey(base)
    const r = await readLayer(ev, { verify: (e) => verifyEvent(e as never), key: rk, lookupId, ground: async () => g, keyStatus: async () => 'valid' })
    expect(r.status).toBe('counted')
    if (r.status !== 'counted') return
    // Survey true, against the ground: the one cell you mined, nothing else.
    expect(r.layer.planes[0].survey).toBe(true)
    expect(r.layer.planes[0].changed).toEqual([rock])
    // Muted, they never surveyed it for you: your own survey keeps the ground, and your hole.
    muted = new Set([who.pubkey])
    await readChunks([base])
    await settle(200)
    expect(s.world.blockCs(...at(rock))).toBe(EMPTY)
    let solid = -1
    for (let c = 0; c < 32768 && solid < 0; c++) if (g[c] !== EMPTY && c !== rock) solid = c
    expect(s.world.blockCs(...at(solid))).toBe(g[solid])
  })

  it('in someone else\'s home: you build at once on the ground the owner revealed; your survey is ignored there, your change still counts where the owner made none', async () => {
    const who = stranger()
    const c = coordToXyz(hexToCoord(who.pubkey))
    const p = { x: c.x, y: c.y, z: c.z, plane: c.plane as 0 | 1 }
    await named(true, p)
    const base = chunkOf(p.x, p.y, p.z, p.plane)
    const g = generate(base).blocks
    const s = terrainSession!
    const at = (cell: number): [number, number, number] => [Number(base.x - s.world.origin.x) + (cell & 31), Number(base.y - s.world.origin.y) + (cell >> 10), Number(base.z - s.world.origin.z) + ((cell >> 5) & 31)]
    let rock = -1
    for (let i = 32767; i >= 0 && rock < 0; i--) if (g[i] !== EMPTY) rock = i
    await layerBy(who, base, {}, 1_790_000_100)
    await readChunks([base])
    await settle(300)
    expect(T().mine({ cell: at(rock), normal: [0, 1, 0], distance: 1 })).toBe(true)
    await flush('test')
    await settle(300)
    const ev = published.filter((e) => e.kind === LAYER_KIND && e.tags.some((t) => t[0] === 'p' && t[1] === me())).at(-1)!
    const { key: rk, lookupId } = chunkRegionKey(base)
    const mineR = await readLayer(ev, { verify: (e) => verifyEvent(e as never), key: rk, lookupId, ground: async () => g, keyStatus: async () => 'valid' })
    const theirsEv = held.filter((e) => e.kind === LAYER_KIND && e.tags.some((t) => t[0] === 'p' && t[1] === who.pubkey)).at(-1)!
    const theirsR = await readLayer(theirsEv, { verify: (e) => verifyEvent(e as never), key: rk, lookupId, ground: async () => g, keyStatus: async () => 'valid' })
    if (mineR.status !== 'counted' || theirsR.status !== 'counted') throw new Error('not counted')
    expect(mineR.layer.planes[0].survey).toBe(true)
    expect(mineR.layer.planes[0].changed).toEqual([rock])
    // A third reader: the owner's survey shows the ground, yours is ignored here, and your hole counts.
    const third = getPublicKey(generateSecretKey())
    const view = { me: third, follows: new Set<string>(), home: (a: string) => inHome(a, base) }
    const out = resolveStack([theirsR.layer, mineR.layer], p.plane, view)
    expect(out.surveyed).toBe(true)
    expect(out.values[rock]).toBe(EMPTY)
  })

  it('a chunk drawn but not surveyed for you still refuses: inside a home whose owner has not surveyed it, a stranger\'s survey does not count', async () => {
    const owner = stranger()
    const c = coordToXyz(hexToCoord(owner.pubkey))
    const p = { x: c.x, y: c.y, z: c.z, plane: c.plane as 0 | 1 }
    await named(true, p)
    const base = chunkOf(p.x, p.y, p.z, p.plane)
    const g = generate(base).blocks
    const s = terrainSession!
    const at = (cell: number): [number, number, number] => [Number(base.x - s.world.origin.x) + (cell & 31), Number(base.y - s.world.origin.y) + (cell >> 10), Number(base.z - s.world.origin.z) + ((cell >> 5) & 31)]
    let air = -1
    for (let i = 32767; i >= 0 && air < 0; i--) if (g[i] === EMPTY) air = i
    // The owner places a block without surveying; a stranger surveys the chunk.
    const values = g.slice()
    values[air] = 8
    const plain = { planes: [encodePlane(p.plane, false, values, g, { revision: 2, surveyed: 0 }, new Set())], cobuilders: [] }
    const { key, lookupId } = chunkRegionKey(base)
    hold(finalizeEvent({ kind: LAYER_KIND, created_at: 1_790_000_100, tags: layerTags({ lookupId, author: owner.pubkey, encrypted: await encryptForRegion(key, plaintextJson(plain)) }), content: '' }, owner.builder) as unknown as NostrEvent)
    await layerBy(stranger(), base, {}, 1_790_000_200)
    await readChunks([base])
    await settle(300)
    // Drawn (the owner's block), but not surveyed for you: no building, and SURVEY still offers it.
    expect(s.world.blockCs(...at(air))).toBe(8)
    expect(T().mine({ cell: at(air), normal: [0, 1, 0], distance: 1 })).toBe(false)
    expect(T().message).toMatch(/Survey this chunk/)
    expect(surveyTarget()).toBe(chunkKey(base))
  })
})

describe('two identities: A publishes, B reads and draws in every mode', () => {
  // B is only a pubkey on screen (B only reads): A, the store's own identity, back after each.
  let own: { pubkey: string; npub: string } | null = null
  beforeEach(() => { own = useCyberspace.getState().identity })
  afterEach(async () => {
    if (T().active) await T().exit()
    if (own) useCyberspace.setState({ identity: own, walking: false })
    await settle(100)
  })
  const PLACE = { x: 0x468ace02468ace024680n, y: 0x13579bdf13579bdf13560n, z: 0x0abcdef0abcdef0abce0n, plane: 0 as const }
  const HEX = /^[0-9a-f]{64}$/

  /** The mock relay as the canonical relay answers: one tag filter mixing a 64-hex value (first) with a word is refused. */
  async function ask(f: Filter): Promise<{ events: NostrEvent[]; trouble: unknown }> {
    for (const [k, v] of Object.entries(f)) {
      if (!/^#[a-zA-Z]$/.test(k)) continue
      const vs = v as string[]
      if (vs.length > 1 && HEX.test(vs[0]) && vs.some((x) => !HEX.test(x))) return { events: [], trouble: 'closed: error: could not query events' }
    }
    const got = held.filter((e) => matches(f, e) && (f.until === undefined || e.created_at <= f.until)).sort((a, b) => b.created_at - a.created_at)
    return { events: f.limit ? got.slice(0, f.limit) : got, trouble: null }
  }

  /** A, the store's own throwaway identity: surveys PLACE's chunk and mines three cells, surveys the chunk beside it and leaves it as it is; both layers go out. */
  async function aPublishes(): Promise<{ a: string; mined: Array<[bigint, bigint, bigint]>; rock: [bigint, bigint, bigint]; beside: ChunkBase }> {
    setShareDeps({ keyStatus: (author, keys) => keyStatusOn(ask, author, keys, (e) => verifyEvent(e as never)) })
    await named(true, PLACE)
    const a = me()
    await surveyHere()
    const s = terrainSession!
    const o = s.world.origin
    const base = chunkOf(PLACE.x, PLACE.y, PLACE.z, 0)
    const g = generate(base).blocks
    const off = [Number(base.x - o.x), Number(base.y - o.y), Number(base.z - o.z)]
    const mined: Array<[bigint, bigint, bigint]> = []
    let rock: [bigint, bigint, bigint] | null = null
    for (let c = 0; c < 32768 && (mined.length < 3 || !rock); c++) {
      if (g[c] === EMPTY) continue
      const cell: [number, number, number] = [off[0] + (c & 31), off[1] + (c >> 10), off[2] + ((c >> 5) & 31)]
      const abs: [bigint, bigint, bigint] = [o.x + BigInt(cell[0]), o.y + BigInt(cell[1]), o.z + BigInt(cell[2])]
      if (mined.length < 3) { if (T().mine({ cell, normal: [0, 1, 0], distance: 1 })) mined.push(abs) } else rock = abs
    }
    const beside = { x: base.x + 32n, y: base.y, z: base.z, plane: 0 as const }
    // A step along x, still in TERRAIN.
    const step = { x: beside.x + 3n, y: PLACE.y, z: PLACE.z }
    useCyberspace.setState({ position: { ...step }, cursor: { ...step } })
    await settle(200)
    await surveyHere()
    await flush('test')
    await T().exit()
    await settle(300)
    expect(published.filter((e) => e.kind === LAYER_KIND)).toHaveLength(2)
    return { a, mined, rock: rock!, beside }
  }

  /** B: another throwaway identity on this device, standing a chunk away in HOP (never in TERRAIN yet). */
  async function bArrives(): Promise<string> {
    const b = getPublicKey(generateSecretKey())
    useCyberspace.setState({ identity: { pubkey: b, npub: `npub-${b.slice(0, 8)}` } })
    standAt({ ...PLACE, z: PLACE.z + 40n })
    await settle(600)
    expect(terrainSession!.owner).toBe(b)
    return b
  }

  const blockAt = (p: readonly [bigint, bigint, bigint]): number => {
    const s = terrainSession!
    const o = s.world.origin
    return s.world.blockCs(Number(p[0] - o.x), Number(p[1] - o.y), Number(p[2] - o.z))
  }

  it('in HOP, WALK and TERRAIN, LIVE: A\'s holes and A\'s surveyed ground show for B, and B walks on them', async () => {
    const { mined, rock, beside } = await aPublishes()
    await bArrives()
    // HOP: read without opening TERRAIN, and drawn.
    for (const m of mined) expect(blockAt(m)).toBe(EMPTY)
    expect(blockAt(rock)).not.toBe(EMPTY)
    // The chunk A surveyed and left as it was: its ground shows too.
    const bg = generate(beside).blocks
    let solid = -1
    for (let c = 0; c < 32768 && solid < 0; c++) if (bg[c] !== EMPTY) solid = c
    const besideCell: [bigint, bigint, bigint] = [beside.x + BigInt(solid & 31), beside.y + BigInt(solid >> 10), beside.z + BigInt((solid >> 5) & 31)]
    expect(blockAt(besideCell)).toBe(bg[solid])
    // WALK: the same blocks, and they are walls.
    useCyberspace.setState({ walking: true })
    await settle(300)
    expect(blockAt(rock)).not.toBe(EMPTY)
    expect(wallItems(0).length).toBeGreaterThan(0)
    // TERRAIN: still there, read again on the way in.
    await T().enter()
    await settle(300)
    for (const m of mined) expect(blockAt(m)).toBe(EMPTY)
    expect(blockAt(rock)).not.toBe(EMPTY)
    expect(blockAt(besideCell)).toBe(bg[solid])
  })

  it('LOCAL reads too, as shards are read in LOCAL: nothing is published, A\'s blocks show for B', async () => {
    const { mined, rock } = await aPublishes()
    const sent = published.length
    setShareDeps({ live: () => false })
    await bArrives()
    for (const m of mined) expect(blockAt(m)).toBe(EMPTY)
    expect(blockAt(rock)).not.toBe(EMPTY)
    expect(published.length).toBe(sent)
  })
})

describe('one device, two npubs: A surveys and digs, B builds there and switches straight back to A', () => {
  const PLACE = { x: 0x1357913579135791357a0n, y: 0x0246802468024680246c0n, z: 0x1112131415161718191a0n, plane: 1 as const }
  let own: { pubkey: string; npub: string } | null = null
  beforeEach(() => { own = useCyberspace.getState().identity })
  afterEach(async () => {
    if (T().active) await T().exit()
    if (own) useCyberspace.setState({ identity: own, walking: false })
    await settle(100)
  })

  /** Every cell of the chunk at PLACE, as an absolute coordinate, from its index. */
  const base = chunkOf(PLACE.x, PLACE.y, PLACE.z, PLACE.plane)
  const absOf = (c: number): [bigint, bigint, bigint] => [base.x + BigInt(c & 31), base.y + BigInt(c >> 10), base.z + BigInt((c >> 5) & 31)]
  const csOf = (p: readonly [bigint, bigint, bigint]): [number, number, number] => {
    const o = terrainSession!.world.origin
    return [Number(p[0] - o.x), Number(p[1] - o.y), Number(p[2] - o.z)]
  }
  const blockAt = (c: number): number => terrainSession!.world.blockCs(...csOf(absOf(c)))

  it('A sees what B changed where A changed nothing, and A\'s own changes where both did', async () => {
    setShareDeps({ keyStatus: (author, keys) => keyStatusOn(async (f) => ({ events: held.filter((e) => matches(f, e) && (f.until === undefined || e.created_at <= f.until)).sort((a, b) => b.created_at - a.created_at).slice(0, f.limit ?? 10_000), trouble: null }), author, keys, (e) => verifyEvent(e as never)) })
    const g = generate(base).blocks
    const solid: number[] = []
    for (let c = 32767; c >= 0 && solid.length < 400; c--) if (g[c] !== EMPTY && (c >> 10) > 2 && g[c + 1024] !== undefined) solid.push(c)
    // Cells: A digs aCells; B digs bCells, and fills A's first hole from the cell beside it.
    const aCells = solid.slice(0, 3)
    const bCells = solid.slice(100, 104)
    const skA = generateSecretKey()
    const skB = generateSecretKey()
    await useCyberspace.getState().useNsec(nip19.nsecEncode(skA))
    expect(me()).toBe(getPublicKey(skA))
    await named(true, PLACE)
    await surveyHere()
    for (const c of aCells) expect(T().mine({ cell: csOf(absOf(c)), normal: [0, 1, 0], distance: 1 })).toBe(true)
    await flush('test')
    await T().exit()
    await settle(300)
    // B, on the same device.
    await useCyberspace.getState().useNsec(nip19.nsecEncode(skB))
    expect(me()).toBe(getPublicKey(skB))
    await named(true, PLACE)
    await settle(300)
    expect(blockAt(aCells[0])).toBe(EMPTY)
    for (const c of bCells) expect(T().mine({ cell: csOf(absOf(c)), normal: [0, 1, 0], distance: 1 })).toBe(true)
    // Fill A's hole: placed against the cell below it.
    const below = aCells[0] - 1024
    expect(T().place({ cell: csOf(absOf(below)), normal: [0, 1, 0], distance: 1 })).toBe(true)
    expect(blockAt(aCells[0])).not.toBe(EMPTY)
    // Straight back to A, with B's changes still waiting: they go out on the switch, signed by B's builder key.
    await useCyberspace.getState().useNsec(nip19.nsecEncode(skA))
    expect(me()).toBe(getPublicKey(skA))
    standAt(PLACE)
    await settle(1200)
    const layers = published.filter((e) => e.kind === LAYER_KIND)
    expect(new Set(layers.map((e) => e.tags.find((t) => t[0] === 'p')![1]))).toEqual(new Set([getPublicKey(skA), getPublicKey(skB)]))
    for (const c of bCells) expect(blockAt(c)).toBe(EMPTY)
    // Where both changed, A's own change shows for A.
    expect(blockAt(aCells[0])).toBe(EMPTY)
    for (const c of aCells) expect(blockAt(c)).toBe(EMPTY)
    // And in TERRAIN.
    await T().enter()
    await settle(300)
    for (const c of bCells) expect(blockAt(c)).toBe(EMPTY)
  })

  it('B LOCAL with storage that cannot save it: LOCAL as it was on screen decides, and nothing of B\'s goes out', async () => {
    const skA = generateSecretKey()
    const skB = generateSecretKey()
    await useCyberspace.getState().useNsec(nip19.nsecEncode(skA))
    await useCyberspace.getState().useNsec(nip19.nsecEncode(skB))
    await named(true, PLACE)
    await surveyHere()
    expect(mineSome(3)).toBe(3)
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    try {
      useCyberspace.getState().setLive(false)
      await settle(100)
    } finally { spy.mockRestore() }
    await useCyberspace.getState().useNsec(nip19.nsecEncode(skA))
    await settle(1200)
    expect(published.filter((e) => e.kind === LAYER_KIND && e.tags.some((t) => t[0] === 'p' && t[1] === getPublicKey(skB)))).toHaveLength(0)
  })

  it('B LOCAL: nothing of B\'s goes out on the switch, and it waits on the device', async () => {
    const skA = generateSecretKey()
    const skB = generateSecretKey()
    await useCyberspace.getState().useNsec(nip19.nsecEncode(skA))
    await useCyberspace.getState().useNsec(nip19.nsecEncode(skB))
    await named(true, PLACE)
    await surveyHere()
    expect(mineSome(3)).toBe(3)
    useCyberspace.getState().setLive(false)
    await settle(100)
    await useCyberspace.getState().useNsec(nip19.nsecEncode(skA))
    await settle(1200)
    expect(published.filter((e) => e.kind === LAYER_KIND && e.tags.some((t) => t[0] === 'p' && t[1] === getPublicKey(skB)))).toHaveLength(0)
  })
})

/** Forget cached key statuses and follows between steps (resetShare forgets them all). */
function resetStatuses(): void {
  // Statuses are trusted for a minute: a step later in time sees a retirement.
  const now = Date.now()
  setShareDeps({ now: () => now + 120_000 })
}
function resetFollows(): void { /* follows are read on TERRAIN's open */ }
async function terrainOpenedAgain(): Promise<void> {
  const { terrainOpened } = await import('../terrainShare')
  await terrainOpened()
  await settle(50)
}

describe('the ground\'s revision (DECK-0009 revision 3: a chunk keeps the revision it was first surveyed at)', () => {
  /** The DECK's vector chunks where revisions 2 and 3 differ: a karst chunk of K 9 (a cinder vent and Glowcore) and a frozen one (a vent of five). */
  const vec = (name: string) => BLOCKS.revision_3.chunks.find((c) => c.name === name)!
  const K9: ChunkBase = { x: BigInt(vec('vent-glowcore-k9').X), y: BigInt(vec('vent-glowcore-k9').Y), z: BigInt(vec('vent-glowcore-k9').Z), plane: 0 }
  const V5: ChunkBase = { x: BigInt(vec('vent-5').X), y: BigInt(vec('vent-5').Y), z: BigInt(vec('vent-5').Z), plane: 0 }
  const g = (b: ChunkBase, r: GroundRevision): Uint8Array => generate(b, null, r).blocks

  /** A place in a chunk open under both revisions, to stand in. */
  function openPlace(b: ChunkBase): { x: bigint; y: bigint; z: bigint; plane: number } {
    const a = g(b, 2), c = g(b, 3)
    for (let o = 32767; o >= 0; o--) if (a[o] === EMPTY && c[o] === EMPTY) return { x: b.x + BigInt(o & 31), y: b.y + BigInt(o >> 10), z: b.z + BigInt((o >> 5) & 31), plane: b.plane }
    throw new Error('no open cell')
  }

  function stranger(): { pubkey: string; builder: Uint8Array } {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const builder = generateSecretKey()
    const st = spawnTemplate(pubkey, 1_790_000_000)
    hold(finalizeEvent({ ...st, tags: [...st.tags, ['builder', getPublicKey(builder)]] }, sk) as unknown as NostrEvent)
    return { pubkey, builder }
  }

  async function layerAt(who: { pubkey: string; builder: Uint8Array }, base: ChunkBase, revision: GroundRevision, createdAt: number, cells: Record<number, number> = {}, surveyed = createdAt): Promise<void> {
    const ground = g(base, revision)
    const values = ground.slice()
    for (const [c, v] of Object.entries(cells)) values[Number(c)] = v
    const plain = nextPlaintext(null, base.plane as 0 | 1, values, ground, { revision, surveyed })!
    const { key, lookupId } = chunkRegionKey(base)
    hold(finalizeEvent({ kind: LAYER_KIND, created_at: createdAt, tags: layerTags({ lookupId, author: who.pubkey, encrypted: await encryptForRegion(key, plaintextJson(plain)) }), content: '' }, who.builder) as unknown as NostrEvent)
  }

  /** Gone as a reload leaves it (nothing in memory), then TERRAIN opened again where you stand. */
  async function reloadAt(p: { x: bigint; y: bigint; z: bigint; plane: number }): Promise<void> {
    if (T().active) await T().exit()
    await settle(100)
    setTerrainSession(null)
    useTerrain.setState({ active: false, loading: false })
    resetShare()
    sceneDraws(true)
    standAt(p)
    await T().enter()
    await settle(200)
  }

  const myLayers = (): NostrEvent[] => published.filter((e) => e.kind === LAYER_KIND && e.tags.some((t) => t[0] === 'p' && t[1] === me()))
  const ownOf = (key: string): Uint8Array => terrainSession!.world.slotByKey(key)!.own!
  const rowOf = async (key: string) => { const db = await openTerrainDb(); try { return (await readOwner(db, me())).revisions.get(key) } finally { db.close() } }

  // An identity of its own, LIVE, whose signer is its own: the describes before switch npubs and go LOCAL.
  beforeEach(async () => {
    await useCyberspace.getState().useNsec(nip19.nsecEncode(generateSecretKey()))
    if (!useCyberspace.getState().live) useCyberspace.getState().setLive(true)
    await settle(50)
  })
  afterEach(() => setGroundWriteRevisionForTests(null))

  it('at write revision 2 a fresh survey is revision 2, and every surveyed plane names `surveyed`, its first version\'s created_at, carried forward', async () => {
    setGroundWriteRevisionForTests(2)
    await named(true, openPlace(K9))
    const key = await surveyHere()
    const slot = terrainSession!.world.slotByKey(key)!
    expect(slot.revision).toBe(2)
    expect(slot.generated).toEqual(g(K9, 2))
    expect(groundRevisionFor(key)).toBe(2)
    expect((await groundFor(key)).blocks).toEqual(g(K9, 2))
    expect(mineSome(2)).toBe(2)
    await flush('test')
    expect(myLayers()).toHaveLength(1)
    const first = (await opened(myLayers()[0], K9)).planes[0]
    // Its date is your survey's on this device, the one your own view used before it went out: never later than the layer.
    const surveyedHere = (await rowOf(key))!.surveyed
    expect(first).toMatchObject({ survey: true, ground: 2, surveyed: surveyedHere })
    expect(surveyedHere).toBeLessThanOrEqual(myLayers()[0].created_at)
    expect(mineSome(1)).toBe(1)
    await flush('test')
    expect(myLayers()).toHaveLength(2)
    const second = (await opened(myLayers()[1], K9)).planes[0]
    expect(myLayers()[1].created_at).toBeGreaterThan(myLayers()[0].created_at)
    expect(second.surveyed).toBe(first.surveyed)
    expect(second.ground).toBe(2)
    expect(await rowOf(key)).toMatchObject({ revision: 2 })
  })

  it('once the write revision is 3, a fresh survey reveals revision 3, names it, and reads back against it', async () => {
    setGroundWriteRevisionForTests(3)
    await named(true, openPlace(K9))
    const key = await surveyHere()
    const slot = terrainSession!.world.slotByKey(key)!
    expect(slot.revision).toBe(3)
    expect(slot.blocks).toEqual(g(K9, 3))
    expect(groundRevisionFor(key)).toBe(3)
    expect(await groundFor(key)).toMatchObject({ revision: 3, blocks: g(K9, 3) })
    expect(mineSome(2)).toBe(2)
    await flush('test')
    const ev = myLayers().at(-1)!
    const pl = (await opened(ev, K9)).planes[0]
    expect(pl.ground).toBe(3)
    const { key: rk, lookupId } = chunkRegionKey(K9)
    const r = await readLayer(ev, { verify: (e) => verifyEvent(e as never), key: rk, lookupId, ground: async (_p, rev) => g(K9, rev), keyStatus: async () => 'valid' })
    if (r.status !== 'counted') throw new Error(r.status)
    // Only your two changes, read against revision 3's ground.
    expect(r.layer.planes[0].changed).toHaveLength(2)
    expect(await rowOf(key)).toMatchObject({ revision: 3 })
  })

  it('a reload keeps your revision 2 and revision 3 chunks as they were, whichever revision this release writes', async () => {
    setGroundWriteRevisionForTests(2)
    // Revision 2, at write revision 2.
    await named(true, openPlace(K9))
    const k9 = await surveyHere()
    mineSome(3)
    const own9 = ownOf(k9).slice()
    // Revision 3, once the write revision is flipped.
    setGroundWriteRevisionForTests(3)
    await reloadAt(openPlace(V5))
    const v5 = await surveyHere()
    mineSome(2)
    const own5 = ownOf(v5).slice()
    expect(terrainSession!.world.slotByKey(v5)!.revision).toBe(3)
    // Back where revision 2 was surveyed: still revision 2, every change kept, though 3 is written now.
    await reloadAt(openPlace(K9))
    expect(terrainSession!.world.slotByKey(k9)!.revision).toBe(2)
    expect(ownOf(k9)).toEqual(own9)
    // And the revision 3 chunk after flipping back to 2: still revision 3.
    setGroundWriteRevisionForTests(2)
    await reloadAt(openPlace(V5))
    expect(terrainSession!.world.slotByKey(v5)!.revision).toBe(3)
    expect(ownOf(v5)).toEqual(own5)
  })

  it('a chunk surveyed before revision 3 (its row names no revision) is revision 2, its layer read against it', async () => {
    setGroundWriteRevisionForTests(3)
    const p = openPlace(K9)
    standAt(p)
    await T().enter()
    await settle(100)
    const key = chunkKey(K9)
    const ground = g(K9, 2)
    const mine = ground.slice()
    let rock = -1
    for (let o = 0; o < 32768 && rock < 0; o++) if (ground[o] !== EMPTY) rock = o
    mine[rock] = EMPTY
    // As a release before revision 3 kept them: a row with no revision and a layer of `ground: 2`.
    const db = await openTerrainDb()
    await putMany(db, SURVEYED, [{ rowKey: `${me()}|${key}`, owner: me(), chunk: key, t: Date.now() - 60_000 }])
    await foldChunk(db, me(), key, encodeLayer(ground, mine, 0, 2), [], Date.now())
    db.close()
    await reloadAt(p)
    const slot = terrainSession!.world.slotByKey(key)!
    expect(slot.revision).toBe(2)
    expect(slot.own).toEqual(mine)
    expect(slot.blocks).toEqual(mine)
  })

  for (const [theirs, write] of [[3, 2], [2, 3]] as const) {
    it(`someone else surveyed it at revision ${theirs}: you are shown revision ${theirs}, and your first change there writes ${theirs} (this release writes ${write})`, async () => {
      setGroundWriteRevisionForTests(write)
      await layerAt(stranger(), K9, theirs, 1_790_000_100)
      await named(true, openPlace(K9))
      await readChunks([K9])
      await settle(300)
      const key = chunkKey(K9)
      const slot = terrainSession!.world.slotByKey(key)!
      expect(slot.revision).toBe(theirs)
      expect(slot.blocks).toEqual(g(K9, theirs))
      expect(shownRevision(key)).toBe(theirs)
      expect(groundRevisionFor(key)).toBe(theirs)
      expect(mineSome(1)).toBe(1)
      await flush('test')
      expect((await opened(myLayers().at(-1)!, K9)).planes[0].ground).toBe(theirs)
      expect(await rowOf(key)).toMatchObject({ revision: theirs })
    })
  }

  it('the base revision goes by rank before date: whom you follow at revision 2 decides over an earlier stranger at revision 3', async () => {
    const friend = stranger(), early = stranger()
    await layerAt(early, K9, 3, 1_790_000_100)
    await layerAt(friend, K9, 2, 1_790_000_500)
    follows = [friend.pubkey]
    await named(true, openPlace(K9))
    await terrainOpenedAgain()
    await readChunks([K9])
    await settle(300)
    const key = chunkKey(K9)
    expect(shownRevision(key)).toBe(2)
    expect(terrainSession!.world.slotByKey(key)!.blocks).toEqual(g(K9, 2))
    // Without the follow, both are strangers: the earlier survey decides.
    follows = []
    await terrainOpenedAgain()
    await readChunks([K9])
    await settle(300)
    expect(shownRevision(key)).toBe(3)
    expect(terrainSession!.world.slotByKey(key)!.blocks).toEqual(g(K9, 3))
  })

  it('a first layer here under a new key, where your other device surveyed earlier at revision 2: it names revision 2, and your blocks move to it (§5.6)', async () => {
    setGroundWriteRevisionForTests(3)
    await named(true, openPlace(K9))
    const key = await surveyHere()
    expect(terrainSession!.world.slotByKey(key)!.revision).toBe(3)
    expect(mineSome(1)).toBe(1)
    const minedHere = [...ownOf(key)].findIndex((v, o) => v !== g(K9, 3)[o])
    // Your other device: a builder key you named, and its layer here, surveyed earlier at revision 2, with one rock mined.
    const other = generateSecretKey()
    hold(await sign({ kind: 3333, created_at: Math.floor(Date.now() / 1000), tags: [['A', 'hop'], ['builder', getPublicKey(other)]], content: '' }))
    const g2 = g(K9, 2)
    let theirRock = -1
    for (let o = 32767; o >= 0 && theirRock < 0; o--) if (g2[o] !== EMPTY && o !== minedHere) theirRock = o
    await layerAt({ pubkey: me(), builder: other }, K9, 2, 1_790_000_100, { [theirRock]: EMPTY })
    await flush('test')
    await settle(300)
    const mine = myLayers().filter((e) => e.pubkey !== getPublicKey(other)).at(-1)!
    const pl = (await opened(mine, K9)).planes[0]
    expect(pl).toMatchObject({ ground: 2, surveyed: 1_790_000_100 })
    const slot = terrainSession!.world.slotByKey(key)!
    expect(slot.revision).toBe(2)
    expect(slot.generated).toEqual(g2)
    // Both changes kept, everything else revision 2's ground.
    const want = g2.slice()
    want[minedHere] = EMPTY
    want[theirRock] = EMPTY
    expect(slot.own).toEqual(want)
    expect(await rowOf(key)).toMatchObject({ revision: 2, surveyed: 1_790_000_100 })
    // And it reads back as exactly those two changes, against revision 2.
    const { key: rk, lookupId } = chunkRegionKey(K9)
    const r = await readLayer(mine, { verify: (e) => verifyEvent(e as never), key: rk, lookupId, ground: async (_p, rev) => g(K9, rev), keyStatus: async () => 'valid' })
    if (r.status !== 'counted') throw new Error(r.status)
    expect(r.layer.planes[0].changed).toEqual([minedHere, theirRock].sort((x, y) => x - y))
  })

  /** A cell where the two revisions' grounds differ, both solid, from the far end (and not `not`). */
  const differing = (b: ChunkBase, not: number[] = []): number => {
    const a = g(b, 2), c = g(b, 3)
    for (let o = 32767; o >= 0; o--) if (a[o] !== c[o] && a[o] !== EMPTY && c[o] !== EMPTY && kindId(a[o]) !== kindId(c[o]) && !not.includes(o)) return o
    return -1
  }

  it('mining and the Quarry Charge carry the base you were shown: your revision 2 survey in a home whose owner surveyed at revision 3', async () => {
    setGroundWriteRevisionForTests(2)
    // A home owner whose home chunk has cells where the revisions differ.
    let owner = stranger(), home: ChunkBase | null = null
    for (let i = 0; i < 40; i++) {
      const c = coordToXyz(hexToCoord(owner.pubkey))
      const b = chunkOf(c.x, c.y, c.z, c.plane)
      if (differing(b) >= 0 && differing(b, [differing(b)]) >= 0) { home = b; break }
      owner = stranger()
    }
    if (!home) throw new Error('no home chunk where the revisions differ')
    await named(true, openPlace(home))
    const key = await surveyHere()
    expect(terrainSession!.world.slotByKey(key)!.revision).toBe(2)
    // The owner surveys at revision 3: inside the home only the owner's survey counts, so you are shown revision 3.
    await layerAt(owner, home, 3, 1_790_000_100)
    await readChunks([home])
    await settle(300)
    expect(shownRevision(key)).toBe(3)
    const s = terrainSession!
    const at = (o: number): [number, number, number] => [Number(home!.x - s.world.origin.x) + (o & 31), Number(home!.y - s.world.origin.y) + (o >> 10), Number(home!.z - s.world.origin.z) + ((o >> 5) & 31)]
    const g2 = g(home, 2), g3 = g(home, 3)
    const c1 = differing(home), c2 = differing(home, [c1])
    expect(s.world.blockCs(...at(c1))).toBe(g3[c1])
    const count = (id: number): number => T().inventory.counts[kindId(id)] ?? 0
    const before = { shown: count(g3[c1]), own: count(g2[c1]) }
    expect(T().mine({ cell: at(c1), normal: [0, 1, 0], distance: 1 })).toBe(true)
    expect(count(g3[c1])).toBe(before.shown + 1)
    expect(count(g2[c1])).toBe(before.own)
    // The Quarry Charge's blast carries the same way.
    const out = T().blast([at(c2)])
    expect(out).toHaveLength(1)
    expect(out[0].carry).toBe(kindId(g3[c2]))
  })

  it('your blocks moved to another revision as they load keep a change that is now the ground\'s value, so it still outranks a stranger (§5.4)', async () => {
    const p = openPlace(K9)
    standAt(p)
    await T().enter()
    await settle(100)
    const key = chunkKey(K9)
    const g2 = g(K9, 2), g3 = g(K9, 3)
    const c = differing(K9)
    expect(c).toBeGreaterThanOrEqual(0)
    // Your layer kept against revision 3, with that cell set to what revision 2's ground holds; the row says revision 2.
    const mine = g3.slice()
    mine[c] = g2[c]
    const db = await openTerrainDb()
    await putMany(db, SURVEYED, [{ rowKey: `${me()}|${key}`, owner: me(), chunk: key, t: Date.now() - 60_000, revision: 2, surveyed: 1_790_000_000 }])
    await foldChunk(db, me(), key, encodeLayer(g3, mine, 0, 3), [], Date.now())
    db.close()
    await reloadAt(p)
    const slot = terrainSession!.world.slotByKey(key)!
    expect(slot.revision).toBe(2)
    expect(slot.own![c]).toBe(g2[c])
    expect(explicitCells(key).has(c)).toBe(true)
    // A stranger changes that cell: yours stands for you.
    await layerAt(stranger(), K9, 2, 1_790_000_100, { [c]: 8 })
    await readChunks([K9])
    await settle(300)
    expect(terrainSession!.world.slotByKey(key)!.blocks![c]).toBe(g2[c])
  })

  it('one date for your survey before and after your first layer: your other device\'s later survey at another revision never flips the base once yours goes out', async () => {
    setGroundWriteRevisionForTests(3)
    await named(true, openPlace(K9))
    const key = await surveyHere()
    const surveyedHere = (await rowOf(key))!.surveyed
    expect(terrainSession!.world.slotByKey(key)!.revision).toBe(3)
    mineSome(1)
    // Your other device surveyed after you, at revision 2, and published first.
    const other = generateSecretKey()
    hold(await sign({ kind: 3333, created_at: Math.floor(Date.now() / 1000), tags: [['A', 'hop'], ['builder', getPublicKey(other)]], content: '' }))
    await layerAt({ pubkey: me(), builder: other }, K9, 2, surveyedHere + 30, {}, surveyedHere + 30)
    // Yours goes out a while later.
    const later = Date.now() + 120_000
    setShareDeps({ now: () => later })
    await flush('test')
    await settle(300)
    const ev = myLayers().filter((e) => e.pubkey !== getPublicKey(other)).at(-1)!
    expect(ev.created_at).toBeGreaterThan(surveyedHere + 30)
    expect((await opened(ev, K9)).planes[0]).toMatchObject({ ground: 3, surveyed: surveyedHere })
    expect(terrainSession!.world.slotByKey(key)!.revision).toBe(3)
  })

  it('the mixed chunk: your revision 2 survey stays the base; a stranger\'s revision 3 layer mines one cell, read against its own ground', async () => {
    setGroundWriteRevisionForTests(2)
    const X = BLOCKS.base_revision.mixed
    await named(true, openPlace(K9))
    const key = await surveyHere()
    await layerAt(stranger(), K9, 3, 1_790_000_100, { [32 * 32 * X.first_differing_cell.y + 32 * X.first_differing_cell.z + X.first_differing_cell.x]: 0 })
    await readChunks([K9])
    await settle(300)
    expect(shownRevision(key)).toBe(2)
    const s = terrainSession!
    const at = (x: number, y: number, z: number) => s.world.blockCs(Number(K9.x - s.world.origin.x) + x, Number(K9.y - s.world.origin.y) + y, Number(K9.z - s.world.origin.z) + z)
    const f = X.first_differing_cell, n = X.shown_at_second_differing_cell
    expect(at(f.x, f.y, f.z)).toBe(X.shown_at_first_differing_cell)
    expect(at(n.x, n.y, n.z)).toBe(n.value)
    // Every other cell is your revision 2 ground.
    const blocks = s.world.slotByKey(key)!.blocks!
    const g2 = g(K9, 2)
    let other = 0
    for (let o = 0; o < 32768; o++) if (blocks[o] !== g2[o]) other++
    expect(other).toBe(1)
  })
})
