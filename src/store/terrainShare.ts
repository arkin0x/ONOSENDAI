/**
 * terrainShare.ts - TERRAIN's blocks shared with everyone (DECK-0009).
 *
 * WRITING. This device's changes to a chunk are published as its block
 * layer (kind 33339), signed by this device's builder key
 * (lib/terrain/builderKey.ts) so no signer is ever asked, sealed with the
 * chunk's region key, with only the DECK's public tags (lib/terrain/
 * blockLayer.ts), and the identity's Crew (co-builders) written into every
 * layer. Only to the canonical relay, wss://relay.onosendai.tech, and only:
 *
 * - while LIVE. LOCAL never publishes a layer, as LOCAL never publishes a
 *   move; what waits goes out on the next turn to LIVE (§5.7);
 * - once the movement action naming the builder key is on the canonical
 *   relay;
 * - at the DECK's moments (§5.7): when you leave the chunk by more than 4
 *   blocks, after 15 seconds without a change alone or 3 seconds with
 *   someone near, at 200 waiting changes alone or 50 with someone near, and
 *   when TERRAIN closes;
 * - paced for the relay (3 a second per connection for events replaceable
 *   by d, bags included): one layer per 500 ms, a rate-limit refusal tried
 *   again after a growing wait.
 *
 * Chunks built before sharing existed go out only when next changed (the
 * owner's ruling A). Retiring this device's key voids every layer it signed,
 * so once the new key is named this device publishes its blocks again under
 * it; changing the Crew publishes them again with the new list.
 *
 * The bag says where that stands: saved on this device, sharing, shared.
 *
 * READING. In every mode (HOP, WALK, TERRAIN), LIVE or LOCAL, as shards are
 * read, other builders' layers for the chunks round where you stand (the
 * ring the field draws, READ_RING) are read from the canonical relay, checked by §6.1
 * (lib/terrain/layerReader.ts: a retired or unnamed builder key drops its
 * layers), mutes removed, and stacked (§7, the Stack): each cell shows the
 * highest-ranked layer that changed it, else the surveyed ground. The home
 * owner inside their home first, then you (this device's own blocks), then
 * whom you follow, then everyone else, the newest first in each; a layer's
 * co-builders count at its author's rank in the cells the author changed.
 */

import { create } from 'zustand'
import { CELLS, chunkKey, chunkOf, parseChunkKey, type ChunkBase } from '../lib/terrain/coords'
import { regionKeyAt, encryptForRegion } from '../lib/shardCrypto'
import { reachDistance } from '../lib/terrain/world'
import {
  LAYER_KIND, LAYER_MAX_BYTES, COBUILDERS_MAX, changesOf, countedLayers, emptiedPlaintext, freeTextWithinBounds, inHome, layerShape, layerTags,
  nextPlaintext, parsePlaintext, plaintextJson, resolveStack, serializedBytes, startFrom, withinRank,
  type DecodedPlane, type LayerPlaintext, type PlaneChanges, type StackLayer, type StackView,
} from '../lib/terrain/blockLayer'
import { readLayer, type KeyStatus } from '../lib/terrain/layerReader'
import { deviceKeys, ensureBuilderKey, namedKey, noteFound, onBuilderChange, retireCurrent, waitingIds, builderRecord } from '../lib/terrain/builderKey'
import { onActionSigned } from '../lib/terrain/builderTags'
import { putMany, request } from '../lib/idb'
import { localSigner } from '../lib/signers'
import { isRateLimited } from '../lib/rateLimit'
import { META } from '../lib/terrain/terrainDb'
import type { NostrEvent } from '../lib/events'
import type { Position } from '../lib/space'
import type { Filter } from 'nostr-tools/filter'

/** How far you leave a chunk, in blocks past its walls, before its waiting changes are published. */
export const LEAVE_BLOCKS = 4
/** Quiet before publishing, alone and with someone near (ms). */
export const IDLE_ALONE_MS = 15_000
export const IDLE_NEAR_MS = 3_000
/** Waiting changes that publish at once, alone and with someone near. */
export const BATCH_ALONE = 200
export const BATCH_NEAR = 50
/** How soon a publish that could not go is tried again (ms). */
export const RETRY_MS = 20_000
/** How often the layers round you are read again, in any mode (ms). */
export const READ_EVERY_MS = 12_000
/** How near someone must be, in gibsons, to count as building with you. */
export const NEAR_GIBSONS = 64
/** A fixed content for every layer: it says nothing about the place (§5.1). */
export const LAYER_CONTENT = ''
/** How long a builder key's status read from the relay is trusted (ms): a retirement since must count. */
export const STATUS_FRESH_MS = 60_000

// ---------------------------------------------------------------------------------------------------------------
// What this module needs from the world, swapped out in tests.

export interface ShareDeps {
  /** LIVE for the identity on screen. */
  live: () => boolean
  /** The identity on screen. */
  me: () => string
  /** Publish to the canonical relay alone. */
  publish: (ev: NostrEvent) => Promise<{ ok: boolean; reason?: string }>
  /** Read from the canonical relay alone. */
  query: (filter: Filter) => Promise<NostrEvent[]>
  /** What an author's movement actions say of some of their builder keys (named, retired, unnamed; unknown when they cannot be read). */
  keyStatus: (author: string, keys: string[]) => Promise<Map<string, KeyStatus>>
  /** The revision 2 ground of a chunk. */
  ground: (base: ChunkBase) => Promise<Uint8Array>
  muted: () => ReadonlySet<string>
  /** Whom `me` follows, newest contact list. */
  follows: (me: string) => Promise<string[]>
  /** Someone is building near you now. */
  othersNear: () => boolean
  verify: (ev: NostrEvent) => boolean
  now: () => number
}

let deps: ShareDeps | null = null
let defaults: (() => ShareDeps) | null = null

/** The real deps' maker (store/terrainShareLive.ts registers it, so tests never load the network). */
export function setDefaultShareDeps(make: () => ShareDeps): void {
  defaults = make
}

/** For tests: replace what this module talks to (null puts the real one back). */
export function setShareDeps(next: Partial<ShareDeps> | null): void {
  deps = next === null ? null : { ...current(), ...next }
}

function current(): ShareDeps {
  if (deps) return deps
  if (!defaults) throw new Error('terrainShare has no deps')
  deps = defaults()
  return deps
}

// ---------------------------------------------------------------------------------------------------------------
// The field this shares: what store/useTerrain.ts hands over.

export interface ShareSlot {
  base: ChunkBase
  key: string
  /** The generated ground, once generated. */
  generated: Uint8Array | null
  /** Your own blocks: the ground with your layer and log over it; null where you have not surveyed. */
  own?: Uint8Array | null
}

export interface ShareHost {
  /** The identity whose field is open, its plane and its db, or null. */
  field: () => { owner: string; plane: number; db: IDBDatabase | null; slot: (key: string) => ShareSlot | null; surveyed: (key: string) => boolean } | null
  /** Where you stand: the walk's gibson, else your head. */
  head: () => Position
  /** TERRAIN is open. */
  active: () => boolean
  /** Fold a chunk's log into its layer on the device (before it is published). */
  fold: (key: string) => Promise<void>
  /** A chunk's drawn blocks changed: draw it again (and load it, when it is not). */
  redisplay: (key: string) => void
  /** Take these cells (cell to value) as your own in a chunk, kept on the device: another key's blocks a new key started from (§5.6). */
  adopt: (key: string, cells: ReadonlyMap<number, number>) => Promise<void>
}

