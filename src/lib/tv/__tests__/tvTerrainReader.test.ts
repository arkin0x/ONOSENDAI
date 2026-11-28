/**
 * tvTerrainReader.test.ts - Cyberspace TV's TERRAIN reader
 * (lib/tv/terrainReader.ts) and TERRAIN beats (lib/tv/terrainShot.ts),
 * against a mock canonical relay. Every key is a throwaway made here;
 * nothing reaches a real relay.
 *
 * - As of tape time: a layer published at or before it counts whole; one
 *   published after counts only for its surveys dated by then, its cells left
 *   out (kept as `later` for the ghost to come); nothing surveyed yet shows
 *   nothing.
 * - Region keys: derived from the chunk's public corner into TV's own cache,
 *   never the keyring (no secrets database opened, no keyring module used).
 * - No-broadcast: a layer published while its author's newest move carried
 *   the tag (the tutorial), or tagged itself, is skipped; a relay that cannot
 *   say leaves it out and the chunk is read again later.
 * - TERRAIN beats: a small step into a chunk surveyed by then.
 * - Per-chunk caching: a chunk read once, its ground made once, its blocks
 *   stacked once per signature.
 * - Privacy: only public data, asked of the relay as kinds 33339 and 3333.
 */

import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools/filter'
import { CELLS, chunkKey, type ChunkBase } from '../../terrain/coords'
import { generate, type GroundRevision } from '../../terrain/generate'
import { EMPTY } from '../../terrain/blocks'
import { LAYER_KIND, encodePlane, layerTags, plaintextJson } from '../../terrain/blockLayer'
import { encryptForRegion, regionKeyAt } from '../../shardCrypto'
import { NO_BROADCAST } from '../../noBroadcast'
import type { NostrEvent } from '../../events'
import type { KeyStatus } from '../../terrain/layerReader'
import { NB_LOOKBACK_S, TV_READ_AGAIN_MS, TV_RELAY_CAP, TvTerrainReader, chunkRegionKeyOf, cutOff, layerBytes, layersAsOf, tvStackView, type TvTerrainDeps } from '../terrainReader'
import { flagTerrainBeats, isTerrainShot, neighbourhood, terrainStep, TERRAIN_STEP_GIBSONS } from '../terrainShot'
import type { Beat, Shot } from '../director'

const BASE: ChunkBase = { x: 0x468ace02468ace024680n, y: 0x13579bdf13579bdf13560n, z: 0x0abcdef0abcdef0abce0n, plane: 0 }
const ground2 = generate(BASE, null, 2).blocks
const airCells: number[] = []
const solidCells: number[] = []
for (let i = CELLS - 1; i >= 0 && (airCells.length < 4 || solidCells.length < 2); i--) {
  if (ground2[i] === EMPTY && airCells.length < 4) airCells.push(i)
}
for (let i = 0; i < CELLS && solidCells.length < 2; i++) if (ground2[i] !== EMPTY) solidCells.push(i)

interface Who { sk: Uint8Array; pk: string; builder: Uint8Array; builderPk: string }
function who(): Who {
  const sk = generateSecretKey()
  const builder = generateSecretKey()
  return { sk, pk: getPublicKey(sk), builder, builderPk: getPublicKey(builder) }
}

/** A layer by `w` in `base`: surveyed (first at `surveyed`) or not, with `set` cells changed. */
async function layerOf(w: Who, o: { createdAt: number; survey?: boolean; surveyed?: number; revision?: GroundRevision; set?: Array<[number, number]>; tags?: string[][]; base?: ChunkBase }): Promise<NostrEvent> {
  const base = o.base ?? BASE
  const revision = o.revision ?? 2
  const g = base === BASE && revision === 2 ? ground2 : generate(base, null, revision).blocks
  const survey = o.survey ?? true
  const values = survey ? g.slice() : new Uint8Array(CELLS)
  for (const [c, v] of o.set ?? []) values[c] = v
  const plane = encodePlane(base.plane as 0 | 1, survey, values, g, { revision, surveyed: o.surveyed ?? o.createdAt })
  const { key, lookupId } = chunkRegionKeyOf(base)
  const encrypted = await encryptForRegion(key, plaintextJson({ planes: [plane], cobuilders: [] }))
  return finalizeEvent({ kind: LAYER_KIND, created_at: o.createdAt, tags: [...layerTags({ lookupId, author: w.pk, encrypted }), ...(o.tags ?? [])], content: '' }, w.builder) as unknown as NostrEvent
}

