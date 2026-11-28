/**
 * useTvTerrain.ts: TERRAIN on Cyberspace TV. Reads the blocks round the
 * avatars on tape, flags TERRAIN beats, and keeps the meshes of the chunks
 * a TERRAIN shot draws (scene/TvTerrain.tsx).
 *
 * Separate from the viewer's own TERRAIN (store/useTerrain.ts and
 * store/terrainShare.ts, whose field is not drawn during TV): its own reader
 * (lib/tv/terrainReader.ts), its own region-key cache, its own blocks worker
 * (lib/terrain/makeBlocksClient.ts), all let go when TV ends.
 *
 * Ahead of the shot, as the bag scan reads ahead (store/useTv.ts tick):
 * for the shot on screen and the next TERRAIN_AHEAD queued, any trip with a
 * small step (lib/tv/terrainShot.ts mayBeTerrain) has the chunk of each of
 * its beats read; its beats are flagged; and a TERRAIN shot then has the
 * chunks round those read too (the 26 neighbours, and the ring beyond for
 * the borders), and the meshes of the chunks it opens on made.
 *
 * On screen, during a TERRAIN shot: the chunk the avatar is in and its 26
 * neighbours (27 at most) as of the tape's time, each that has blocks then.
 * A chunk's mesh is made off the page: its blocks stacked as of tape time
 * (ground from the blocks worker, cached), its faces against its six
 * neighbours' borders, greedily meshed in the worker. Meshes are kept by
 * what went into them (MESHES_KEPT), so a chunk whose blocks have not
 * changed is never meshed twice, and one whose blocks change (a layer's
 * publish reached on tape) keeps its old mesh on screen until the new one is
 * in. One chunk job at a time on the stream (the stream box draws about
 * 21.9 frames a second at 1080p), two on the site.
 *
 * Block shading (tvLighting): on the site's /tv each chunk is lit as your
 * own field is, by your Block shading setting (Settings, Effects): its light
 * worked out in the worker from the chunk and its 26 neighbours as of tape
 * time, cached like its mesh, and the chunk drawn only once both are in, so
 * it never shows lit and then darkens. On the stream (lib/tv/broadcast.ts
 * isBroadcast, the streamer's ?broadcast=1) there is no light at all: every
 * chunk draws fully lit and no light job runs.
 *
 * On the 24/7 stream all of this is off (no reader, no worker, nothing
 * drawn, so no TERRAIN shot) until the stream box is measured with it:
 * TV_TERRAIN_ON_STREAM, or `tvTerrain=1` on the streamer's address.
 *
 * Watching only: nothing here makes a signature, publishes or keeps anything past TV.
 */

import { create } from 'zustand'
import { CYBERSPACE_RELAY, queryAnyChecked } from '../lib/relay'
import { verifyOnce } from '../lib/verifiedSigs'
import { keyStatusOn } from '../lib/terrain/builderStatus'
import { makeBlocksClient, type BlocksClient } from '../lib/terrain/makeBlocksClient'
import { borderSlab, type Borders, type ChunkMesh } from '../lib/terrain/mesh'
import { FOOT, aroundIndex, lightTables, shadedColumns } from '../lib/terrain/light'
import { chunkInSpace, chunkKey, chunkOf, type ChunkBase } from '../lib/terrain/coords'
import { isBroadcast } from '../lib/tv/broadcast'
import { TvTerrainReader, type ChunkAsOf, type TvTerrainDeps } from '../lib/tv/terrainReader'
import { beatChunk, flagTerrainBeats, isTerrainShot, mayBeTerrain, neighbourhood, terrainStep, type TerrainCamera } from '../lib/tv/terrainShot'
import type { Shot } from '../lib/tv/director'
import type { Position } from '../lib/space'
import { useMutes } from './useMutes'
import { useLayers } from './useLayers'

/** How many queued shots after the one on screen are read ahead. */
export const TERRAIN_AHEAD = 2
/** The chunks drawn: the avatar's and its neighbours out to this ring (27). */
export const DRAW_RING = 1
/**
 * The chunks read round a TERRAIN shot's beat chunk (readRing): the drawn
 * 27, and what their meshes and light read. On the stream, only the drawn
 * ring's face neighbours (81: borders only, no light there). On the site,
 * lit, every neighbour of the drawn ring (125) and the two rows over each
 * drawn chunk's sky (SKY), up to 4 chunks over the beat's (175).
 */