let host: ShareHost | null = null

/** store/useTerrain.ts connects the field here. */
export function connectShareHost(h: ShareHost | null): void {
  host = h
}

// ---------------------------------------------------------------------------------------------------------------
// The bag's line, and the Crew.

export type ShareState = 'saved' | 'sharing' | 'shared'

export interface ShareView {
  state: ShareState
  /** Plain words for the bag. */
  words: string
  /** Your Crew: who can build on yours (pubkeys). */
  crew: string[]
  /** Builders whose layers you have read that list you: you build on theirs. */
  crewOf: string[]
}

export const useShare = create<ShareView>(() => ({ state: 'saved', words: 'Saved on this device.', crew: [], crewOf: [] }))

// ---------------------------------------------------------------------------------------------------------------
// Per chunk, kept on the device beside its layer (the terrain database's meta store).

/**
 * What this device last published at a chunk's address: one layer holds
 * both twin planes (§2.2), so this is kept per address (the chunk's x, y,
 * z), shared by its two planes.
 */
export interface PublishedRow {
  /** The plaintext last published, or null before the first. */
  plaintext: string | null
  eventId: string | null
  /** The builder key that signed it. */
  builder: string | null
  createdAt: number
}

/** What waits in one chunk (one plane), with what was published at its address. */
export interface ShareRow extends PublishedRow {
  /** Changes made since it was published. */
  dirty: boolean
  /** Cells you set to their ground value over someone else's block or hole: written as changes (§5.4). */
  explicit: number[]
  /** Cells a new key took from your other keys' layers (§5.6) and you have not changed since: yours, as published. */
  carried: number[]
}

/** A chunk key without its plane: the address its layer and its twin's share. */
const addressOf = (key: string): string => key.slice(key.indexOf(':') + 1)
const rowKey = (owner: string, key: string): string => `${owner}|share|${key}`
const pubPrefix = (owner: string): string => `${owner}|layer|`
const pubKey = (owner: string, key: string): string => `${pubPrefix(owner)}${addressOf(key)}`
const crewKey = (owner: string): string => `${owner}|crew`
const emptyRow = (): ShareRow => ({ plaintext: null, eventId: null, builder: null, createdAt: 0, dirty: false, explicit: [], carried: [] })
const cellList = (v: unknown): number[] => (Array.isArray(v) ? v.filter((c): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) < CELLS) : [])

/** Everyone else's counted layers in a chunk, and the Crew lists they carry. */
interface ChunkLayers {
  layers: StackLayer[]
}

/** What the Stack gave a chunk the last time it was drawn: which layer each cell shows, for the cursor's colour. */
interface ChunkView {
  layers: StackLayer[]
  from: Int32Array
  /** Each author's newest list here (§8). */
  lists: Map<string, readonly string[]>
}

interface Session {
  owner: string
  plane: number
  rows: Map<string, ShareRow>
  loading: Map<string, Promise<ShareRow>>
  /** Changes since the last publish, by chunk. */
  waiting: Map<string, number>
  others: Map<string, ChunkLayers>
  views: Map<string, ChunkView>
  /** The newest layer event per chunk lookup id and builder key. */
  seen: Map<string, Map<string, NostrEvent>>
  crew: string[]
  /** The Crew as kept is read (a change before it is would overwrite it). */
  crewRead: Promise<void> | null
  /** Bumped by every Crew change and every retirement: a republish that began before one is not the last. */
  gen: number
  /** The Crew changed, or the key did: every published layer goes out again. */
  republish: boolean
  idle: ReturnType<typeof setTimeout> | null
  retry: ReturnType<typeof setTimeout> | null
  flushing: Promise<void> | null
  again: boolean
  failed: string | null
  readKey: string
  closed: boolean
}

let session: Session | null = null
let reader: ReturnType<typeof setInterval> | null = null

/** Others' layers round you read again every READ_EVERY_MS, in every mode, once anything has been read; and your builder tag asked after. */
function keepReading(): void {
  if (reader) return
  reader = setInterval(() => { if (sessionFor()) { void readNear(true); void confirmTags() } }, READ_EVERY_MS)
}
const statuses = new Map<string, { s: KeyStatus; at: number }>()
const grounds = new Map<string, Promise<Uint8Array>>()
const keys = new Map<string, { key: Uint8Array; lookupId: string }>()
let followsOf: { me: string; list: string[] } | null = null

function sessionFor(): Session | null {
  const f = host?.field()
  if (!f) return null
  if (!session || session.owner !== f.owner || session.plane !== f.plane) {
    if (session) closeSession(session)
    session = {
      owner: f.owner, plane: f.plane, rows: new Map(), loading: new Map(), waiting: new Map(), others: new Map(), views: new Map(), seen: new Map(),
      crew: [], crewRead: null, gen: 0, republish: false, idle: null, retry: null, flushing: null, again: false, failed: null, readKey: '', closed: false,
    }
    // Another identity (or plane): its own Crew, read from the device, never the one before's.
    useShare.setState({ crew: [], crewOf: [] })
    void loadCrew(session)
  }
  return session
}

function closeSession(s: Session): void {
  s.closed = true
  if (s.idle) clearTimeout(s.idle)
  if (s.retry) clearTimeout(s.retry)
}

/** For tests: forget everything held. */
export function resetShare(): void {
  if (session) closeSession(session)
  session = null
  if (reader) clearInterval(reader)
  reader = null
  statuses.clear()
  grounds.clear()
  keys.clear()
  followsOf = null
  hinted.clear()
  lastRead = 0
  nextSendAt = 0
  useShare.setState({ state: 'saved', words: 'Saved on this device.', crew: [], crewOf: [] })
}

/** The chunk's h5 region key and lookup id (DECK-0009 §2.2), the same for both planes. */
export function chunkRegionKey(base: ChunkBase): { key: Uint8Array; lookupId: string } {
  const k = `${base.x}:${base.y}:${base.z}`
  let v = keys.get(k)
  if (!v) {
    const rk = regionKeyAt(base, 5, 5)
    v = { key: rk.key, lookupId: rk.lookupId }
    keys.set(k, v)
    while (keys.size > 256) keys.delete(keys.keys().next().value as string)
  }
  return v
}

function groundOf(base: ChunkBase): Promise<Uint8Array> {
  const k = chunkKey(base)
  let g = grounds.get(k)
  if (!g) {
    g = current().ground(base)
    grounds.set(k, g)
    void g.catch(() => grounds.delete(k))
    while (grounds.size > 64) grounds.delete(grounds.keys().next().value as string)
  }
  return g
}

// ---------------------------------------------------------------------------------------------------------------
// The rows.

function db(): IDBDatabase | null {
  return host?.field()?.db ?? null
}

async function rowOf(s: Session, key: string): Promise<ShareRow> {
  const have = s.rows.get(key)
  if (have) return have
  let p = s.loading.get(key)
  if (!p) {
    p = (async () => {
      const d = db()
      let row = emptyRow()
      if (d) {
        try {
          const store = d.transaction([META], 'readonly').objectStore(META)
          const [mine, pub] = await Promise.all([
            request(store.get(rowKey(s.owner, key))) as Promise<{ value?: Partial<ShareRow> } | undefined>,
            request(store.get(pubKey(s.owner, key))) as Promise<{ value?: Partial<PublishedRow> } | undefined>,
          ])
          row = { ...emptyRow(), dirty: mine?.value?.dirty === true, explicit: cellList(mine?.value?.explicit), carried: cellList(mine?.value?.carried), ...pickPublished(pub?.value) }
        } catch { /* a fresh row */ }
      }
      // Chunks built before sharing existed are not published on their own: the first change made in one shares it (ruling A).
      s.rows.set(key, row)
      if (row.dirty && !s.waiting.has(key)) s.waiting.set(key, 1)
      return row
    })()
    s.loading.set(key, p)
  }
  return p
}