/** A movement action by `w` at `t`, tagged no-broadcast or not. */
function moveOf(w: Who, t: number, hidden = false): NostrEvent {
  return finalizeEvent({ kind: 3333, created_at: t, tags: [['A', 'hop'], ...(hidden ? [[NO_BROADCAST]] : [])], content: '' }, w.sk) as unknown as NostrEvent
}

/** The mock canonical relay: NIP-01 matching of kinds, authors, #d, until and limit, newest first. */
function relay(events: NostrEvent[], o: { failMoves?: boolean } = {}) {
  const asked: Filter[] = []
  const grounds: string[] = []
  const valid = new Set<string>()
  const deps: TvTerrainDeps = {
    query: async (f) => {
      asked.push(f)
      if (o.failMoves && f.kinds?.includes(3333)) throw new Error('not heard')
      const d = (f as { '#d'?: string[] })['#d']
      return events
        .filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (f.since === undefined || e.created_at >= f.since) && (f.until === undefined || e.created_at <= f.until))
        .filter((e) => !d || e.tags.some((t) => t[0] === 'd' && d.includes(t[1])))
        .sort((a, b) => b.created_at - a.created_at)
        // As the canonical relay answers: the limit asked, never more than its max_limit of 500.
        .slice(0, Math.min(f.limit ?? TV_RELAY_CAP, TV_RELAY_CAP))
    },
    keyStatus: async (_author, keys) => new Map(keys.map((k): [string, KeyStatus] => [k, valid.has(k) ? 'valid' : 'void'])),
    ground: async (b, r) => { grounds.push(`${chunkKey(b)}|${r}`); return generate(b, null, r).blocks },
    verify: (e) => verifyEvent(e as Parameters<typeof verifyEvent>[0]),
    muted: () => new Set(),
    now: () => 1_800_000_000_000,
  }
  return { deps, asked, grounds, valid }
}