export const BORDER_RING = 2
/** The most chunks drawn at once. */
export const MAX_DRAWN = 27
/** The most chunks read for one shot. */
export const SHOT_READ_MAX = 350
/** Meshes kept: the chunks drawn and the next shot's opening ones. */
export const MESHES_KEPT = 54
/** A chunk job not asked for again in this long is dropped (ms). */
export const JOB_STALE_MS = 20_000

/** One chunk on screen. */
export interface DrawnChunk {
  key: string
  base: ChunkBase
  meshKey: string
  mesh: ChunkMesh
  /** Its light (lib/terrain/light.ts computeLight's bytes) where TV lights its blocks (tvLighting), else null. */
  light: Uint8Array<ArrayBuffer> | null
  lightKey: string | null
}

/**
 * Whether TV lights its blocks: on the site, by your Block shading setting;
 * never on the stream (lib/tv/broadcast.ts isBroadcast), where no light job
 * runs and every chunk draws fully lit.
 */
export function tvLighting(): boolean {
  return !isBroadcast() && useLayers.getState().blockShading
}

interface TvTerrainView {
  /** The chunks a TERRAIN shot draws now, with their meshes (MAX_DRAWN at most). */
  drawn: DrawnChunk[]
}

export const useTvTerrain = create<TvTerrainView>(() => ({ drawn: [] }))

/** What TV's state says, for the tick: the shot, the moment on tape, the avatars, and the TERRAIN camera. */
export interface TvTerrainFrame {
  shot: Shot | null
  tapeTime: number | null
  avatars: Record<string, { position: Position; plane: number }>
  terrain: (TerrainCamera & { shot: string }) | null
}

/** Whether the shot on screen plays as TERRAIN (store/useTv.ts sets `terrain` as the shot begins). */
export function terrainOn(s: Pick<TvTerrainFrame, 'shot' | 'terrain'>): boolean {
  return s.terrain !== null && s.shot !== null && s.terrain.shot === s.shot.id
}

let run = 0
let reader: TvTerrainReader | null = null
let client: BlocksClient | null = null
let override: Partial<TvTerrainDeps> | null = null
/** This TV run's: set when it ends (liveDeps). */
let life = { ended: false }
let namedAt = new Map<string, number>()
/** Shots read for, this tape. */
const prepared = new Set<string>()
/** Meshes by what went into them; null for a chunk with no face to draw. */
const meshes = new Map<string, ChunkMesh | null>()
/** Lights by what went into them (the chunk and its neighbours as of tape time). */
const lights = new Map<string, Uint8Array<ArrayBuffer>>()
interface Job { key: string; pri: number; touched: number; run: () => Promise<void> }
const jobs = new Map<string, Job>()
let running = 0
/** Bumped as each chunk job ends, so what is drawn is worked out again. */
let meshVersion = 0
/** The chunks drawn, by chunk key: a chunk being meshed again stays on screen as it was. */
let shown = new Map<string, DrawnChunk>()
let lastWant = ''
let lastMuted: unknown = null

/** For tests: replace what the reader talks to (null puts the real one back). Takes effect at the next start. */
export function setTvTerrainDeps(next: Partial<TvTerrainDeps> | null): void {
  override = next
}

/**
 * The reader's real deps. `life.ended` is set when TV ends: every relay
 * question after that throws, before it is sent and when it comes back, so
 * a builder key's paging (keyStatusOn, which can run to many pages) stops
 * with the reader too.
 */
function liveDeps(life: { ended: boolean }): TvTerrainDeps {
  const ask = async (f: Parameters<typeof queryAnyChecked>[1]): ReturnType<typeof queryAnyChecked> => {
    if (life.ended) throw new Error('TV ended')
    const r = await queryAnyChecked([CYBERSPACE_RELAY], f)
    if (life.ended) throw new Error('TV ended')
    return r
  }
  return {
    query: async (f) => {
      const r = await ask(f)
      if (r.trouble) throw new Error(`canonical relay: ${String(r.trouble)}`)
      return r.events
    },
    keyStatus: async (author, keys) => {
      const out = await keyStatusOn(ask, author, keys, verifyOnce, namedAt)
      while (namedAt.size > 2000) namedAt.delete(namedAt.keys().next().value as string)
      return out
    },
    ground: async (base, revision) => {
      if (!client) throw new Error('TV ended')
      return (await client.generateChunk(base, revision)).blocks
    },
    verify: (ev) => verifyOnce(ev),
    muted: () => useMutes.getState().muted.pubkeys,
    now: () => Date.now(),
  }
}