function pickPublished(v: Partial<PublishedRow> | undefined): PublishedRow {
  return { plaintext: v?.plaintext ?? null, eventId: v?.eventId ?? null, builder: v?.builder ?? null, createdAt: typeof v?.createdAt === 'number' ? v.createdAt : 0 }
}

function saveRow(s: Session, key: string, row: ShareRow): void {
  s.rows.set(key, row)
  const d = db()
  if (!d || s.closed) return
  const pub: PublishedRow = pickPublished(row)
  void putMany(d, META, [{ key: rowKey(s.owner, key), value: { dirty: row.dirty, explicit: row.explicit, carried: row.carried } }, { key: pubKey(s.owner, key), value: pub }]).catch(() => { /* kept in memory */ })
}

/** Read a chunk's row before it is drawn. */
export async function prepareChunk(key: string): Promise<void> {
  const s = sessionFor()
  if (!s) return
  const row = await rowOf(s, key)
  // Changes kept from before (another visit, or a chunk let go while they waited) wait again now it is here.
  if (row.dirty && !s.waiting.has(key)) { s.waiting.set(key, 1); arm(s); say(s) }
}

// ---------------------------------------------------------------------------------------------------------------
// The Crew: one list per identity, written into every layer this device publishes.

const HEX64 = /^[0-9a-f]{64}$/

function loadCrew(s: Session): Promise<void> {
  s.crewRead ??= readCrew(s)
  return s.crewRead
}

async function readCrew(s: Session): Promise<void> {
  const d = db()
  // Not read yet (no database open yet): asked again next time, so a later change never overwrites what is kept.
  if (!d) { s.crewRead = null; return }
  try {
    const got = await request(d.transaction([META], 'readonly').objectStore(META).get(crewKey(s.owner))) as { value?: { list?: unknown; republish?: unknown } } | undefined
    const list = Array.isArray(got?.value?.list) ? (got!.value!.list as unknown[]).filter((p): p is string => typeof p === 'string' && HEX64.test(p)) : []
    s.crew = list.slice(0, COBUILDERS_MAX)
    s.republish = s.republish || got?.value?.republish === true
    if (s === session) useShare.setState({ crew: [...s.crew] })
  } catch { s.crewRead = null }
}

function saveCrew(s: Session): void {
  if (s === session) useShare.setState({ crew: [...s.crew] })
  const d = db()
  if (d && !s.closed) void putMany(d, META, [{ key: crewKey(s.owner), value: { list: s.crew, republish: s.republish } }]).catch(() => { /* kept in memory */ })
}

/** Add someone to your Crew: they can build on yours. Every layer you published goes out again with them in it. No signer is asked. */
export async function addCrew(pubkey: string): Promise<boolean> {
  const s = sessionFor()
  if (!s) return false
  await loadCrew(s)
  if (s.closed || !HEX64.test(pubkey) || pubkey === s.owner || s.crew.includes(pubkey) || s.crew.length >= COBUILDERS_MAX) return false
  s.crew = [...s.crew, pubkey]
  s.republish = true
  s.gen++
  saveCrew(s)
  redrawAll(s)
  void flush('crew')
  return true
}

/** Take someone off your Crew: your layers go out again without them, and their edits drop back to their own rank. */
export async function removeCrew(pubkey: string): Promise<boolean> {
  const s = sessionFor()
  if (!s) return false
  await loadCrew(s)
  if (s.closed || !s.crew.includes(pubkey)) return false
  s.crew = s.crew.filter((p) => p !== pubkey)
  s.republish = true
  s.gen++
  saveCrew(s)
  redrawAll(s)
  void flush('crew')
  return true
}

/** Whether someone is in your Crew. */
export function inCrew(pubkey: string): boolean {
  return useShare.getState().crew.includes(pubkey)
}

// ---------------------------------------------------------------------------------------------------------------
// Your view: the Stack, with this device's own blocks as your layer.

/** This device's own blocks as a layer of yours: the cells it changed (from the ground, or explicitly at it), newest of all of yours. */
function ownLayer(me: string, own: Uint8Array, ground: Uint8Array, plane: 0 | 1, explicit: ReadonlySet<number>, cobuilders: readonly string[], createdAt: number): StackLayer {
  const values = Int32Array.from(own)
  const changed: number[] = []
  for (let c = 0; c < CELLS; c++) if (own[c] !== ground[c] || explicit.has(c)) changed.push(c)
  const pl: DecodedPlane = { plane, survey: true, values, changed }
  return { id: '', author: me, builder: '', createdAt, cobuilders, planes: [pl] }
}

/**
 * What a chunk shows: the Stack over everyone's counted layers and this
 * device's own blocks (as yours), per cell the first candidate, else the
 * base (the ground where the plane is surveyed, open space where not). Also
 * which layer each cell shows.
 */
export function composeView(o: { ground: Uint8Array; own: Uint8Array | null; explicit: ReadonlySet<number>; others: readonly StackLayer[]; plane: 0 | 1; view: StackView; myCrew: readonly string[]; mutes: ReadonlySet<string>; now: number; ownAt?: number }): { blocks: Uint8Array; layers: StackLayer[]; from: Int32Array } {
  const counted = countedLayers(o.others, o.view, o.mutes, o.now)
  // Your own blocks count as yours, never held back by the clock or the cap; dated as published (now while changes wait), so a newer layer of another device of yours wins as §7.3 says.
  const layers = o.own && o.view.me ? [...counted, ownLayer(o.view.me, o.own, o.ground, o.plane, o.explicit, o.myCrew, o.ownAt ?? o.now)] : counted
  const r = resolveStack(layers, o.plane, o.view)
  const blocks = new Uint8Array(CELLS)
  for (let c = 0; c < CELLS; c++) {
    const v = r.values[c]
    blocks[c] = v >= 0 ? Math.min(v, 255) : r.surveyed ? o.ground[c] : 0
  }
  return { blocks, layers, from: r.from }
}

/** Whom a reader ranks where (§7): you, whom you follow, and who is home here. */
function stackView(me: string | null, base: ChunkBase): StackView {
  const follows = new Set(followsOf && followsOf.me === me ? followsOf.list : [])
  return { me, follows, home: (author) => inHome(author, base) }
}

/** The blocks a chunk shows you now (store/useTerrain.ts draws these). */
export function viewOf(key: string, ground: Uint8Array, own: Uint8Array | null): Uint8Array {
  const s = sessionFor()
  const base = parseChunkKey(key)
  if (!s || !base) return own ? own.slice() : ground.slice()
  const d = current()
  const v = composeView({
    ground, own, explicit: new Set(s.rows.get(key)?.explicit ?? []), others: s.others.get(key)?.layers ?? [], plane: s.plane as 0 | 1,
    view: stackView(d.me() || null, base), myCrew: s.crew, mutes: d.muted(), now: Math.floor(d.now() / 1000),
    ownAt: (() => { const r = s.rows.get(key); return r && !r.dirty && r.createdAt ? r.createdAt : Math.floor(d.now() / 1000) })(),
  })
  const newest = new Map<string, StackLayer>()
  for (const l of v.layers) { const n = newest.get(l.author); if (!n || withinRank(l, n) < 0) newest.set(l.author, l) }
  s.views.set(key, { layers: v.layers, from: v.from, lists: new Map([...newest].map(([a, l]) => [a, l.cobuilders])) })
  while (s.views.size > 160) s.views.delete(s.views.keys().next().value as string)
  return v.blocks
}