describe('as of tape time', () => {
  it('counts a layer published by then whole, only the surveys of one published later, and nothing before the first survey', async () => {
    const a = who(), b = who()
    const A = await layerOf(a, { createdAt: 1000, set: [[airCells[0], 8]] })
    // B was first surveyed at 900 and last published at 3000: its cells at 950 or 2000 are not known.
    const B = await layerOf(b, { createdAt: 3000, surveyed: 900, set: [[airCells[1], 8], [solidCells[0], EMPTY]] })
    const r = relay([A, B, moveOf(a, 950), moveOf(b, 850)])
    r.valid.add(a.builderPk).add(b.builderPk)
    const reader = new TvTerrainReader(r.deps)
    await reader.prepare([BASE])

    expect(reader.surveyedAsOf(BASE, 800)).toBe(false)
    expect(await reader.blocksAsOf(BASE, 800)).toBeNull()

    const at950 = reader.asOf(BASE, 950)!
    expect(at950.surveyed).toBe(true)
    expect(at950.layers).toHaveLength(0)
    expect(at950.later.map((l) => l.id).sort()).toEqual([A.id, B.id].sort())
    const g950 = (await reader.blocksAsOf(BASE, 950))!
    expect(g950[airCells[0]]).toBe(EMPTY)
    expect(g950[airCells[1]]).toBe(EMPTY)
    expect(g950[solidCells[0]]).toBe(ground2[solidCells[0]])

    const at2000 = reader.asOf(BASE, 2000)!
    expect(at2000.layers.map((l) => l.id)).toEqual([A.id])
    expect(at2000.later.map((l) => l.id)).toEqual([B.id])
    const g2000 = (await reader.blocksAsOf(BASE, 2000))!
    expect(g2000[airCells[0]]).toBe(8)
    expect(g2000[airCells[1]]).toBe(EMPTY)
    expect(g2000[solidCells[0]]).toBe(ground2[solidCells[0]])

    const g3000 = (await reader.blocksAsOf(BASE, 3000))!
    expect(g3000[airCells[0]]).toBe(8)
    expect(g3000[airCells[1]]).toBe(8)
    expect(g3000[solidCells[0]]).toBe(EMPTY)
    expect(reader.asOf(BASE, 3000)!.later).toHaveLength(0)
  })

  it('a later layer never lends its cells or its date as of an earlier time (layersAsOf)', async () => {
    const a = who()
    const L = await layerOf(a, { createdAt: 3000, surveyed: 900, set: [[airCells[2], 8]] })
    const r = relay([L, moveOf(a, 800)])
    r.valid.add(a.builderPk)
    const reader = new TvTerrainReader(r.deps)
    await reader.prepare([BASE])
    const layer = reader.asOf(BASE, 4000)!.layers[0]
    const split = layersAsOf([layer], 0, 1000)
    expect(split.counted).toHaveLength(0)
    expect(split.stack).toHaveLength(1)
    expect(split.stack[0].planes[0].changed).toHaveLength(0)
    expect(split.stack[0].createdAt).toBe(-1)
    expect(layersAsOf([layer], 0, 800).stack).toHaveLength(0)
  })

  it('drops a layer whose builder key is not valid for its author (layerReader §4.4)', async () => {
    const a = who()
    const A = await layerOf(a, { createdAt: 1000, set: [[airCells[0], 8]] })
    const r = relay([A, moveOf(a, 900)])
    const reader = new TvTerrainReader(r.deps)
    await reader.prepare([BASE])
    expect(reader.surveyedAsOf(BASE, 2000)).toBe(false)
  })

  it('leaves out an author the viewer blocked, as TV leaves out their moves', async () => {
    const a = who()
    const A = await layerOf(a, { createdAt: 1000 })
    const r = relay([A, moveOf(a, 900)])
    r.valid.add(a.builderPk)
    let muted = new Set<string>()
    const reader = new TvTerrainReader({ ...r.deps, muted: () => muted })
    await reader.prepare([BASE])
    expect(reader.surveyedAsOf(BASE, 2000)).toBe(true)
    muted = new Set([a.pk])
    expect(reader.surveyedAsOf(BASE, 2000)).toBe(false)
  })
})

describe('region keys stay out of the keyring', () => {
  it('derives each chunk key from its public corner into the reader\'s own cache, opens no secrets database, and lets them go with the reader', async () => {
    const a = who()
    const r = relay([await layerOf(a, { createdAt: 1000 }), moveOf(a, 900)])
    r.valid.add(a.builderPk)
    const reader = new TvTerrainReader(r.deps)
    const other = new TvTerrainReader(r.deps)
    await reader.prepare(neighbourhood(BASE))
    expect(reader.keysHeld()).toBe(27)
    expect(other.keysHeld()).toBe(0)
    // The same key any reader derives from the coordinate: public, held nowhere else.
    const rk = regionKeyAt(BASE, 5, 5)
    expect(reader.regionKey(BASE).lookupId).toBe(rk.lookupId)
    const dbs = await indexedDB.databases()
    expect(dbs.map((d) => d.name)).not.toContain('onosendai:secrets')
    reader.end()
    expect(reader.keysHeld()).toBe(0)
    expect(() => reader.regionKey(BASE)).toThrow()
  })

  it('stopped mid-batch: no key is left and no further question goes out', async () => {
    const a = who()
    const r = relay([await layerOf(a, { createdAt: 1000 }), moveOf(a, 900)])
    r.valid.add(a.builderPk)
    let release: () => void = () => {}
    const held = new Promise<void>((res) => { release = res })
    let asked = 0
    const reader = new TvTerrainReader({ ...r.deps, query: async (f) => { asked++; await held; return r.deps.query(f) } })
    const job = reader.prepare(neighbourhood(BASE))
    await new Promise((res) => setTimeout(res, 10))
    const before = asked
    expect(before).toBeGreaterThan(0)
    expect(reader.keysHeld()).toBeGreaterThan(0)
    reader.end()
    release()
    await job
    await reader.prepare([BASE])
    expect(asked).toBe(before)
    expect(reader.keysHeld()).toBe(0)
    expect(reader.has(BASE)).toBe(false)
  })

  it('never imports the keyring, the secrets store or the viewer\'s own TERRAIN reader', () => {
    for (const f of ['src/lib/tv/terrainReader.ts', 'src/store/useTvTerrain.ts', 'src/lib/tv/terrainShot.ts']) {
      const src = readFileSync(f, 'utf8')
      const imports = src.split('\n').filter((l) => /^import /.test(l)).join('\n')
      expect(imports, f).not.toMatch(/secrets|useSecrets|useKeyring|terrainShare|foundCache|useShards/)
    }
  })
})