/** The real deps for a TV run that has `life` (tests: what happens once it has ended). */
export function liveTvTerrainDepsForTest(life: { ended: boolean }): TvTerrainDeps {
  return liveDeps(life)
}

/**
 * TERRAIN on the 24/7 stream: off until the stream box has been measured
 * with it (the coordinator, 2026-11-28), so merging changes the site's /tv
 * only. The streamer can try it with `tvTerrain=1` on its address.
 */
export const TV_TERRAIN_ON_STREAM = false

/**
 * Whether TV reads and draws TERRAIN: always on the site's /tv; on the
 * stream (lib/tv/broadcast.ts isBroadcast) only with TV_TERRAIN_ON_STREAM
 * or `tvTerrain=1` in the address.
 */
export function tvTerrainOn(search: string = searchForTest ?? (typeof window !== 'undefined' && window.location ? window.location.search : '')): boolean {
  if (!isBroadcast() || TV_TERRAIN_ON_STREAM) return true
  return new URLSearchParams(search).get('tvTerrain') === '1'
}
let searchForTest: string | null = null
/** For tests: the address's query as tvTerrainOn reads it (null: the page's own). */
export function setTvTerrainSearchForTest(search: string | null): void {
  searchForTest = search
}

/** TV came on: a reader and a blocks worker of its own (none where TERRAIN is off on TV: tvTerrainOn). */
export function startTvTerrain(): void {
  stopTvTerrain()
  if (!tvTerrainOn()) return
  client = makeBlocksClient()
  life = { ended: false }
  reader = new TvTerrainReader({ ...liveDeps(life), ...override })
}

/** TV went off: everything let go, the worker and TV's region keys too. */
export function stopTvTerrain(): void {
  run++
  life.ended = true
  client?.release('TV ended')
  client = null
  // Its region keys go with it, and anything it still has under way stops asking relays.
  reader?.end()
  reader = null
  namedAt = new Map()
  meshes.clear()
  lights.clear()
  newTapeTvTerrain()
}

/** A new tape: nothing of the last one's shots drawn or read for (what was read stays, as the bag scan's does). */
export function newTapeTvTerrain(): void {
  prepared.clear()
  jobs.clear()
  running = 0
  run++
  shown = new Map()
  lastWant = ''
  // Nothing drawn now: nothing held back from eviction either.
  reader?.pin([])
  if (useTvTerrain.getState().drawn.length) useTvTerrain.setState({ drawn: [] })
}

/** How many region keys TV holds now: the reader's own, none once TV ends (tests). */
export function tvRegionKeysHeld(): number {
  return reader?.keysHeld() ?? 0
}

/** The reader of this TV run (tests, and the scene's probe). */
export function tvTerrainReader(): TvTerrainReader | null {
  return reader
}

/** Whether nothing is being read or meshed (tests). */
export function tvTerrainIdle(): boolean {
  return running === 0 && jobs.size === 0
}

/** How many lights are kept (tests). */
export function tvTerrainLightsKept(): number {
  return lights.size
}

/** How many meshes are kept (tests). */
export function tvTerrainMeshesKept(): number {
  return meshes.size
}

/**
 * From TV's tick: read ahead for the shots coming, and work out what the
 * TERRAIN shot on screen draws now.
 */
export function tvTerrainTick(s: TvTerrainFrame, queue: readonly Shot[]): void {
  const r = reader
  if (!r) return
  for (const shot of [s.shot, ...queue.slice(0, TERRAIN_AHEAD)]) {
    if (!shot || prepared.has(shot.id) || !mayBeTerrain(shot)) continue
    prepared.add(shot.id)
    void prepareShot(shot, r, run)
  }
  drawFor(s, r)
  pump()
}