/** Chunks that others built in near you: loaded and drawn even where you never surveyed. */
export function sharedKeys(): ReadonlySet<string> {
  const s = sessionFor()
  return new Set(s ? [...s.others.keys()] : [])
}

function redrawAll(s: Session): void {
  for (const key of s.views.keys()) host?.redisplay(key)
}

// ---------------------------------------------------------------------------------------------------------------
// What the cursor points at (scene/TerrainLayer.tsx colours its outline by it).

/**
 * Whose block the cursor is on: `mine` (yours, or anything in your home),
 * `crew` (a builder who lists you: your edit counts with theirs), `other`
 * (someone else's: your edit shows for you and those who rank you higher),
 * `ground` (nobody built it).
 */
export type AimKind = 'mine' | 'crew' | 'other' | 'ground'

export interface Aim {
  kind: AimKind
  /** The builder whose block it is (for `crew` and `other`). */
  author: string | null
}

export const useAim = create<Aim>(() => ({ kind: 'ground', author: null }))

/** The outline colours: mint, mint, amber, white. Thin and plain; they never bloom. */
export const AIM_COLORS: Record<AimKind, string> = { mine: '#7cffc4', crew: '#7cffc4', other: '#ffb347', ground: '#ffffff' }

/** What a cell of a chunk is, for the cursor, from the chunk's last Stack (none known: ground). Notes it for the HUD. */
export function aimAt(key: string | null, cell: number): AimKind {
  const s = sessionFor()
  const me = s ? current().me() : ''
  let aim: Aim = { kind: 'ground', author: null }
  const v = s && key ? s.views.get(key) : undefined
  const base = key ? parseChunkKey(key) : null
  const home = !!base && !!me && inHome(me, base)
  const i = v ? v.from[cell] : -1
  if (v && i >= 0) {
    const author = v.layers[i].author
    // The builder's newest list here (§8): it lists you, so your edit counts with theirs.
    aim = author === me || home ? { kind: 'mine', author } : v.lists.get(author)?.includes(me) ? { kind: 'crew', author } : { kind: 'other', author }
  } else if (home) aim = { kind: 'mine', author: me }
  const was = useAim.getState()
  if (was.kind !== aim.kind || was.author !== aim.author) useAim.setState(aim)
  return aim.kind
}

/** Builders whose amber hint was shown, per identity (kept in IndexedDB): shown once per builder. */
const hinted = new Map<string, Set<string>>()
const hintKey = (owner: string): string => `${owner}|hinted`

/** Whether to show the one-line hint for someone else's build now: true the first time for each builder, ever, per identity. */
export async function hintOnce(author: string): Promise<boolean> {
  const s = sessionFor()
  if (!s) return false
  let set = hinted.get(s.owner)
  if (!set) {
    set = new Set<string>()
    const d = db()
    if (d) {
      try {
        const got = await request(d.transaction([META], 'readonly').objectStore(META).get(hintKey(s.owner))) as { value?: unknown } | undefined
        if (Array.isArray(got?.value)) for (const p of got!.value as unknown[]) if (typeof p === 'string') set.add(p)
      } catch { /* none */ }
    }
    hinted.set(s.owner, set)
  }
  if (set.has(author)) return false
  set.add(author)
  const d = db()
  if (d) void putMany(d, META, [{ key: hintKey(s.owner), value: [...set].slice(-500) }]).catch(() => undefined)
  return true
}

// ---------------------------------------------------------------------------------------------------------------
// The cadence.

function waitingTotal(s: Session): number {
  let n = 0
  for (const v of s.waiting.values()) n += v
  return n
}

function say(s: Session | null): void {
  if (!s) return
  const live = current().live()
  const waiting = waitingTotal(s) > 0 || s.republish
  const named = namedKey(s.owner) !== null
  const owed = builderRecord(s.owner)?.keys.some((k) => k.retire && k.retire.confirmed === null) ?? false
  let v: Pick<ShareView, 'state' | 'words'>
  if (!waiting) {
    const any = [...s.rows.values()].some((r) => r.eventId !== null)
    v = any && live ? { state: 'shared', words: owed ? 'Shared. Retiring the old key with your next move.' : 'Shared with everyone here.' } : { state: 'saved', words: live ? 'Saved on this device.' : 'Saved on this device. LOCAL keeps your blocks here.' }
  } else if (!live) {
    v = { state: 'saved', words: 'Saved on this device. LOCAL keeps your blocks here.' }
  } else if (!named) {
    v = { state: 'saved', words: 'Saved on this device. Shared after your next move.' }
  } else if (s.failed) {
    v = { state: 'saved', words: `Saved on this device. ${s.failed}` }
  } else {
    v = { state: 'sharing', words: 'Sharing your blocks.' }
  }
  const was = useShare.getState()
  if (was.state !== v.state || was.words !== v.words) useShare.setState(v)
}

function near(): boolean {
  try { return current().othersNear() } catch { return false }
}

function arm(s: Session): void {
  if (s.idle) clearTimeout(s.idle)
  s.idle = null
  if (waitingTotal(s) === 0 || !current().live()) return
  s.idle = setTimeout(() => { s.idle = null; void flush('idle') }, near() ? IDLE_NEAR_MS : IDLE_ALONE_MS)
}

/** One cell's change, as the field saw it: your own value before and after, what was shown before, and the ground. */
export interface CellChange {
  cell: number
  ownBefore: number
  ownAfter: number
  shownBefore: number
  ground: number
}

/**
 * Whether a cell is written as an explicit change at its ground value
 * (§5.4): yes when you set it to the ground over a block or a hole someone
 * else made there; no when you only took your own block away, and no once
 * your value differs from the ground (that is a change anyway).
 */
export function explicitAfter(was: boolean, c: CellChange): boolean {
  if (c.ownAfter !== c.ground) return false
  if (c.ownBefore !== c.ground) return false
  return was || c.shownBefore !== c.ground
}

/** A change was made to a chunk (a mine, a place, a survey). */
export function noteChange(key: string, change?: CellChange): void {
  const s = sessionFor()
  if (!s) return
  void rowOf(s, key).then(() => {
    if (s.closed) return
    s.waiting.set(key, (s.waiting.get(key) ?? 0) + 1)
    const row = s.rows.get(key) ?? emptyRow()
    let explicit = row.explicit
    let carried = row.carried
    if (change) {
      const set = new Set(explicit)
      if (explicitAfter(set.has(change.cell), change)) set.add(change.cell)
      else set.delete(change.cell)
      explicit = [...set]
      carried = carried.filter((c) => c !== change.cell)
    }
    saveRow(s, key, { ...row, dirty: true, explicit, carried })
    if ((s.waiting.get(key) ?? 0) >= (near() ? BATCH_NEAR : BATCH_ALONE)) void flush('batch', [key])
    else arm(s)
    say(s)
  })
}