describe('no-broadcast stretches', () => {
  it('skips a layer published while its author\'s newest move carried the tag, and one tagged itself', async () => {
    const tutorial = who(), later = who(), self = who()
    const T1 = await layerOf(tutorial, { createdAt: 1000, set: [[airCells[0], 8]] })
    const L = await layerOf(later, { createdAt: 1000, survey: false, set: [[airCells[1], 9]] })
    const S = await layerOf(self, { createdAt: 1000, survey: false, set: [[airCells[2], 10]], tags: [[NO_BROADCAST]] })
    // The tutorial's player: tagged at 990, just before the publish. The other: tagged long before the look-back, untagged since.
    const r = relay([T1, L, S, moveOf(tutorial, 400), moveOf(tutorial, 990, true), moveOf(later, 50, true), moveOf(later, 990), moveOf(self, 990)])
    r.valid.add(tutorial.builderPk).add(later.builderPk).add(self.builderPk)
    const reader = new TvTerrainReader(r.deps)
    await reader.prepare([BASE])
    const at = reader.asOf(BASE, 2000)!
    expect(at.layers.map((l) => l.author)).toEqual([later.pk])
    // The tutorial's survey does not count either: nothing surveyed here on TV.
    expect(at.surveyed).toBe(false)
    const g = (await reader.blocksAsOf(BASE, 2000))!
    expect(g[airCells[0]]).toBe(0)
    expect(g[airCells[1]]).toBe(9)
    expect(g[airCells[2]]).toBe(0)
  })

  it('hides a layer when ANY action in its look-back carries the tag, not only the newest', async () => {
    const a = who()
    const L = await layerOf(a, { createdAt: 5000, survey: false, set: [[airCells[0], 9]] })
    const r = relay([L, moveOf(a, 5000 - 600, true), moveOf(a, 4999)])
    r.valid.add(a.builderPk)
    const reader = new TvTerrainReader(r.deps)
    await reader.prepare([BASE])
    expect(reader.asOf(BASE, 6000)!.layers).toHaveLength(0)
  })

  it('leaves a layer out when its author has no action at all to judge it by, and reads it again later', async () => {
    const a = who()
    const L = await layerOf(a, { createdAt: 5000 })
    const events = [L]
    let now = 1_800_000_000_000
    const r = relay(events)
    r.valid.add(a.builderPk)
    const reader = new TvTerrainReader({ ...r.deps, now: () => now })
    await reader.prepare([BASE])
    expect(reader.surveyedAsOf(BASE, 6000)).toBe(false)
    // The action comes in later (a long build without a move falls back to the newest few before the publish).
    events.push(moveOf(a, 5000 - NB_LOOKBACK_S - 100))
    now += TV_READ_AGAIN_MS
    await reader.prepare([BASE])
    expect(reader.surveyedAsOf(BASE, 6000)).toBe(true)
  })

  it('asks for the actions once per author for a whole batch of chunks', async () => {
    const a = who()
    const other = { ...BASE, x: BASE.x + 32n }
    const r = relay([await layerOf(a, { createdAt: 1000 }), await layerOf(a, { createdAt: 1100, base: other }), moveOf(a, 950)])
    r.valid.add(a.builderPk)
    const reader = new TvTerrainReader(r.deps)
    await reader.prepare([BASE, other])
    expect(reader.surveyedAsOf(BASE, 2000)).toBe(true)
    expect(reader.surveyedAsOf(other, 2000)).toBe(true)
    expect(r.asked.filter((f) => f.kinds?.[0] === 3333)).toHaveLength(1)
  })

  it('leaves a layer out when the relay cannot say, and reads the chunk again later', async () => {
    const a = who()
    const A = await layerOf(a, { createdAt: 1000 })
    let now = 1_800_000_000_000
    let fail = true
    const ok = relay([A, moveOf(a, 900)])
    ok.valid.add(a.builderPk)
    const r = { ...ok.deps, now: () => now, query: async (f: Filter) => { if (fail && f.kinds?.includes(3333)) throw new Error('not heard'); return ok.deps.query(f) } }
    const reader = new TvTerrainReader(r)
    await reader.prepare([BASE])
    expect(reader.surveyedAsOf(BASE, 2000)).toBe(false)
    fail = false
    await reader.prepare([BASE])
    expect(reader.surveyedAsOf(BASE, 2000)).toBe(false)
    now += TV_READ_AGAIN_MS
    await reader.prepare([BASE])
    expect(reader.surveyedAsOf(BASE, 2000)).toBe(true)
  })
})