/** Distinct chunks, in the order first met. */
function distinct(bases: Iterable<ChunkBase>): ChunkBase[] {
  const out = new Map<string, ChunkBase>()
  for (const b of bases) { const k = chunkKey(b); if (!out.has(k)) out.set(k, b) }
  return [...out.values()]
}

/** Read a shot's chunks, flag its beats, and for a TERRAIN shot read round them and mesh where it opens. */
async function prepareShot(shot: Shot, r: TvTerrainReader, id: number): Promise<void> {
  const beatBases = distinct(shot.beats.filter(terrainStep).map(beatChunk))
  await r.prepare(beatBases)
  if (id !== run) return
  flagTerrainBeats(shot.beats, (b, t) => r.surveyedAsOf(b, t))
  if (!isTerrainShot(shot)) return
  // The drawn ring first, then what its meshes (and on the site its light) read.
  const lit = tvLighting()
  const near = distinct(beatBases.flatMap((b) => neighbourhood(b, DRAW_RING)))
  const far = distinct(beatBases.flatMap((b) => readRing(b, lit)))
  await r.prepare(distinct([...near, ...far]).slice(0, SHOT_READ_MAX))
  if (id !== run) return
  // Where it opens: meshed ahead, behind whatever is on screen now.
  const first = shot.beats[0]
  const at = terrainStep(first) ? first.from.position : first.action.position
  const plane = terrainStep(first) ? first.from.plane : first.action.plane
  const centre = chunkOf(at.x, at.y, at.z, plane)
  for (const b of neighbourhood(centre, DRAW_RING)) {
    const a = r.asOf(b, shot.start)
    if (!a || (!a.surveyed && !a.cells)) continue
    queueMesh(r, a, shot.start, 10 + far1(b, centre))
    if (lit) queueLight(r, a, shot.start, 10 + far1(b, centre))
  }
  pump()
}

/**
 * The chunks read round a drawn ring's centre: the ring, and its face
 * neighbours (unlit, 81), or every neighbour of it and the rows over each
 * drawn chunk's sky (lit, 175).
 */
export function readRing(centre: ChunkBase, lit: boolean): ChunkBase[] {
  const out = new Map<string, ChunkBase>()
  const add = (o: readonly [number, number, number]): void => {
    const b = step(centre, o)
    if (chunkInSpace(b)) out.set(chunkKey(b), b)
  }
  for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const far = [dx, dy, dz].filter((v) => Math.abs(v) === 2).length
    if (lit || far <= 1) add([dx, dy, dz])
  }
  if (lit) for (const dy of [3, 4]) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) add([dx, dy, dz])
  return [...out.values()]
}

/** The chunks a drawn chunk's mesh and light read: its face neighbours (unlit), or its 26 neighbours and its sky (lit). */
function readsOf(b: ChunkBase, lit: boolean): ChunkBase[] {
  return (lit ? [...AROUND, ...SKY] : FACES).map((o) => step(b, o)).filter(chunkInSpace)
}

/** The six face neighbours, in mesh.ts Borders order: -x, +x, -y, +y, -z, +z. */
const FACES: ReadonlyArray<readonly [number, number, number]> = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]]
const step = (b: ChunkBase, o: readonly [number, number, number]): ChunkBase => ({ x: b.x + 32n * BigInt(o[0]), y: b.y + 32n * BigInt(o[1]), z: b.z + 32n * BigInt(o[2]), plane: b.plane })
/** How many chunks apart, on the furthest axis (0 for the same chunk, 1 for a neighbour). */
function far1(a: ChunkBase, b: ChunkBase): number {
  const d = (u: bigint, v: bigint): number => Number((u > v ? u - v : v - u) / 32n)
  return Math.max(d(a.x, b.x), d(a.y, b.y), d(a.z, b.z))
}

/**
 * A chunk's mesh key as of tape time: its own signature and its six
 * neighbours' (their borders shape its faces). '?' for a neighbour not read
 * yet, so the mesh is made again once it is.
 */
export function meshKeyOf(r: TvTerrainReader, a: ChunkAsOf, t: number): string {
  const sides = FACES.map((o) => {
    const n = step(a.base, o)
    if (!chunkInSpace(n)) return '0'
    const na = r.asOf(n, t)
    if (!na) return '?'
    return na.surveyed || na.cells ? na.signature : '0'
  })
  return [a.signature, ...sides].join('#')
}