/** You moved: a chunk left by more than LEAVE_BLOCKS publishes what waits, and the layers round you are read (any mode). */
export function noteMove(): void {
  const s = sessionFor()
  if (!s || !host) return
  const at = host.head()
  const here = { x: at.x, y: at.y, z: at.z, plane: s.plane }
  const left = [...s.waiting.keys()].filter((key) => {
    const sl = host!.field()?.slot(key)
    return !!sl && reachDistance(here, sl.base) > LEAVE_BLOCKS
  })
  if (left.length) void flush('left', left)
  void readNear()
}

/** TERRAIN opened: this device's builder key is made if it has none, the Crew read, and the layers round you read again. */
export async function terrainOpened(): Promise<void> {
  const s = sessionFor()
  if (!s) return
  // What this identity kept is read before TERRAIN opens (store/useTerrain.ts makeField), so a key is made only when there is none.
  // Never without the database: a key that cannot be kept would be named again on every visit, and its layers never updated.
  if (db()) ensureBuilderKey(s.owner)
  await loadCrew(s)
  void loadFollows(s.owner)
  void confirmTags()
  void readNear(true)
  if (s.republish) void flush('crew')
  say(s)
}

async function loadFollows(me: string): Promise<void> {
  try {
    const list = await current().follows(me)
    followsOf = { me, list }
    const s = sessionFor()
    if (s) redrawAll(s)
  } catch { /* none known */ }
}

/** TERRAIN closed: everything waiting is published (while LIVE). Others' layers are still read: in every mode. */
export async function terrainClosed(): Promise<void> {
  const s = sessionFor()
  if (!s) return
  await flush('close')
}

/** The field is being let go (another identity, another plane, far away). */
export function fieldClosing(): void {
  if (session) closeSession(session)
  session = null
}

/** LIVE again: what waited while LOCAL goes out. */
export function liveChanged(live: boolean): void {
  const s = sessionFor()
  if (!s) return
  if (live) { void flush('live'); void readNear(true) } else if (s.idle) { clearTimeout(s.idle); s.idle = null }
  say(s)
}

// ---------------------------------------------------------------------------------------------------------------
// The builder key's tags: confirmed on the canonical relay.

let confirming: Promise<void> | null = null

/** Ask the canonical relay which actions carrying an owed builder tag it holds. */
export function confirmTags(): Promise<void> {
  const s = sessionFor()
  // LOCAL tells the relay nothing, not even which of your moves it holds.
  if (!s || !current().live()) return Promise.resolve()
  if (confirming) return confirming
  const ids = waitingIds(s.owner)
  if (ids.length === 0) return Promise.resolve()
  confirming = (async () => {
    try {
      const got = await current().query({ ids, limit: ids.length })
      const found = new Set(got.filter((e) => e.pubkey === s.owner && ids.includes(e.id) && current().verify(e)).map((e) => e.id))
      if (noteFound(s.owner, found)) void flush('named')
    } catch { /* asked again later */ }
  })().finally(() => { confirming = null; say(sessionFor()) })
  return confirming
}

const asked = new Set<string>()
onActionSigned((ev) => {
  const s = sessionFor()
  if (!s || ev.pubkey !== s.owner) return
  if (!ev.tags.some((t) => t[0] === 'builder' || t[0] === 'builder-retire')) return
  if (asked.has(ev.id)) return
  asked.add(ev.id)
  if (asked.size > 256) asked.delete(asked.values().next().value as string)
  // A move goes out a moment after it is signed: ask after it has had time to land.
  for (const ms of [1_500, 4_000, 15_000, 45_000]) setTimeout(() => { void confirmTags() }, ms)
})
onBuilderChange((owner) => { if (session?.owner === owner) say(session) })

/** The bag's RETIRE: this device's key retired (every layer it signed is void), a new one made; both ride on your next move, and your blocks go out again under the new key. */
export function retireDeviceKey(): boolean {
  const s = sessionFor()
  if (!s) return false
  const rec = retireCurrent(s.owner)
  s.republish = true
  s.gen++
  // The Crew as kept is read first, so the republish flag is saved beside the list, never over it.
  void loadCrew(s).then(() => { if (!s.closed) saveCrew(s) })
  say(s)
  return rec !== null
}

// ---------------------------------------------------------------------------------------------------------------
// Publishing.

/** Publish what waits in `only` (else every chunk), one chunk after another, and every layer again when the key or the Crew changed. */
export function flush(why: string, only?: string[]): Promise<void> {
  const s = sessionFor()
  if (!s) return Promise.resolve()
  if (s.flushing) { s.again = true; return s.flushing }
  s.flushing = (async () => {
    do {
      s.again = false
      if (!current().live() || s.closed) break
      if (current().me() !== s.owner) break
      // Every layer carries the Crew as kept: read before anything goes out.
      await loadCrew(s)
      await confirmTags()
      const list = only ?? [...s.waiting.keys()]
      for (const key of list) {
        if (s.closed || !current().live()) break
        if (!s.waiting.get(key)) continue
        await publishChunk(s, key).catch((err) => { s.failed = failWords(err) })
      }
      if (s.republish && !s.closed && current().live()) await republishAll(s).catch((err) => { s.failed = failWords(err) })
      only = undefined
    } while (s.again && !s.closed)
  })().finally(() => {
    s.flushing = null
    if (!s.closed && (waitingTotal(s) > 0 || s.republish) && current().live() && namedKey(s.owner)) {
      if (s.retry) clearTimeout(s.retry)
      s.retry = setTimeout(() => { s.retry = null; void flush('retry') }, RETRY_MS)
    }
    say(s)
  })
  void why
  return s.flushing
}

class Held extends Error {}

function failWords(err: unknown): string {
  if (err instanceof Held) return err.message
  return 'Sharing again soon.'
}

/** Sign a plaintext as a layer: sealed, tagged, and checked against the size guard and the free-text bounds. */
async function signLayer(o: { plaintext: LayerPlaintext; author: string; base: ChunkBase; sec: string; createdAt: number }): Promise<NostrEvent> {
  const { key, lookupId } = chunkRegionKey(o.base)
  const encrypted = await encryptForRegion(key, plaintextJson(o.plaintext))
  const tags = layerTags({ lookupId, author: o.author, encrypted })
  const sk = Uint8Array.from(o.sec.match(/../g)!.map((h) => parseInt(h, 16)))
  // Signed through lib/signers.ts like every key this app holds; a block layer carries no client tag (lib/client.ts, §5.1).
  const ev = await localSigner(sk).signEvent({ kind: LAYER_KIND, created_at: o.createdAt, tags, content: LAYER_CONTENT })
  if (serializedBytes(ev) > LAYER_MAX_BYTES) throw new Held('This chunk holds more than one layer can carry: undo some changes here.')
  if (!freeTextWithinBounds(ev)) throw new Held('Something here could not be written.')
  return ev
}