/** A beat from `from` to `to` (offsets in gibsons from BASE) at `t`. */
function beat(t: number, from: [number, number, number], to: [number, number, number], type = 'hop'): Beat {
  const p = (o: [number, number, number]) => ({ x: BASE.x + BigInt(o[0]), y: BASE.y + BigInt(o[1]), z: BASE.z + BigInt(o[2]) })
  return { id: `b${t}`.padEnd(64, '0'), pubkey: 'a'.repeat(64), at: t, action: { type, position: p(to), plane: 0 } as unknown as Beat['action'], from: { position: p(from), plane: 0 } }
}

describe('TERRAIN beats', () => {
  it('flags a small step into a chunk surveyed by its tape time; not a long hop, not before the survey, not a spawn', async () => {
    const a = who()
    const r = relay([await layerOf(a, { createdAt: 1000, surveyed: 1000 }), moveOf(a, 900)])
    r.valid.add(a.builderPk)
    const reader = new TvTerrainReader(r.deps)
    await reader.prepare([BASE])
    const step = Number(TERRAIN_STEP_GIBSONS)
    const beats = [
      beat(900, [4, 4, 4], [5, 4, 4]),          // before the survey
      beat(1100, [5, 4, 4], [5 + step, 4, 4]),  // a step of 16: TERRAIN
      beat(1200, [5, 4, 4], [6 + step, 4, 4]),  // 17: too far
      beat(1300, [5, 4, 4], [5, 4, 4], 'spawn'),
    ]
    expect(terrainStep(beats[1])).toBe(true)
    expect(terrainStep(beats[2])).toBe(false)
    expect(flagTerrainBeats(beats, (b, t) => reader.surveyedAsOf(b, t))).toBe(true)
    expect(beats.map((b) => !!b.terrain)).toEqual([false, true, false, false])
  })

  it('plays a shot as TERRAIN only with a TERRAIN beat and every move small', () => {
    const small = beat(1100, [1, 1, 1], [2, 1, 1])
    small.terrain = true
    const shot = (beats: Beat[]): Shot => ({ id: beats[0].id, kind: 'trip', pubkey: beats[0].pubkey, beats, start: beats[0].at, end: beats[beats.length - 1].at, offsets: beats.map((_, i) => i), length: beats.length + 3 })
    expect(isTerrainShot(shot([small, beat(1101, [2, 1, 1], [3, 1, 1])]))).toBe(true)
    expect(isTerrainShot(shot([small, beat(1101, [2, 1, 1], [400, 1, 1])]))).toBe(false)
    expect(isTerrainShot(shot([beat(1100, [1, 1, 1], [2, 1, 1])]))).toBe(false)
  })

  it('keeps the drawn ring to the chunk and its 26 neighbours, inside the axes', () => {
    expect(neighbourhood(BASE)).toHaveLength(27)
    expect(neighbourhood({ x: 0n, y: 0n, z: 0n, plane: 0 })).toHaveLength(8)
  })
})