/** Ask for a chunk's mesh as of tape time `t`: stacked, bordered, meshed in the worker. */
function queueMesh(r: TvTerrainReader, a: ChunkAsOf, t: number, pri: number): string {
  const key = meshKeyOf(r, a, t)
  if (meshes.has(key)) return key
  const now = performance.now()
  const had = jobs.get(key)
  if (had) { had.pri = Math.min(had.pri, pri); had.touched = now; return key }
  const base = a.base
  const id = run
  jobs.set(key, {
    key, pri, touched: now,
    run: async () => {
      const own = await r.blocksAsOf(base, t)
      if (id !== run) return
      if (!own) { keepMesh(key, null); return }
      const borders = await Promise.all(FACES.map(async (o, face) => {
        const n = step(base, o)
        if (!chunkInSpace(n)) return null
        const nb = await r.blocksAsOf(n, t)
        return nb ? borderSlab(nb, face ^ 1) : null
      }))
      const c = client
      if (!c || id !== run) return
      const m = await c.meshChunkAsync(own, borders as Borders)
      if (id === run) keepMesh(key, m.quads > 0 ? m : null)
    },
  })
  return key
}

/**
 * The chunks above whose columns shade a chunk's sky (as TerrainWorld
 * lightInputs takes every held chunk 2 or more up within one across): the
 * rows 2 and 3 up, and the eight round each. All must be read before the
 * light is worked out: one not read is unknown, never taken for open sky.
 */
const SKY: ReadonlyArray<readonly [number, number, number]> = [2, 3].flatMap((dy) => [-1, 0, 1].flatMap((dz) => [-1, 0, 1].map((dx) => [dx, dy, dz] as const)))
const AROUND: ReadonlyArray<readonly [number, number, number]> = [-1, 0, 1].flatMap((dz) => [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => [dx, dy, dz] as const)))
let passTable: Uint8Array | null = null

/** A chunk's light key as of tape time: its own signature, its 26 neighbours' and the chunks over its sky ('?' for one not read). */
export function lightKeyOf(r: TvTerrainReader, a: ChunkAsOf, t: number): string {
  const sig = (o: readonly [number, number, number]): string => {
    const n = step(a.base, o)
    if (!chunkInSpace(n)) return '0'
    const na = r.asOf(n, t)
    if (!na) return '?'
    return na.surveyed || na.cells ? na.signature : '0'
  }
  return ['L', ...AROUND.map(sig), ...SKY.map(sig)].join('#')
}

/** Ask for a chunk's light as of tape time `t`: from its blocks and its 26 neighbours', and the columns above, worked out in the worker. */
function queueLight(r: TvTerrainReader, a: ChunkAsOf, t: number, pri: number): string {
  const key = lightKeyOf(r, a, t)
  // A neighbour or a chunk over the sky not read yet: unknown, so no light until it is (drawFor reads it).
  if (lights.has(key) || key.includes('#?')) return key
  const now = performance.now()
  const had = jobs.get(key)
  if (had) { had.pri = Math.min(had.pri, pri); had.touched = now; return key }
  const base = a.base
  const id = run
  jobs.set(key, {
    key, pri, touched: now,
    run: async () => {
      const around = await Promise.all(AROUND.map(async (o) => {
        const n = step(base, o)
        return chunkInSpace(n) ? r.blocksAsOf(n, t) : null
      }))
      const ordered: Array<Uint8Array | null> = new Array(27).fill(null)
      AROUND.forEach((o, i) => { ordered[aroundIndex(o[0], o[1], o[2])] = around[i] })
      let skyTop: Uint8Array | null = null
      for (const o of SKY) {
        const n = step(base, o)
        if (!chunkInSpace(n)) continue
        const above = await r.blocksAsOf(n, t)
        if (!above) continue
        passTable ??= lightTables().pass
        const cols = shadedColumns(above, passTable)
        skyTop ??= new Uint8Array(FOOT * FOOT).fill(1)
        for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) if (cols[x + 32 * z]) skyTop[(o[0] + 1) * 32 + x + FOOT * ((o[2] + 1) * 32 + z)] = 0
      }
      const c = client
      if (!c || id !== run) return
      const bytes = await c.lightChunkAsync(ordered, skyTop)
      if (id !== run) return
      lights.delete(key)
      lights.set(key, bytes)
      const onScreen = new Set([...shown.values()].map((d) => d.lightKey))
      for (const k of lights.keys()) {
        if (lights.size <= MESHES_KEPT) break
        if (!onScreen.has(k)) lights.delete(k)
      }
    },
  })
  return key
}