async function publishChunk(s: Session, key: string): Promise<void> {
  const d = current()
  const f = host?.field()
  const slot = f?.slot(key)
  // A chunk not held now: its row stays dirty on the device, and it waits again when it is loaded (prepareChunk).
  if (!f || !slot?.own || !slot.generated) { s.waiting.delete(key); return }
  const k = namedKey(s.owner)
  if (!k || !k.named) throw new Held('Shared after your next move.')
  await host!.fold(key)
  const row = await rowOf(s, key)
  const waitingAtStart = s.waiting.get(key) ?? 0
  const prev = row.plaintext ? parsePlaintext(row.plaintext) : null
  const explicit = new Set(row.explicit)
  let plain: LayerPlaintext | null
  let olds: OtherKey[] = []
  let newKey: { mine: Map<0 | 1, PlaneChanges>; groundAt: (p: 0 | 1) => Uint8Array | null } | null = null
  if (row.builder === k.pub) {
    // The same key: this plane as the device holds it, the twin carried, the Crew. Nothing changed: nothing to publish.
    plain = nextPlaintext(prev, s.plane as 0 | 1, slot.own, slot.generated, s.crew, explicit)
  } else {
    // A new key at this chunk (§5.6): the author's other keys' layers here first, then this device's changes over them.
    olds = await otherKeys(s, slot.base, k.pub)
    const twin = (1 - s.plane) as 0 | 1
    const grounds = new Map<number, Uint8Array>([[s.plane, slot.generated]])
    if (olds.some((o) => o.plaintext.planes.some((p) => p.plane === twin)) || prev?.planes.some((p) => p.plane === twin)) grounds.set(twin, await groundOf({ ...slot.base, plane: twin }))
    const groundAt = (p: 0 | 1): Uint8Array | null => grounds.get(p) ?? null
    const mine = prev ? changesOf(prev, groundAt) : new Map<0 | 1, PlaneChanges>()
    const here = new Map<number, number>()
    for (let c = 0; c < CELLS; c++) if (slot.own[c] !== slot.generated[c] || explicit.has(c)) here.set(c, slot.own[c])
    mine.set(s.plane as 0 | 1, { survey: true, cells: here })
    plain = startFrom(olds.filter((o) => o.valid).map((o) => ({ changes: changesOf(o.plaintext, groundAt), createdAt: o.createdAt, builder: o.builder, id: o.id })), mine, groundAt, s.crew)
    newKey = { mine, groundAt }
  }
  if (plain) {
    const createdAt = Math.max(Math.floor(d.now() / 1000), row.createdAt + 1)
    const ev = await signLayer({ plaintext: plain, author: s.owner, base: slot.base, sec: k.sec, createdAt })
    const res = await pacedPublish(ev, () => d.live() && d.me() === s.owner && !s.closed)
    if (!res.ok) throw new Held('Sharing again soon.')
    saveRow(s, key, { ...(s.rows.get(key) ?? row), plaintext: plaintextJson(plain), eventId: ev.id, builder: k.pub, createdAt, dirty: false })
    // What the other keys held here is yours on this device now, in both planes, so the next version keeps it.
    if (newKey) await carryIn(s, slot.base, plain, newKey.mine, newKey.groundAt)
    await emptyOlds(s, olds, slot.base, createdAt)
  } else {
    saveRow(s, key, { ...(s.rows.get(key) ?? row), dirty: false })
  }
  // Changes made while it went out still wait.
  const left = (s.waiting.get(key) ?? 0) - waitingAtStart
  if (left > 0) { s.waiting.set(key, left); saveRow(s, key, { ...s.rows.get(key)!, dirty: true }) } else s.waiting.delete(key)
  s.failed = null
}

/**
 * After a new key published a layer that started from the author's other
 * keys' layers (§5.6): the cells it took from them, in each plane, are this
 * device's own now. Kept as `carried` in each plane's row (applied to the
 * device's blocks whenever the chunk loads, until changed), and taken into
 * a loaded chunk at once.
 */
async function carryIn(s: Session, base: ChunkBase, plain: LayerPlaintext, mine: Map<0 | 1, PlaneChanges>, groundAt: (p: 0 | 1) => Uint8Array | null): Promise<void> {
  for (const [plane, ch] of changesOf(plain, groundAt)) {
    const own = mine.get(plane)?.cells
    const cells = new Map([...ch.cells].filter(([c]) => !own?.has(c)))
    if (cells.size === 0) continue
    const key = chunkKey({ ...base, plane })
    const row = s.rows.get(key) ?? (plane === s.plane ? await rowOf(s, key) : await storedRow(s, key))
    const g = groundAt(plane)
    const explicit = new Set(row.explicit)
    if (g) for (const [c, v] of cells) if (v === g[c]) explicit.add(c)
    const next: ShareRow = { ...row, carried: [...new Set([...row.carried, ...cells.keys()])], explicit: [...explicit] }
    if (plane === s.plane) {
      saveRow(s, key, { ...(s.rows.get(key) ?? next), carried: next.carried, explicit: next.explicit })
      await host?.adopt(key, cells)
    } else {
      const d = db()
      if (d) await putMany(d, META, [{ key: rowKey(s.owner, key), value: { dirty: next.dirty, explicit: next.explicit, carried: next.carried } }]).catch(() => undefined)
    }
  }
}

/** A plane row as kept on the device, for a chunk this session does not hold (the twin plane). */
async function storedRow(s: Session, key: string): Promise<ShareRow> {
  const d = db()
  if (!d) return emptyRow()
  try {
    const got = await request(d.transaction([META], 'readonly').objectStore(META).get(rowKey(s.owner, key))) as { value?: Partial<ShareRow> } | undefined
    return { ...emptyRow(), dirty: got?.value?.dirty === true, explicit: cellList(got?.value?.explicit), carried: cellList(got?.value?.carried) }
  } catch { return emptyRow() }
}

/** When a chunk loads: the cells carried in from your other keys (carryIn) become your own blocks, as last published. */
export function applyCarried(key: string, own: Uint8Array, ground: Uint8Array): void {
  const s = sessionFor()
  const row = s?.rows.get(key)
  if (!s || !row?.plaintext || row.carried.length === 0) return
  const p = parsePlaintext(row.plaintext)
  const ch = p ? changesOf(p, (plane) => (plane === s.plane ? ground : null)).get(s.plane as 0 | 1) : undefined
  if (!ch) return
  for (const c of row.carried) { const v = ch.cells.get(c); if (v !== undefined) own[c] = Math.min(v, 255) }
}

/** Why a new key waits at a chunk: the words for the bag (§5.6). */
export const HOLD_OTHER_KEYS = 'Waiting to read what your other devices built here.'

/** Another builder key's layer of the author's at a chunk (§5.6): read, and whether its key is valid. */
interface OtherKey {
  builder: string
  id: string
  createdAt: number
  plaintext: LayerPlaintext
  valid: boolean
}

/**
 * The newest layer of each of the author's other keys at a chunk, from the
 * canonical relay (`#d` and `#p`), read by §6. Throws Held while one cannot
 * be read yet (the relay cannot be asked, or a key not checked yet), so the
 * new key holds its layer rather than publish one that would compete.
 */
async function otherKeys(s: Session, base: ChunkBase, myKey: string): Promise<OtherKey[]> {
  const d = current()
  const { key: rkey, lookupId } = chunkRegionKey(base)
  let events: NostrEvent[]
  try { events = await d.query({ kinds: [LAYER_KIND], '#d': [lookupId], '#p': [s.owner] }) } catch { throw new Held(HOLD_OTHER_KEYS) }
  const newest = new Map<string, NostrEvent>()
  for (const ev of events) {
    const shape = layerShape(ev)
    if (!shape || shape.author !== s.owner || shape.lookupId !== lookupId || ev.pubkey === myKey) continue
    const was = newest.get(ev.pubkey)
    if (!was || ev.created_at > was.created_at || (ev.created_at === was.created_at && ev.id < was.id)) newest.set(ev.pubkey, ev)
  }
  if (newest.size === 0) return []
  const status = await statusesOf(s.owner, [...newest.keys()])
  const out: OtherKey[] = []
  for (const ev of newest.values()) {
    const st = status.get(ev.pubkey) ?? 'unknown'
    if (st === 'unknown') throw new Held(HOLD_OTHER_KEYS)
    const r = await readLayer(ev, { verify: d.verify, key: rkey, lookupId, ground: (plane) => groundOf({ ...base, plane }), keyStatus: async () => st }).catch(() => null)
    if (!r || r.status === 'pending') throw new Held(HOLD_OTHER_KEYS)
    if (r.status !== 'counted') continue
    out.push({ builder: ev.pubkey, id: ev.id, createdAt: ev.created_at, plaintext: r.plaintext, valid: st === 'valid' })
  }
  return out
}