describe('per-chunk caching', () => {
  it('reads a chunk once, makes its ground once, and stacks its blocks once per signature', async () => {
    const a = who()
    const r = relay([await layerOf(a, { createdAt: 1000, set: [[airCells[0], 8]] }), moveOf(a, 900)])
    r.valid.add(a.builderPk)
    const reader = new TvTerrainReader(r.deps)
    await reader.prepare([BASE])
    await reader.prepare([BASE, BASE])
    await Promise.all([reader.prepare([BASE]), reader.prepare([BASE])])
    expect(r.asked.filter((f) => f.kinds?.includes(LAYER_KIND))).toHaveLength(1)
    const one = await reader.blocksAsOf(BASE, 2000)
    const two = await reader.blocksAsOf(BASE, 2500)
    expect(two).toBe(one)
    expect(r.grounds.filter((g) => g === `${chunkKey(BASE)}|2`)).toHaveLength(1)
    // The 26 not read yet, in questions of 25 at most (the relay sends 500 a filter): two more.
    await reader.prepare(neighbourhood(BASE))
    expect(r.asked.filter((f) => f.kinds?.includes(LAYER_KIND))).toHaveLength(3)
  })
})

describe('the relay\'s 500-event cap', () => {
  it('takes an answer for cut off when it fills the limit asked, or the relay\'s 500', () => {
    expect(cutOff(new Array(500))).toBe(true)
    expect(cutOff(new Array(5), 5)).toBe(true)
    expect(cutOff(new Array(4), 5)).toBe(false)
    expect(cutOff(new Array(500), 1000)).toBe(true)
    expect(cutOff(new Array(499), 1000)).toBe(false)
  })

  it('keeps a tutorial layer hidden when its author\'s actions for the batch are cut off (the reviewer\'s probe)', async () => {
    const a = who()
    const T = 1_790_000_000
    const other = { ...BASE, x: BASE.x + 32n }
    // The tutorial: a tagged move 5 minutes before the publish, then 6 untagged ones, then the publish.
    const L1 = await layerOf(a, { createdAt: T, set: [[airCells[0], 8]] })
    const moves = [moveOf(a, T - 300, true), ...Array.from({ length: 6 }, (_, i) => moveOf(a, T - 250 + 40 * i))]
    // A day later the same author builds in the next chunk, with 520 moves between.
    const day = 86_400
    for (let i = 1; i <= 520; i++) moves.push(moveOf(a, T + Math.floor((day * i) / 520)))
    const L2 = await layerOf(a, { createdAt: T + day, base: other, set: [[airCells[1], 8]] })
    const r = relay([L1, L2, ...moves])
    r.valid.add(a.builderPk)
    const reader = new TvTerrainReader(r.deps)
    await reader.prepare([BASE, other])
    expect(reader.asOf(BASE, T + 2 * day)!.layers).toHaveLength(0)
    expect(reader.surveyedAsOf(BASE, T + 2 * day)).toBe(false)
    expect(reader.asOf(other, T + 2 * day)!.layers.map((l) => l.id)).toEqual([L2.id])
  }, 60_000)

  it('leaves a layer undecided when even its own window is cut off', async () => {
    const a = who()
    const T = 1_790_000_000
    const L = await layerOf(a, { createdAt: T })
    const moves = Array.from({ length: TV_RELAY_CAP }, (_, i) => moveOf(a, T - 1 - (i % 800)))
    const r = relay([L, ...moves])
    r.valid.add(a.builderPk)
    const reader = new TvTerrainReader(r.deps)
    await reader.prepare([BASE])
    expect(reader.surveyedAsOf(BASE, T + 10)).toBe(false)
  }, 60_000)

  it('asks a batch that may be cut off again in halves, and keeps a single chunk that still is as partial', async () => {
    const a = who()
    const r = relay([await layerOf(a, { createdAt: 1000 }), moveOf(a, 900)])
    r.valid.add(a.builderPk)
    const flood = (n: number): NostrEvent[] => Array.from({ length: n }, (_, i) => ({ id: i.toString(16).padStart(64, '0'), pubkey: '0'.repeat(64), created_at: 1, kind: LAYER_KIND, tags: [], content: '', sig: '' }))
    const singles: number[] = []
    let now = 1_800_000_000_000
    const reader = new TvTerrainReader({ ...r.deps, now: () => now, query: async (f) => {
      const d = (f as { '#d'?: string[] })['#d']
      const got = await r.deps.query(f)
      if (!d) return got
      if (d.length > 1) return [...got, ...flood(TV_RELAY_CAP)]
      singles.push(1)
      return got
    } })
    const ring = neighbourhood(BASE)
    await reader.prepare(ring)
    expect(singles.length).toBe(ring.length)
    expect(reader.surveyedAsOf(BASE, 2000)).toBe(true)
    // One chunk alone still cut off: kept, but read again later.
    const capped = new TvTerrainReader({ ...r.deps, now: () => now, query: async (f) => [...await r.deps.query(f), ...((f as { '#d'?: string[] })['#d'] ? flood(TV_RELAY_CAP) : [])] })
    await capped.prepare([BASE])
    const asks = () => r.asked.filter((f) => f.kinds?.[0] === LAYER_KIND).length
    const n = asks()
    await capped.prepare([BASE])
    expect(asks()).toBe(n)
    now += TV_READ_AGAIN_MS
    await capped.prepare([BASE])
    expect(asks()).toBe(n + 1)
  })
})