function keepMesh(key: string, m: ChunkMesh | null): void {
  meshes.delete(key)
  meshes.set(key, m)
  if (meshes.size <= MESHES_KEPT) return
  // The oldest first, never one on screen.
  const onScreen = new Set([...shown.values()].map((d) => d.meshKey))
  for (const k of meshes.keys()) {
    if (meshes.size <= MESHES_KEPT) break
    if (!onScreen.has(k)) meshes.delete(k)
  }
}

/** Run chunk jobs, the most wanted first: one at a time on the stream, two on the site. */
function pump(): void {
  const limit = isBroadcast() ? 1 : 2
  const now = performance.now()
  while (running < limit && client && reader) {
    let best: Job | null = null
    for (const j of jobs.values()) {
      if (now - j.touched > JOB_STALE_MS) { jobs.delete(j.key); continue }
      if (!best || j.pri < best.pri) best = j
    }
    if (!best) return
    jobs.delete(best.key)
    running++
    const id = run
    void best.run().catch(() => { /* asked for again while still wanted */ }).finally(() => {
      if (id !== run) return
      running--
      meshVersion++
      pump()
    })
  }
}

/** What the TERRAIN shot on screen draws now: the avatar's chunk and its neighbours as of tape time. */
function drawFor(s: TvTerrainFrame, r: TvTerrainReader): void {
  const shot = s.shot
  const a = shot ? s.avatars[shot.pubkey] : undefined
  if (!terrainOn(s) || !shot || !a || s.tapeTime === null) {
    if (shown.size || useTvTerrain.getState().drawn.length) {
      shown = new Map()
      lastWant = ''
      r.pin([])
      useTvTerrain.setState({ drawn: [] })
    }
    return
  }
  const centre = chunkOf(a.position.x, a.position.y, a.position.z, a.plane)
  const muted = useMutes.getState().muted
  const lit = tvLighting()
  const want = `${shot.id}|${s.tapeTime}|${chunkKey(centre)}|${r.version}|${meshVersion}|${lit}`
  if (want === lastWant && muted === lastMuted) return
  lastWant = want
  lastMuted = muted
  const next: DrawnChunk[] = []
  const unread: ChunkBase[] = []
  const ring = neighbourhood(centre, DRAW_RING)
  // The drawn set and what its meshes and light read: never let go while it is drawn.
  const reads = distinct([...ring, ...ring.flatMap((b) => readsOf(b, lit))])
  r.pin(reads)
  for (const b of ring) {
    if (next.length >= MAX_DRAWN) break
    const asOf = r.asOf(b, s.tapeTime)
    if (!asOf) unread.push(b)
    if (!asOf || (!asOf.surveyed && !asOf.cells)) continue
    for (const n of readsOf(b, lit)) if (!r.has(n)) unread.push(n)
    const key = asOf.key
    const mk = queueMesh(r, asOf, s.tapeTime, far1(b, centre))
    const lk = lit ? queueLight(r, asOf, s.tapeTime, far1(b, centre)) : null
    const m = meshes.get(mk)
    const light = lk === null ? null : lights.get(lk)
    // Lit, a chunk waits for its light too, so it never shows lit and then darkens.
    if (m !== undefined && light !== undefined) {
      if (m) next.push({ key, base: b, meshKey: mk, mesh: m, light, lightKey: lk })
      continue
    }
    // Being meshed or lit: the chunk as it was drawn until the new one is in.
    const old = shown.get(key)
    if (old) next.push(old)
  }
  // Not read (let go to make room, or never read ahead): read now; the drawing is worked out again when it lands.
  if (unread.length) void r.prepare(distinct(unread))
  const was = useTvTerrain.getState().drawn
  shown = new Map(next.map((d) => [d.key, d]))
  if (was.length !== next.length || was.some((d, i) => d.meshKey !== next[i].meshKey || d.lightKey !== next[i].lightKey)) useTvTerrain.setState({ drawn: next })
}