/** With each old key this device still holds and is not retiring, a version of its layer here that changes no cell (§5.6). */
async function emptyOlds(s: Session, olds: OtherKey[], base: ChunkBase, createdAt: number): Promise<void> {
  for (const o of olds) {
    const held = deviceKeys(s.owner).find((r) => r.pub === o.builder && !r.retire)
    if (!held || !o.valid) continue
    // It keeps your Crew: the newest of your layers here may be this one (§8), and an empty list would drop every lift.
    const ev = await signLayer({ plaintext: emptiedPlaintext(o.plaintext, s.crew), author: s.owner, base, sec: held.sec, createdAt })
    await pacedPublish(ev, () => current().live() && current().me() === s.owner && !s.closed).catch(() => undefined)
  }
}

/**
 * Every layer this device published, again: under the current key when it
 * was signed by a retired one (a retired key voids its layers; §4.3), started
 * from the author's other keys' layers there (§5.6), and with the current
 * Crew when the list changed. From what this device kept of each, so a
 * chunk need not be loaded.
 */
async function republishAll(s: Session): Promise<void> {
  const d = current()
  const k = namedKey(s.owner)
  const store = db()
  if (!k || !k.named) throw new Held('Shared after your next move.')
  if (!store) return
  const gen = s.gen
  let failed: unknown = null
  const rows = await request(store.transaction([META], 'readonly').objectStore(META).getAll(IDBKeyRange.bound(pubPrefix(s.owner), `${pubPrefix(s.owner)}~`))) as Array<{ key: string; value?: Partial<PublishedRow> }>
  for (const r of rows) {
    if (s.closed || !d.live() || s.gen !== gen) return
    // One chunk that cannot go now never holds up the rest; it is tried again on the next pass.
    try { await republishRow(s, store, k, r) } catch (err) { failed = err }
  }
  if (failed) throw failed
  if (s.gen === gen) { s.republish = false; saveCrew(s) }
}

async function republishRow(s: Session, store: IDBDatabase, k: { pub: string; sec: string }, r: { key: string; value?: Partial<PublishedRow> }): Promise<void> {
  const d = current()
  const pub = pickPublished(r.value)
  const prev = pub.plaintext ? parsePlaintext(pub.plaintext) : null
  const at = parseChunkKey(`0:${r.key.slice(pubPrefix(s.owner).length)}`)
  if (!prev || !at) return
  if (pub.builder === k.pub && JSON.stringify(prev.cobuilders) === JSON.stringify(s.crew)) return
  let plain: LayerPlaintext = { ...prev, cobuilders: [...s.crew] }
  let olds: OtherKey[] = []
  let newKey: { mine: Map<0 | 1, PlaneChanges>; groundAt: (p: 0 | 1) => Uint8Array | null } | null = null
  if (pub.builder !== k.pub) {
    olds = await otherKeys(s, at, k.pub)
    const grounds = new Map<number, Uint8Array>()
    for (const p of [0, 1] as const) grounds.set(p, await groundOf({ ...at, plane: p }))
    const groundAt = (p: 0 | 1): Uint8Array | null => grounds.get(p) ?? null
    const mine = changesOf(prev, groundAt)
    plain = startFrom(olds.filter((o) => o.valid).map((o) => ({ changes: changesOf(o.plaintext, groundAt), createdAt: o.createdAt, builder: o.builder, id: o.id })), mine, groundAt, s.crew)
    newKey = { mine, groundAt }
  }
  const createdAt = Math.max(Math.floor(d.now() / 1000), pub.createdAt + 1)
  const ev = await signLayer({ plaintext: plain, author: s.owner, base: at, sec: k.sec, createdAt })
  const res = await pacedPublish(ev, () => d.live() && d.me() === s.owner && !s.closed)
  if (!res.ok) throw new Held('Sharing again soon.')
  const next: PublishedRow = { plaintext: plaintextJson(plain), eventId: ev.id, builder: k.pub, createdAt }
  await putMany(store, META, [{ key: r.key, value: next }]).catch(() => undefined)
  // Rows loaded this session see it too.
  for (const [key, row] of s.rows) if (pubKey(s.owner, key) === r.key) s.rows.set(key, { ...row, ...next })
  if (newKey) await carryIn(s, at, plain, newKey.mine, newKey.groundAt)
  await emptyOlds(s, olds, at, createdAt)
}

/**
 * The canonical relay takes events replaceable by `d` at 3 a second per
 * connection (a burst of 8), and bags share that budget (cyberspace-relay
 * #50). Layers go out at most one per LAYER_GAP_MS, whoever sends them, and
 * a rate-limit refusal waits and tries again, longer each time, so a long
 * LOCAL-to-LIVE flush drains without tripping it or giving up.
 */
export const LAYER_GAP_MS = 500
export const RATE_BACKOFF_MS = 1_000
export const RATE_BACKOFF_MAX_MS = 16_000
export const RATE_TRIES = 6
let nextSendAt = 0
let sendQueue: Promise<unknown> = Promise.resolve()
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)))

/** Publish a layer, paced, retrying a rate-limit refusal with a growing wait; `still` is asked before every try (LOCAL never publishes). */
function pacedPublish(ev: NostrEvent, still: () => boolean): Promise<{ ok: boolean; reason?: string }> {
  const job = sendQueue.then(async () => {
    let backoff = RATE_BACKOFF_MS
    for (let i = 0; i < RATE_TRIES; i++) {
      await wait(nextSendAt - current().now())
      if (!still()) return { ok: false, reason: 'not sent: no longer LIVE' }
      nextSendAt = current().now() + LAYER_GAP_MS
      const res = await current().publish(ev).catch((err: unknown) => ({ ok: false, reason: String(err) }))
      if (res.ok || !isRateLimited(res.reason ?? '')) return res
      nextSendAt = current().now() + backoff
      backoff = Math.min(backoff * 2, RATE_BACKOFF_MAX_MS)
    }
    return { ok: false, reason: 'rate-limited' }
  })
  sendQueue = job.catch(() => undefined)
  return job
}

// ---------------------------------------------------------------------------------------------------------------
// Reading.

/** How many chunks out from yours others' layers are read: the same ring the field draws (store/useTerrain.ts DRAW_RING). */
export const READ_RING = 2

/**
 * The chunks round a place, in its plane, out to READ_RING on each axis (5 by
 * 5 by 5): the ones whose layers are read, in every mode, LIVE or LOCAL, as
 * shards are read wherever you stand (hooks/useDiscovery.ts).
 */