describe('memory', () => {
  it('counts both planes and their changed cells', async () => {
    const a = who()
    const r = relay([await layerOf(a, { createdAt: 1000, set: [[airCells[0], 8], [airCells[1], 8]] }), moveOf(a, 900)])
    r.valid.add(a.builderPk)
    const reader = new TvTerrainReader(r.deps)
    await reader.prepare([BASE])
    const l = reader.asOf(BASE, 2000)!.layers[0]
    const twoPlanes = { ...l, planes: [...l.planes, { ...l.planes[0], plane: 1 as const }] }
    expect(layerBytes([l])).toBe(CELLS * 4 + 8 * l.planes[0].changed.length)
    expect(layerBytes([twoPlanes])).toBe(2 * layerBytes([l]))
  })
})

describe('privacy: only public data', () => {
  it('asks the relay for block layers and movement actions alone, and reads from nobody\'s seat', async () => {
    const a = who()
    const r = relay([await layerOf(a, { createdAt: 1000 }), moveOf(a, 900)])
    r.valid.add(a.builderPk)
    const reader = new TvTerrainReader(r.deps)
    await reader.prepare(neighbourhood(BASE))
    for (const f of r.asked) {
      expect(f.kinds?.length).toBe(1)
      expect([LAYER_KIND, 3333]).toContain(f.kinds![0])
      if (f.kinds![0] === 3333) expect(f.authors).toEqual([a.pk])
    }
    const view = tvStackView(BASE)
    expect(view.me).toBeNull()
    expect(view.follows.size).toBe(0)
  })

  it('makes no signature, publishes nothing and stores nothing', () => {
    for (const f of ['src/lib/tv/terrainReader.ts', 'src/store/useTvTerrain.ts', 'src/scene/TvTerrain.tsx']) {
      const code = readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
      expect(code, f).not.toMatch(/publish|signEvent|finalizeEvent|localSigner|putMany|localStorage|indexedDB/)
    }
  })
})
