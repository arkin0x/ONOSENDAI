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
  AIM_COLORS, BATCH_NEAR, LAYER_CONTENT, RATE_BACKOFF_MS, addCrew, aimAt, chunkRegionKey, confirmTags, flush, liveChanged, readChunks,
  removeCrew, resetShare, retireDeviceKey, setShareDeps, useShare,
} from '../terrainShare'
import { builderRecord, forgetBuilderRecords, namedKey } from '../../lib/terrain/builderKey'
import { fixTags, onActionSigned } from '../../lib/terrain/builderTags'
import { chunkKey, chunkOf, type ChunkBase } from '../../lib/terrain/coords'
import { generate } from '../../lib/terrain/generate'
import { EMPTY } from '../../lib/terrain/blocks'
import { readLayer, type KeyStatus } from '../../lib/terrain/layerReader'
import { LAYER_KIND, builderKeyValid, expandRuns, freeTextWithinBounds, layerTags, nextPlaintext, parsePlaintext, plaintextJson } from '../../lib/terrain/blockLayer'
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
    ground: async (b) => generate(b).blocks,
    muted: () => muted,
    follows: async () => follows,
    othersNear: () => near,
    verify: (ev) => verifyEvent(ev as never),
    now: () => Date.now(),
  })
})

afterEach(async () => {
  if (T().active) await T().exit()
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

  async function layerBy(who: { pubkey: string; builder: Uint8Array }, base: ChunkBase, cells: Record<number, number>, createdAt: number, crew: string[] = []): Promise<void> {
    const g = generate(base).blocks
    const values = g.slice()
    for (const [c, v] of Object.entries(cells)) values[Number(c)] = v
    const plain = nextPlaintext(null, base.plane as 0 | 1, values, g, crew)!
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
    // Not yours to change until you survey the chunk yourself.
    expect(T().mine({ cell: at(air), normal: [0, 1, 0], distance: 1 })).toBe(false)
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