export function chunksAround(at: Position, plane: number, ring = READ_RING): ChunkBase[] {
  const c = chunkOf(at.x, at.y, at.z, plane)
  const out: ChunkBase[] = []
  for (let dy = -ring; dy <= ring; dy++) for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
    const b = { x: c.x + 32n * BigInt(dx), y: c.y + 32n * BigInt(dy), z: c.z + 32n * BigInt(dz), plane }
    if (b.x < 0n || b.y < 0n || b.z < 0n) continue
    out.push(b)
  }
  return out
}

/** Builder keys' status, read from the relay at most once a minute per key; a read that fails knows nothing yet. */
async function statusesOf(author: string, list: string[]): Promise<Map<string, KeyStatus>> {
  const out = new Map<string, KeyStatus>()
  const now = current().now()
  const ask: string[] = []
  for (const k of new Set(list)) {
    const have = statuses.get(`${author}|${k}`)
    if (have && now - have.at < STATUS_FRESH_MS) out.set(k, have.s)
    else ask.push(k)
  }
  if (ask.length) {
    let got: Map<string, KeyStatus>
    try { got = await current().keyStatus(author, ask) } catch { got = new Map() }
    for (const k of ask) {
      const st = got.get(k) ?? 'unknown'
      out.set(k, st)
      if (st !== 'unknown') statuses.set(`${author}|${k}`, { s: st, at: now })
    }
    while (statuses.size > 800) statuses.delete(statuses.keys().next().value as string)
  }
  return out
}

let reading: Promise<void> | null = null
/** At most one read of the chunks round you this often while you travel. */
export const READ_GAP_MS = 2_000
let lastRead = 0
let trailing: ReturnType<typeof setTimeout> | null = null
let readAgain = false

/**
 * Read the layers of the chunks round where you stand. `force` reads again
 * even when the chunks are the same. In every mode (HOP, WALK, TERRAIN) and
 * LIVE or LOCAL: blocks are part of cyberspace like shards, and reading is not
 * publishing (owner, 2026-11-25). It once ran only in TERRAIN while LIVE, and
 * only for the chunks within reach, so a visitor hopping or walking by saw
 * nothing.
 */
export function readNear(force = false): Promise<void> {
  const s = sessionFor()
  if (!s || !host) return Promise.resolve()
  keepReading()
  const at = host.head()
  // The same chunks while you stay in the one you stand in: nothing to work out on every step.
  const rk = chunkKey(chunkOf(at.x, at.y, at.z, s.plane))
  if (!force && rk === s.readKey) return reading ?? Promise.resolve()
  const bases = chunksAround(at, s.plane)
  const now = current().now()
  if (!force && now - lastRead < READ_GAP_MS) {
    trailing ??= setTimeout(() => { trailing = null; void readNear() }, READ_GAP_MS)
    return reading ?? Promise.resolve()
  }
  if (reading) { readAgain = true; return reading }
  lastRead = now
  s.readKey = rk
  reading = (async () => {
    try { await readChunks(bases) } catch { /* read again on the next move */ }
  })().finally(() => {
    reading = null
    if (readAgain) { readAgain = false; void readNear(true) }
  })
  return reading
}

/** Read and stack the layers of these chunks (exported for tests). */
export async function readChunks(bases: ChunkBase[]): Promise<void> {
  const s = sessionFor()
  if (!s || bases.length === 0) return
  const d = current()
  const byLookup = new Map<string, ChunkBase>()
  for (const b of bases) byLookup.set(chunkRegionKey(b).lookupId, b)
  const events = await d.query({ kinds: [LAYER_KIND], '#d': [...byLookup.keys()] })
  for (const ev of events) {
    const shape = layerShape(ev)
    if (!shape || !byLookup.has(shape.lookupId)) continue
    const list = s.seen.get(shape.lookupId) ?? new Map<string, NostrEvent>()
    const was = list.get(ev.pubkey)
    if (!was || ev.created_at > was.created_at || (ev.created_at === was.created_at && ev.id < was.id)) list.set(ev.pubkey, ev)
    s.seen.set(shape.lookupId, list)
  }
  for (const [lookupId, base] of byLookup) await stackChunk(s, base, lookupId)
  updateCrewOf(s)
}

/** Everyone else's valid layers in a chunk (§6), mutes removed; this device's own keys are left out (its blocks are drawn from the device). */
async function stackChunk(s: Session, base: ChunkBase, lookupId: string): Promise<void> {
  const d = current()
  const key = chunkKey(base)
  const mine = new Set(deviceKeys(s.owner).map((k) => k.pub))
  const muted = d.muted()
  // The cheap checks of §6 first (authentic, tags, limits), mutes removed, and no more authors than the Stack can count,
  // before any author's movement actions are asked for: a flood of forged layers costs no lookups.
  const nowSec = Math.floor(d.now() / 1000)
  const list = [...(s.seen.get(lookupId)?.values() ?? [])]
    .filter((ev) => !mine.has(ev.pubkey) && d.verify(ev) && serializedBytes(ev) <= LAYER_MAX_BYTES && freeTextWithinBounds(ev))
    .filter((ev) => { const sh = layerShape(ev); return !!sh && !muted.has(sh.author) })
  const view = stackView(d.me() || null, base)
  const allowed = new Set(countedLayers(list.map((ev) => ({ author: layerShape(ev)!.author, createdAt: ev.created_at })), view, muted, nowSec).map((l) => l.author))
  const byAuthor = new Map<string, string[]>()
  for (const ev of list) {
    const shape = layerShape(ev)!
    if (!allowed.has(shape.author)) continue
    byAuthor.set(shape.author, [...(byAuthor.get(shape.author) ?? []), ev.pubkey])
  }
  const status = new Map<string, KeyStatus>()
  for (const [author, ks] of byAuthor) for (const [k, st] of await statusesOf(author, ks)) status.set(`${author}|${k}`, st)
  const { key: rkey } = chunkRegionKey(base)
  const layers: StackLayer[] = []
  for (const ev of list) {
    const shape = layerShape(ev)!
    if (!allowed.has(shape.author)) continue
    const r = await readLayer(ev, {
      verify: d.verify, key: rkey, lookupId,
      ground: (plane) => groundOf({ ...base, plane }),
      keyStatus: async (author, builder) => status.get(`${author}|${builder}`) ?? 'unknown',
    }).catch(() => null)
    if (r?.status === 'counted') layers.push(r.layer)
  }
  if (s.closed) return
  const before = s.others.get(key)
  const next: ChunkLayers = { layers }
  if (layers.length === 0) {
    if (before) { s.others.delete(key); host?.redisplay(key) }
    return
  }
  if (before && sameLayers(before, next)) return
  s.others.set(key, next)
  host?.redisplay(key)
}

function sameLayers(a: ChunkLayers, b: ChunkLayers): boolean {
  if (a.layers.length !== b.layers.length) return false
  const ids = new Set(a.layers.map((l) => l.id))
  return b.layers.every((l) => ids.has(l.id))
}

/** "You build on theirs": the authors whose newest layer you have read here lists you (§8). */
function updateCrewOf(s: Session): void {
  const me = current().me()
  const newest = new Map<string, StackLayer>()
  for (const c of s.others.values()) for (const l of c.layers) { const n = newest.get(l.author); if (!n || withinRank(l, n) < 0) newest.set(l.author, l) }
  const list = [...newest.values()].filter((l) => l.author !== me && l.cobuilders.includes(me)).map((l) => l.author).sort()
  const was = useShare.getState().crewOf
  if (was.length !== list.length || was.some((p, i) => p !== list[i])) useShare.setState({ crewOf: list })
}
