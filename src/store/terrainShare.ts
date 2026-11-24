/**
 * terrainShare.ts - TERRAIN's blocks shared with everyone (DECK-0009).
 *
 * WRITING. This device's changes to a chunk are published as its block
 * layer (kind 33339), signed by this device's builder key
 * (lib/terrain/builderKey.ts) so no signer is ever asked, sealed with the
 * chunk's region key, with the tags the DECK requires (lib/terrain/
 * blockLayer.ts) and settles committed to a Bitcoin block 6 deep
 * (lib/terrain/layerWriter.ts). Only to the canonical relay,
 * wss://relay.onosendai.tech, and only:
 *
 * - while LIVE. LOCAL never publishes a layer, as LOCAL never publishes a
 *   move; what waits goes out on the next turn to LIVE;
 * - once the movement action naming the builder key is on the canonical
 *   relay, and with a reach event (an action of yours on the relay, within
 *   16 gibsons of the chunk) after it on your chain;
 * - at the DECK's moments (§5.7): when you leave the chunk by more than 4
 *   blocks, after 15 seconds without a change alone or 3 seconds with
 *   someone near, at 200 waiting changes alone or 50 with someone near, and
 *   when TERRAIN closes.
 *
 * The bag says where that stands: saved on this device, sharing, shared.
 *
 * READING. Other builders' layers for the chunks within reach of where you
 * stand (only those: region keys are derived for nothing farther) are read
 * from the canonical relay, checked by §6.1 (lib/terrain/layerReader.ts),
 * their builder keys checked on their authors' chains (lib/terrain/
 * reachChain.ts), mutes and the 64-author cap applied, and merged by the
 * Cell Rule (§7). What it gives is drawn and walked on like your own.
 *
 * The witness's first-seen heights (W) cannot be asked for yet: the DECK
 * leaves how open (§7.4, §12 question 2). So every settle is unwitnessed,
 * and placements are ordered by committed block, then work, then pubkey:
 * the DECK's stated fallback, honest where nobody contests a cell. The
 * resolver takes W the moment there is a way to learn it.
 *
 * YOUR VIEW. Your own changes are drawn for you over the merge wherever you
 * made them: a cell someone else owns that you changed shows your change to
 * you alone, as the DECK says (§7.3), and to nobody else.
 */

import { create } from 'zustand'
import { finalizeEvent } from 'nostr-tools/pure'
import { coordToXyz } from 'cyberspace-core'
import { CELLS, chunkKey, chunkOf, type ChunkBase } from '../lib/terrain/coords'
import { regionKeyAt, encryptForRegion } from '../lib/shardCrypto'
import { reachDistance, REACH } from '../lib/terrain/world'
import {
  LAYER_KIND, LAYER_MAX_BYTES, SETTLE_DEPTH, countedAuthors, layerShape, layerTags, parsePlaintext, plaintextJson, resolvePlane, serializedBytes, settleId,
  type CountedLayer, type LayerPlaintext,
} from '../lib/terrain/blockLayer'
import { nextPlaintext, type CommittedBlock } from '../lib/terrain/layerWriter'
import { readLayer, type HeaderVerdict } from '../lib/terrain/layerReader'
import { reachCandidates, reachPlaces, readChainOf, retiredAnywhere, onLine, type ReadChain } from '../lib/terrain/reachChain'
import {
  deviceKeys, ensureBuilderKey, nameAgain, namedKey, noteFound, onBuilderChange, retireCurrent, waitingIds, builderRecord,
} from '../lib/terrain/builderKey'
import { onActionSigned } from '../lib/terrain/builderTags'
import { putMany, request } from '../lib/idb'
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
/** How often, while TERRAIN is open, the layers in reach are read again (ms). */
export const READ_EVERY_MS = 12_000
/** How near someone must be, in gibsons, to count as building with you. */
export const NEAR_GIBSONS = 64
/** A fixed content for every layer: it says nothing about the place (§5.1). */
export const LAYER_CONTENT = ''

// ---------------------------------------------------------------------------------------------------------------
// What this module needs from the world, swapped out in tests.

export interface ShareDeps {
  /** LIVE for the identity on screen. */
  live: () => boolean
  /** The identity on screen. */
  me: () => string
  /** Your movement actions as this device holds them. */
  ownEvents: () => readonly NostrEvent[]
  /** Publish to the canonical relay alone. */
  publish: (ev: NostrEvent) => Promise<{ ok: boolean; reason?: string }>
  /** Read from the canonical relay alone. */
  query: (filter: Filter) => Promise<NostrEvent[]>
  /** An author's movement actions, read from the relays. */
  authorEvents: (pubkey: string) => Promise<NostrEvent[]>
  /** The 5.13 list for judging old hops, or null. */
  v1List: () => ReadonlySet<string> | null
  /** A block at least 6 below the tip, with its hash; null when none can be had now. */
  commitBlock: () => Promise<CommittedBlock | null>
  /** A settle's block against this reader's headers. */
  header: (height: number, hash: string) => Promise<HeaderVerdict>
  /** The revision 2 ground of a chunk. */
  ground: (base: ChunkBase) => Promise<Uint8Array>
  muted: () => ReadonlySet<string>
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
}

let host: ShareHost | null = null

/** store/useTerrain.ts connects the field here. */
export function connectShareHost(h: ShareHost | null): void {
  host = h
}

// ---------------------------------------------------------------------------------------------------------------
// The bag's line.

export type ShareState = 'saved' | 'sharing' | 'shared'

export interface ShareView {
  state: ShareState
  /** Plain words for the bag. */
  words: string
}

export const useShare = create<ShareView>(() => ({ state: 'saved', words: 'Saved on this device.' }))

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
  /** The reach event it named, per plane. */
  reach: Record<string, string>
  createdAt: number
}

/** What waits in one chunk (one plane), with what was published at its address. */
export interface ShareRow extends PublishedRow {
  /** Changes made since it was published. */
  dirty: boolean
  /** Cells you changed back to their ground: drawn as yours over anyone's blocks there. */
  touched: number[]
}

/** A chunk key without its plane: the address its layer and its twin's share. */
const addressOf = (key: string): string => key.slice(key.indexOf(':') + 1)
const rowKey = (owner: string, key: string): string => `${owner}|share|${key}`
const pubKey = (owner: string, key: string): string => `${owner}|layer|${addressOf(key)}`
const emptyRow = (): ShareRow => ({ plaintext: null, eventId: null, builder: null, reach: {}, createdAt: 0, dirty: false, touched: [] })

interface OthersView {
  /** The Cell Rule's value per cell, or -1 where the base shows. */
  values: Int32Array
  /** Some counted layer surveys this plane: the base is the ground. */
  surveyed: boolean
  authors: string[]
}

interface Session {
  owner: string
  plane: number
  rows: Map<string, ShareRow>
  loading: Map<string, Promise<ShareRow>>
  /** Changes since the last publish, by chunk. */
  waiting: Map<string, number>
  touched: Map<string, Set<number>>
  others: Map<string, OthersView>
  /** The newest layer event per chunk lookup id and builder key. */
  seen: Map<string, Map<string, NostrEvent>>
  idle: ReturnType<typeof setTimeout> | null
  retry: ReturnType<typeof setTimeout> | null
  reader: ReturnType<typeof setInterval> | null
  flushing: Promise<void> | null
  again: boolean
  failed: string | null
  sending: boolean
  readKey: string
  closed: boolean
}

let session: Session | null = null
const chains = new Map<string, ReadChain>()
const grounds = new Map<string, Promise<Uint8Array>>()
const keys = new Map<string, { key: Uint8Array; lookupId: string }>()

function sessionFor(): Session | null {
  const f = host?.field()
  if (!f) return null
  if (!session || session.owner !== f.owner || session.plane !== f.plane) {
    if (session) closeSession(session)
    session = {
      owner: f.owner, plane: f.plane, rows: new Map(), loading: new Map(), waiting: new Map(), touched: new Map(), others: new Map(), seen: new Map(),
      idle: null, retry: null, reader: null, flushing: null, again: false, failed: null, sending: false, readKey: '', closed: false,
    }
  }
  return session
}

function closeSession(s: Session): void {
  s.closed = true
  if (s.idle) clearTimeout(s.idle)
  if (s.retry) clearTimeout(s.retry)
  if (s.reader) clearInterval(s.reader)
}

/** For tests: forget everything held. */
export function resetShare(): void {
  if (session) closeSession(session)
  session = null
  chains.clear()
  grounds.clear()
  keys.clear()
  lastRead = 0
  useShare.setState({ state: 'saved', words: 'Saved on this device.' })
}

/** The chunk's h5 region key and lookup id (DECK-0009 §2.2), the same for both planes. */
export function chunkRegionKey(base: ChunkBase): { key: Uint8Array; lookupId: string } {
  const k = `${base.x}:${base.y}:${base.z}`
  let v = keys.get(k)
  if (!v) {
    const rk = regionKeyAt(base, 5, 5)
    v = { key: rk.key, lookupId: rk.lookupId }
    keys.set(k, v)
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

async function rowOf(s: Session, key: string): Promise<ShareRow> {
  const have = s.rows.get(key)
  if (have) return have
  let p = s.loading.get(key)
  if (!p) {
    p = (async () => {
      const db = host?.field()?.db ?? null
      let row = emptyRow()
      if (db) {
        try {
          const store = db.transaction([META], 'readonly').objectStore(META)
          const [mine, pub] = await Promise.all([
            request(store.get(rowKey(s.owner, key))) as Promise<{ value?: Partial<ShareRow> } | undefined>,
            request(store.get(pubKey(s.owner, key))) as Promise<{ value?: Partial<PublishedRow> } | undefined>,
          ])
          row = { ...emptyRow(), ...(mine?.value ?? {}), ...(pub?.value ?? {}) }
          if (!row.reach || typeof row.reach !== 'object') row.reach = {}
          if (!Array.isArray(row.touched)) row.touched = []
        } catch { /* a fresh row */ }
      }
      // Built here before this version: what was surveyed and changed waits to be shared.
      if (row.eventId === null && host?.field()?.surveyed(key)) row.dirty = true
      s.rows.set(key, row)
      s.touched.set(key, new Set(row.touched))
      if (row.dirty && !s.waiting.has(key)) s.waiting.set(key, 1)
      return row
    })()
    s.loading.set(key, p)
  }
  return p
}

function saveRow(s: Session, key: string, row: ShareRow): void {
  s.rows.set(key, row)
  const db = host?.field()?.db ?? null
  const pub: PublishedRow = { plaintext: row.plaintext, eventId: row.eventId, builder: row.builder, reach: row.reach, createdAt: row.createdAt }
  if (db && !s.closed) {
    void putMany(db, META, [
      { key: rowKey(s.owner, key), value: { dirty: row.dirty, touched: row.touched } },
      { key: pubKey(s.owner, key), value: pub },
    ]).catch(() => { /* kept in memory */ })
  }
}

/** Read a chunk's row before it is drawn (its touched cells shape your view). */
export async function prepareChunk(key: string): Promise<void> {
  const s = sessionFor()
  if (!s) return
  const row = await rowOf(s, key)
  // Changes kept from before (another visit, or a chunk let go while they waited) wait again now it is here.
  if (row.dirty && !s.waiting.has(key)) { s.waiting.set(key, 1); arm(s); say(s) }
}

// ---------------------------------------------------------------------------------------------------------------
// Your view: your own changes over the merge.

/**
 * What a chunk shows you: your own value wherever you changed the cell (it
 * differs from the ground, or you set it back to the ground), else the Cell
 * Rule's value from everyone else's layers, else the base: the ground where
 * you or a counted layer surveyed, open space where nobody did.
 */
export function composeView(ground: Uint8Array, own: Uint8Array | null, touched: ReadonlySet<number> | null, others: { values: Int32Array; surveyed: boolean } | null): Uint8Array {
  const out = new Uint8Array(CELLS)
  const ground0 = own !== null || !!others?.surveyed
  for (let c = 0; c < CELLS; c++) {
    if (own && (own[c] !== ground[c] || touched?.has(c))) { out[c] = own[c]; continue }
    const v = others ? others.values[c] : -1
    out[c] = v >= 0 ? Math.min(v, 255) : ground0 ? ground[c] : 0
  }
  return out
}

/** The blocks a chunk shows you now (store/useTerrain.ts draws these). */
export function viewOf(key: string, ground: Uint8Array, own: Uint8Array | null): Uint8Array {
  const s = sessionFor()
  const others = s?.others.get(key) ?? null
  if (!others && own) return own.slice()
  return composeView(ground, own, s?.touched.get(key) ?? null, others)
}

/** Chunks that others built in near you: loaded and drawn even where you never surveyed. */
export function sharedKeys(): ReadonlySet<string> {
  const s = sessionFor()
  return new Set(s ? [...s.others.keys()] : [])
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
  const waiting = waitingTotal(s) > 0
  const named = namedKey(s.owner) !== null
  const owed = builderRecord(s.owner)?.keys.some((k) => k.retire && k.retire.confirmed === null) ?? false
  let v: ShareView
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

/** A change was made to a chunk (a mine, a place, a survey). `cell` and `ground` say whether it set the cell back to its ground. */
export function noteChange(key: string, change?: { cell: number; backToGround: boolean }): void {
  const s = sessionFor()
  if (!s) return
  void rowOf(s, key).then((row) => {
    if (s.closed) return
    const t = s.touched.get(key) ?? new Set<number>()
    if (change) {
      if (change.backToGround) t.add(change.cell)
      else t.delete(change.cell)
    }
    s.touched.set(key, t)
    s.waiting.set(key, (s.waiting.get(key) ?? 0) + 1)
    saveRow(s, key, { ...row, dirty: true, touched: [...t] })
    if ((s.waiting.get(key) ?? 0) >= (near() ? BATCH_NEAR : BATCH_ALONE)) void flush('batch', [key])
    else arm(s)
    say(s)
  })
}

/** You moved: a chunk left by more than LEAVE_BLOCKS publishes what waits, and the layers in reach are read. */
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

/** TERRAIN opened: this device's builder key is made if it has none, and the layers in reach are read and kept fresh. */
export async function terrainOpened(): Promise<void> {
  const s = sessionFor()
  if (!s) return
  // What this identity kept is read before TERRAIN opens (store/useTerrain.ts makeField), so a key is made only when there is none.
  ensureBuilderKey(s.owner)
  void confirmTags()
  if (s.reader) clearInterval(s.reader)
  s.reader = setInterval(() => { if (host?.active()) { void readNear(true); void confirmTags() } }, READ_EVERY_MS)
  void readNear(true)
  say(s)
}

/** TERRAIN closed: everything waiting is published (while LIVE), and the reading stops. */
export async function terrainClosed(): Promise<void> {
  const s = sessionFor()
  if (!s) return
  if (s.reader) clearInterval(s.reader)
  s.reader = null
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
  if (live) void flush('live')
  else if (s.idle) { clearTimeout(s.idle); s.idle = null }
  say(s)
}

// ---------------------------------------------------------------------------------------------------------------
// The builder key's tags: confirmed on the canonical relay.

let confirming: Promise<void> | null = null

/** Ask the canonical relay which actions carrying an owed builder tag it holds. */
export function confirmTags(): Promise<void> {
  const s = sessionFor()
  if (!s) return Promise.resolve()
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
  // A move goes out a moment after it is signed: ask after it has had time to land.
  for (const ms of [4_000, 15_000, 45_000]) setTimeout(() => { void confirmTags() }, ms)
})
onBuilderChange((owner) => { if (session?.owner === owner) say(session) })

/** The bag's RETIRE: this device's key retired from here on, a new one made; both ride on your next move. */
export function retireDeviceKey(all = false): boolean {
  const s = sessionFor()
  if (!s) return false
  const rec = retireCurrent(s.owner, all)
  // Everything this device built is written again under the new key, at the next chance in each chunk.
  for (const [key, row] of s.rows) if (row.eventId) { s.waiting.set(key, Math.max(1, s.waiting.get(key) ?? 0)); saveRow(s, key, { ...row, dirty: true }) }
  say(s)
  return rec !== null
}

// ---------------------------------------------------------------------------------------------------------------
// Publishing.

/** Publish what waits in `only` (else every chunk), one chunk after another. */
export function flush(why: string, only?: string[]): Promise<void> {
  const s = sessionFor()
  if (!s) return Promise.resolve()
  if (s.flushing) { s.again = true; return s.flushing }
  s.flushing = (async () => {
    do {
      s.again = false
      if (!current().live() || s.closed) break
      if (current().me() !== s.owner) break
      await confirmTags()
      const list = only ?? [...s.waiting.keys()]
      for (const key of list) {
        if (s.closed || !current().live()) break
        if (!s.waiting.get(key)) continue
        await publishChunk(s, key).catch((err) => { s.failed = failWords(err) })
      }
      only = undefined
    } while (s.again && !s.closed)
  })().finally(() => {
    s.flushing = null
    if (!s.closed && waitingTotal(s) > 0 && current().live() && namedKey(s.owner)) {
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

/** Sign a plaintext as a layer: sealed, tagged, and checked against the size guard. */
async function signLayer(o: { plaintext: LayerPlaintext; author: string; base: ChunkBase; reach: string[]; sec: string; createdAt: number }): Promise<NostrEvent> {
  const { key, lookupId } = chunkRegionKey(o.base)
  const ids = o.plaintext.settles.map((st) => settleId(o.author, lookupId, st))
  if (ids.some((id) => id === null)) throw new Held('Something here could not be written.')
  const encrypted = await encryptForRegion(key, plaintextJson(o.plaintext))
  const tags = layerTags({ lookupId, author: o.author, reach: o.reach, settleIds: ids as string[], encrypted })
  const sk = Uint8Array.from(o.sec.match(/../g)!.map((h) => parseInt(h, 16)))
  const ev = finalizeEvent({ kind: LAYER_KIND, created_at: o.createdAt, tags, content: LAYER_CONTENT }, sk) as unknown as NostrEvent
  if (serializedBytes(ev) > LAYER_MAX_BYTES) throw new Held('This chunk holds more than one layer can carry: undo some changes here.')
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
  const chain = readChainOf(s.owner, d.ownEvents(), d.v1List())
  // A naming the chain no longer holds (a respawn): name the key again on the next move.
  if (!onLine(chain, k.named)) { nameAgain(s.owner, k.pub); throw new Held('Shared after your next move.') }
  const candidates = reachCandidates(chain, k.pub, k.named, slot.base)
  if (candidates.length === 0) throw new Held('Shared once you move near it again.')
  const held = new Set((await d.query({ ids: candidates.map((a) => a.id), limit: candidates.length })).map((e) => e.id))
  const reach = candidates.find((a) => held.has(a.id))
  if (!reach) throw new Held('Shared once your moves reach the relay.')
  const block = await d.commitBlock()
  if (!block) throw new Held('Waiting for a Bitcoin block to settle on.')
  await host!.fold(key)
  const row = await rowOf(s, key)
  const waitingAtStart = s.waiting.get(key) ?? 0
  const prev = row.plaintext ? parsePlaintext(row.plaintext) : null
  const otherPlane = (1 - s.plane) as 0 | 1
  const otherGround = prev?.planes.some((p) => p.plane === otherPlane) ? await groundOf({ ...slot.base, plane: otherPlane }) : null
  const own = slot.own
  const sameKey = row.builder === k.pub
  // Nothing changed, and this key signed the last version: nothing to publish.
  const plain = nextPlaintext({ prev, plane: s.plane as 0 | 1, values: own, ground: slot.generated, otherGround, block }) ?? (sameKey ? null : prev)
  if (plain) {
    const createdAt = Math.max(Math.floor(d.now() / 1000), row.createdAt + 1)
    // One reach event per plane (§5.1): this plane's now, and the twin plane's it was carried with.
    const reaches: Record<string, string> = { [String(s.plane)]: reach.id }
    const other = row.reach[String(otherPlane)]
    if (other && plain.planes.some((p) => p.plane === otherPlane)) reaches[String(otherPlane)] = other
    const ev = await signLayer({ plaintext: plain, author: s.owner, base: slot.base, reach: Object.keys(reaches).sort().map((p) => reaches[p]), sec: k.sec, createdAt })
    // LOCAL never publishes: asked again at the last moment, after every wait above.
    if (!d.live() || d.me() !== s.owner || s.closed) throw new Held('Sharing again soon.')
    s.sending = true
    say(s)
    const res = await d.publish(ev).finally(() => { s.sending = false })
    if (!res.ok) throw new Held('Sharing again soon.')
    // The layer an earlier key of this device wrote here is emptied, so its blocks are not counted twice.
    if (row.builder && !sameKey) await emptyOld(s, row, slot.base, createdAt)
    saveRow(s, key, { ...row, plaintext: plaintextJson(plain), eventId: ev.id, builder: k.pub, reach: reaches, createdAt, dirty: false })
  } else {
    saveRow(s, key, { ...row, dirty: false })
  }
  // Changes made while it went out still wait.
  const left = (s.waiting.get(key) ?? 0) - waitingAtStart
  if (left > 0) { s.waiting.set(key, left); saveRow(s, key, { ...s.rows.get(key)!, dirty: true }) } else s.waiting.delete(key)
  s.failed = null
}

/** An older key's layer here, written again with no placements (§5.7), under that key and its old reach event. */
async function emptyOld(s: Session, row: ShareRow, base: ChunkBase, createdAt: number): Promise<void> {
  const old = deviceKeys(s.owner).find((r) => r.pub === row.builder)
  const prev = row.plaintext ? parsePlaintext(row.plaintext) : null
  const planes = (prev?.planes ?? []).map((p) => p.plane).filter((p) => row.reach[String(p)])
  if (!old || !prev || planes.length === 0) return
  const plaintext: LayerPlaintext = {
    settles: [prev.settles[0]],
    builders: [],
    planes: planes.map((plane) => ({ plane, survey: true, ground: 2, form: 'diff' as const, pal: [null], cells: [0, -(CELLS - 1)], t0: [], t1: [] })),
  }
  const ev = await signLayer({ plaintext, author: s.owner, base, reach: planes.map((p) => row.reach[String(p)]), sec: old.sec, createdAt })
  if (current().live()) await current().publish(ev).catch(() => undefined)
}

// ---------------------------------------------------------------------------------------------------------------
// Reading.

/** The chunks within REACH of a place, in its plane (at most two per axis). */
export function chunksInReach(at: Position, plane: number): ChunkBase[] {
  const c = chunkOf(at.x, at.y, at.z, plane)
  const out: ChunkBase[] = []
  for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) for (const dx of [-1, 0, 1]) {
    const b = { x: c.x + 32n * BigInt(dx), y: c.y + 32n * BigInt(dy), z: c.z + 32n * BigInt(dz), plane }
    if (b.x < 0n || b.y < 0n || b.z < 0n) continue
    if (reachDistance({ ...at, plane }, b) <= REACH) out.push(b)
  }
  return out
}

/** The home chunk of a pubkey: the chunk holding its spawn coordinate, in the plane its lowest bit names (§7.3). */
export function homeChunkKey(pubkey: string): string {
  const { x, y, z, plane } = coordToXyz(BigInt(`0x${pubkey}`))
  return chunkKey(chunkOf(x, y, z, plane))
}

async function chainOf(author: string, need: readonly string[]): Promise<ReadChain> {
  const have = chains.get(author)
  if (have && need.every((id) => have.byId.has(id))) return have
  const events = await current().authorEvents(author)
  const c = readChainOf(author, events, current().v1List())
  chains.set(author, c)
  while (chains.size > 200) chains.delete(chains.keys().next().value as string)
  return c
}

let reading: Promise<void> | null = null
/** At most one read of the chunks in reach this often while you travel (a hop at a far zoom crosses chunks every step). */
export const READ_GAP_MS = 2_000
let lastRead = 0
let trailing: ReturnType<typeof setTimeout> | null = null
let readAgain = false

/** Read the layers of the chunks within reach of where you stand. `force` reads again even when the chunks are the same. */
export function readNear(force = false): Promise<void> {
  const s = sessionFor()
  if (!s || !host) return Promise.resolve()
  const bases = chunksInReach(host.head(), s.plane)
  const rk = bases.map(chunkKey).sort().join(';')
  if (!force && rk === s.readKey) return reading ?? Promise.resolve()
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

/** Read and merge the layers of these chunks (exported for tests). */
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
  for (const [lookupId, base] of byLookup) await mergeChunk(s, base, lookupId)
}

async function mergeChunk(s: Session, base: ChunkBase, lookupId: string): Promise<void> {
  const d = current()
  const key = chunkKey(base)
  const mine = new Set(deviceKeys(s.owner).map((k) => k.pub))
  const list = [...(s.seen.get(lookupId)?.values() ?? [])].filter((ev) => !mine.has(ev.pubkey))
  const { key: rkey } = chunkRegionKey(base)
  const counted: CountedLayer[] = []
  const muted = d.muted()
  for (const ev of list) {
    const shape = layerShape(ev)
    if (!shape || muted.has(shape.author)) continue
    const r = await readLayer(ev, {
      verify: d.verify,
      key: rkey,
      lookupId,
      chunk: base,
      ground: (plane) => groundOf({ ...base, plane }),
      reach: async (author, builder, ids) => reachPlaces(await chainOf(author, ids), builder, ids),
      header: d.header,
    }).catch(() => null)
    if (!r || r.status !== 'counted') continue
    const c = chains.get(shape.author)
    counted.push({ ...r.layer, retiredKey: c ? retiredAnywhere(c, ev.pubkey) : false })
  }
  if (s.closed) return
  const before = s.others.get(key)
  if (counted.length === 0) {
    if (before) { s.others.delete(key); host?.redisplay(key) }
    return
  }
  const me = d.me()
  const follows = new Set(await d.follows(me).catch(() => [] as string[]))
  const authors = counted.map((l) => l.author)
  const home = [...authors, me].find((a) => homeChunkKey(a) === key) ?? null
  const earliest = (a: string): { height: number; witness: number | null; work: number; author: string; builder: string } => {
    let best = { height: Infinity, witness: null as number | null, work: 0, author: a, builder: '' }
    for (const l of counted) if (l.author === a) for (const t of l.times) if (t.height < best.height) best = { ...t, author: a, builder: l.builder }
    return best
  }
  const keep = countedAuthors(authors, { me, follows, muted, home, earliest })
  const layers = counted.filter((l) => keep.has(l.author))
  const r = resolvePlane(layers, s.plane as 0 | 1, home)
  const view: OthersView = { values: r.values, surveyed: r.surveyed, authors: [...keep] }
  if (before && sameView(before, view)) return
  s.others.set(key, view)
  host?.redisplay(key)
}

function sameView(a: OthersView, b: OthersView): boolean {
  if (a.surveyed !== b.surveyed || a.values.length !== b.values.length) return false
  for (let i = 0; i < a.values.length; i++) if (a.values[i] !== b.values[i]) return false
  return true
}

/** The block a settle can commit to now (§5.3): SETTLE_DEPTH below the tip, re-exported for the live deps. */
export const COMMIT_DEPTH = SETTLE_DEPTH
