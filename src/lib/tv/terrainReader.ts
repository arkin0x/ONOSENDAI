/**
 * terrainReader.ts: Cyberspace TV's reader of TERRAIN's blocks, as of a
 * moment on the tape.
 *
 * Kept apart from the viewer's own TERRAIN session (store/terrainShare.ts):
 * TV reads the chunks round the avatar on screen, not round you, and as of
 * the tape's time, not now. What it reads:
 *
 * - The block layers (kind 33339, DECK-0009 §5) of each chunk asked for,
 *   from the canonical relay, read ahead of the shot as TV's bag scan is
 *   (store/useTvTerrain.ts asks for the chunk of every beat, then the 26
 *   round it and the ring beyond for the borders). Once read, a chunk is
 *   kept for the run: per-chunk caching.
 * - Each layer checked by §6 (lib/terrain/layerReader.ts): authentic, its
 *   tags and limits, a builder key valid for its author (§4.4, from the
 *   author's movement actions), it opens with the chunk's region key, and
 *   its plaintext well formed.
 * - The chunk's region key derived here from the chunk's own corner (any
 *   reader can: the h5 region of a public coordinate), into a cache of this
 *   reader's own (regionKey), dropped with the reader when TV ends. Never
 *   the keyring: nothing here holds a key where RESCAN ALL or the Secrets
 *   list would find it (review of #390). A reader that has ended (end())
 *   stops where it is: no further question to a relay, no key derived.
 * - A layer published while its author's chain was in a no-broadcast
 *   stretch (spec §8.13: the tutorial) is skipped: any of the author's
 *   movement actions fetched for it carries the tag, those in the
 *   NB_LOOKBACK_S before its publish (asked once per author for a batch of
 *   chunks), or failing any there, the newest few at or before it. Layers
 *   are signed by builder keys and never carry the tag themselves (one that
 *   does is skipped too). A read that cannot tell, or finds no action at all,
 *   leaves the layer out and the chunk is read again later: TV never shows
 *   what may be a tutorial's. The limit: a layer published long after a
 *   tutorial (past the look-back, with untagged actions between) shows,
 *   with whatever cells of the tutorial it still carries.
 *
 * As of tape time (asOf). A layer is replaceable, one per builder key per
 * chunk, so the relay keeps only each one's newest version: its changed
 * cells, when it was last published (created_at) and when its plane was
 * first surveyed (`surveyed`). So, at tape time t:
 *
 * - a layer published at or before t is that author's blocks exactly as they
 *   stood at t (it has not changed since), and counts whole;
 * - a layer published after t says nothing certain about its cells at t (an
 *   older version, now gone, may have stood then): its cells are left out,
 *   kept as `later` for the ghost and the burst a later change animates
 *   (owner, 2026-11-28: ghost unpublished edits until the burst), and only
 *   its surveys dated at or before t count, so the ground it surveyed shows;
 * - the Stack (§7, lib/terrain/blockLayer.ts resolveStack) is then the one
 *   every reader uses, from nobody's seat: no viewer rank and no follows, so
 *   TV shows everyone the same blocks (only a home owner ranks first inside
 *   their home). Muted authors are left out, as TV leaves their moves out.
 *
 * The ground (generateChunk, in the blocks worker) is asked through the
 * deps and cached here, as are the stacked blocks, by what went into them
 * (ChunkAsOf `signature`); what the drawn set needs is never let go (pin).
 *
 * Watching only: nothing here makes a signature, publishes or stores anything.
 */

import type { Filter } from 'nostr-tools/filter'
import { regionKeyAt } from '../shardCrypto'
import { noBroadcast } from '../noBroadcast'
import { ACTION_KIND, type NostrEvent } from '../events'
import { CELLS, chunkKey, type ChunkBase } from '../terrain/coords'
import {
  LAYER_KIND, LAYER_MAX_BYTES, baseRevision, countedLayers, freeTextWithinBounds, inHome, layerShape, resolveStack, serializedBytes, surveysOf,
  type StackLayer, type StackView,
} from '../terrain/blockLayer'
import { readLayer, type KeyStatus } from '../terrain/layerReader'
import type { GroundRevision } from '../terrain/groundRevision'

/** What the reader talks to: the canonical relay, the builder keys' status, the ground, and whom the viewer blocked. */
export interface TvTerrainDeps {
  /** Read from the canonical relay alone; throws when it could not be heard (never taken for "none"). */
  query: (filter: Filter) => Promise<NostrEvent[]>
  /** What an author's movement actions say of some of their builder keys (lib/terrain/builderStatus.ts). */
  keyStatus: (author: string, keys: string[]) => Promise<Map<string, KeyStatus>>
  /** A chunk's generated ground at a revision (the blocks worker's generateChunk). */
  ground: (base: ChunkBase, revision: GroundRevision) => Promise<Uint8Array>
  verify: (ev: NostrEvent) => boolean
  /** Authors left off TV (store/useMutes). */
  muted: () => ReadonlySet<string>
  /** Milliseconds. */
  now: () => number
}

/** Lookup ids asked for in one question. */
export const TV_READ_BATCH = 25
/** The relay sends at most this many events for one filter: an answer this long may be cut off, and is asked again in halves. */
export const TV_RELAY_CAP = 500
/** A chunk whose read failed, or left a layer undecided, is read again after this long (ms). */
export const TV_READ_AGAIN_MS = 20_000
/** Chunks kept read, the least lately used let go first (never one pinned: the drawn set and its neighbours). */
export const TV_CHUNKS_KEPT = 1024
/**
 * Bytes of decoded layers kept across those chunks: each decoded plane is
 * 128 KB of values (a value per cell) plus its list of changed cells (8
 * bytes each), and a layer may hold both planes, so a busy layer can be
 * 0.75 MB. The stream runs all day: past this, the least lately used
 * chunks go (never a pinned one).
 */
export const TV_LAYER_BYTES_KEPT = 64 * 1024 * 1024
/** Stacked chunks kept (32 KB each), and grounds (32 KB each). */
export const TV_BLOCKS_KEPT = 256
export const TV_GROUNDS_KEPT = 256
/** Failed reads remembered (for TV_READ_AGAIN_MS), and layers' no-broadcast verdicts kept. */
export const TV_FAILED_KEPT = 4096
export const TV_VERDICTS_KEPT = 4096
/** How long a builder key's status is trusted (ms); an unknown one is asked again sooner. */
export const TV_STATUS_FRESH_MS = 10 * 60_000
export const TV_UNKNOWN_FRESH_MS = 30_000
/** How far before a layer's publish its author's movement actions are looked through for the no-broadcast tag (s). */
export const NB_LOOKBACK_S = 15 * 60
/** Region keys kept by one reader: one a chunk, 32 bytes and a lookup id. */
export const TV_KEYS_KEPT = 512

/** The chunk's region key as anyone derives it from its corner (DECK-0009 §2.2, the same for both planes). No cache. */
export function chunkRegionKeyOf(base: Pick<ChunkBase, 'x' | 'y' | 'z'>): { key: Uint8Array; lookupId: string } {
  const rk = regionKeyAt({ x: base.x, y: base.y, z: base.z }, 5, 5)
  return { key: rk.key, lookupId: rk.lookupId }
}

// ---------------------------------------------------------------------------------------------------------------
// As of tape time.

/** The Stack as TV reads it (§7): nobody's seat, so the same for every viewer; a home owner first inside their home. */
export function tvStackView(base: ChunkBase): StackView {
  return { me: null, follows: new Set(), home: (author) => inHome(author, base) }
}

/**
 * A layer published after tape time `t`, as the Stack may count it at `t`:
 * its surveys of `plane` dated at or before `t`, and none of its cells (they
 * are not known as of `t`). Null when nothing of it counts then. Its date
 * and co-builders are left out too, so it never counts as its author's
 * newest list (§8) over a layer that counts whole.
 */
export function surveyOnly(l: StackLayer, plane: 0 | 1, t: number): StackLayer | null {
  const planes = l.planes.filter((p) => p.plane === plane && p.survey && p.surveyed <= t).map((p) => ({ ...p, changed: [] }))
  return planes.length ? { ...l, createdAt: -1, cobuilders: [], planes } : null
}

/**
 * Split a chunk's counted layers at tape time `t` (see the header): those
 * that count whole, those published later, and the list the Stack reads
 * (the first, plus the later ones' surveys up to `t`).
 */
export function layersAsOf(layers: readonly StackLayer[], plane: 0 | 1, t: number): { counted: StackLayer[]; later: StackLayer[]; stack: StackLayer[] } {
  const counted = layers.filter((l) => l.createdAt <= t)
  const later = layers.filter((l) => l.createdAt > t)
  const stack: StackLayer[] = [...counted]
  for (const l of later) { const s = surveyOnly(l, plane, t); if (s) stack.push(s) }
  return { counted, later, stack }
}

/** What a chunk shows as of a tape time. */
export interface ChunkAsOf {
  base: ChunkBase
  key: string
  /** The layers that count whole: published at or before tape time. */
  layers: StackLayer[]
  /** Layers published after tape time: their cells are a ghost until then (a later change draws it). */
  later: StackLayer[]
  /** The list the Stack reads. */
  stack: StackLayer[]
  /** A counted survey at or before tape time (§7.5): the ground shows. */
  surveyed: boolean
  baseRevision: GroundRevision | null
  /** Some counted layer changed a cell of this plane: drawn even where nothing surveys it. */
  cells: boolean
  /** What went into the blocks: the same signature, the same blocks (and mesh). */
  signature: string
}

interface ChunkRead {
  /** Every layer that counts by §6, at any time; mutes and tape time are applied as asked. */
  layers: StackLayer[]
  /** Their decoded size (TV_LAYER_BYTES_KEPT). */
  bytes: number
  /** When read (ms), and whether something was left undecided (read again after TV_READ_AGAIN_MS). */
  at: number
  partial: boolean
}

const xyzKey = (b: Pick<ChunkBase, 'x' | 'y' | 'z'>): string => `${b.x.toString(16)}:${b.y.toString(16)}:${b.z.toString(16)}`

/** The decoded size of some layers: each plane's values and its changed cells. */
export function layerBytes(layers: readonly StackLayer[]): number {
  let n = 0
  for (const l of layers) for (const p of l.planes) n += p.values.byteLength + 8 * p.changed.length
  return n
}

/** Thrown inside a reader that has ended: whatever it was doing stops there. */
class ReaderEnded extends Error {
  constructor() { super('TV terrain reader ended') }
}

/** Put a key last in a Map's order (lately used). */
function touch<K, V>(m: Map<K, V>, k: K, v: V): void {
  m.delete(k)
  m.set(k, v)
}

/** Let the oldest entries go past `cap`, never one `keep` says to keep. */
function trim<K, V>(m: Map<K, V>, cap: number, keep: (k: K, v: V) => boolean = () => false, gone: (v: V) => void = () => {}): void {
  if (m.size <= cap) return
  for (const [k, v] of m) {
    if (m.size <= cap) break
    if (keep(k, v)) continue
    m.delete(k)
    gone(v)
  }
}

/**
 * One reader a TV run. `prepare` reads chunks (each once, kept); `asOf` and
 * `blocksAsOf` answer from what was read. `end` drops it all, its region
 * keys too, and stops anything still under way.
 */
export class TvTerrainReader {
  /** Bumped whenever a chunk read lands: what was worked out from the reads may have changed. */
  version = 0
  private ended = false
  private keys = new Map<string, { key: Uint8Array; lookupId: string }>()
  private chunks = new Map<string, ChunkRead>()
  private bytesHeld = 0
  /** Chunks never let go (by xyz): the drawn set and what its meshes and light read. */
  private pinned = new Set<string>()
  private failedAt = new Map<string, number>()
  private inFlight = new Map<string, Promise<void>>()
  private statuses = new Map<string, { s: KeyStatus; at: number }>()
  /** Layers by event id: shown (true) or in a no-broadcast stretch (false). */
  private broadcastable = new Map<string, boolean>()
  private blocks = new Map<string, { xyz: string; p: Promise<Uint8Array | null> }>()
  /** Grounds asked for, by chunk and revision: each made once (in the blocks worker) and kept. */
  private grounds = new Map<string, { xyz: string; p: Promise<Uint8Array> }>()

  constructor(private deps: TvTerrainDeps) {}

  /** TV ended: everything let go, the region keys too; nothing more is asked of a relay. */
  end(): void {
    this.ended = true
    this.keys.clear()
    this.chunks.clear()
    this.bytesHeld = 0
    this.pinned.clear()
    this.failedAt.clear()
    this.inFlight.clear()
    this.statuses.clear()
    this.broadcastable.clear()
    this.blocks.clear()
    this.grounds.clear()
  }

  /** Whether end() was called. */
  get isEnded(): boolean {
    return this.ended
  }

  private alive(): void {
    if (this.ended) throw new ReaderEnded()
  }

  /** A chunk's region key, kept by this reader alone (never the keyring), until it ends. */
  regionKey(base: Pick<ChunkBase, 'x' | 'y' | 'z'>): { key: Uint8Array; lookupId: string } {
    this.alive()
    const k = xyzKey(base)
    let v = this.keys.get(k)
    if (!v) {
      v = chunkRegionKeyOf(base)
      this.keys.set(k, v)
      trim(this.keys, TV_KEYS_KEPT)
    }
    return v
  }

  /** How many region keys this reader holds (tests). */
  keysHeld(): number {
    return this.keys.size
  }

  /** The chunks never to let go while they are drawn (by corner; either plane). */
  pin(bases: Iterable<Pick<ChunkBase, 'x' | 'y' | 'z'>>): void {
    this.pinned = new Set([...bases].map(xyzKey))
  }

  /** A question to the relay, unless the reader ended (before or while it was out). */
  private async ask(f: Filter): Promise<NostrEvent[]> {
    this.alive()
    const got = await this.deps.query(f)
    this.alive()
    return got
  }

  /** Whether a chunk (either plane) has been read. */
  has(base: Pick<ChunkBase, 'x' | 'y' | 'z'>): boolean {
    return this.chunks.has(xyzKey(base))
  }

  /** Read the chunks not read yet (or due a read again); resolves once all of them have been tried. Never throws. */
  async prepare(bases: readonly ChunkBase[]): Promise<void> {
    if (this.ended) return
    const now = this.deps.now()
    const want = new Map<string, ChunkBase>()
    const waits: Promise<void>[] = []
    for (const b of bases) {
      const k = xyzKey(b)
      if (want.has(k)) continue
      const busy = this.inFlight.get(k)
      if (busy) { waits.push(busy); continue }
      const had = this.chunks.get(k)
      if (had && !(had.partial && now - had.at >= TV_READ_AGAIN_MS)) continue
      const failed = this.failedAt.get(k)
      if (failed !== undefined && now - failed < TV_READ_AGAIN_MS) continue
      want.set(k, b)
    }
    const list = [...want.values()]
    for (let i = 0; i < list.length; i += TV_READ_BATCH) {
      const batch = list.slice(i, i + TV_READ_BATCH)
      const job = this.readBatch(batch).catch(() => {
        if (this.ended) return
        const at = this.deps.now()
        for (const b of batch) touch(this.failedAt, xyzKey(b), at)
        trim(this.failedAt, TV_FAILED_KEPT)
      }).finally(() => { for (const b of batch) this.inFlight.delete(xyzKey(b)) })
      for (const b of batch) this.inFlight.set(xyzKey(b), job)
      waits.push(job)
    }
    await Promise.all(waits)
  }

  private async readBatch(bases: ChunkBase[]): Promise<void> {
    const byLookup = new Map<string, ChunkBase>()
    for (const b of bases) byLookup.set(this.regionKey(b).lookupId, b)
    const events = await this.ask({ kinds: [LAYER_KIND], '#d': [...byLookup.keys()] })
    // Possibly cut off at the relay's cap: asked again in halves, down to one chunk, which is then kept as partial.
    const cut = events.length >= TV_RELAY_CAP
    if (cut && bases.length > 1) {
      const half = Math.ceil(bases.length / 2)
      await this.readBatch(bases.slice(0, half))
      await this.readBatch(bases.slice(half))
      return
    }
    // The newest per builder key per chunk (the relay keeps one; another may send an older copy).
    const seen = new Map<string, Map<string, NostrEvent>>()
    for (const ev of events) {
      const shape = layerShape(ev)
      if (!shape || !byLookup.has(shape.lookupId)) continue
      const list = seen.get(shape.lookupId) ?? new Map<string, NostrEvent>()
      const was = list.get(ev.pubkey)
      if (!was || ev.created_at > was.created_at || (ev.created_at === was.created_at && ev.id < was.id)) list.set(ev.pubkey, ev)
      seen.set(shape.lookupId, list)
    }
    // The cheap checks of §6 first (authentic, tags, limits), before any lookup: a flood of forged layers costs none.
    const d = this.deps
    const cheap = new Map<string, NostrEvent[]>()
    for (const [lookupId, list] of seen) cheap.set(lookupId, [...list.values()].filter((ev) => d.verify(ev) && serializedBytes(ev) <= LAYER_MAX_BYTES && freeTextWithinBounds(ev)))
    // The no-broadcast verdicts of the whole batch, asked once per author.
    await this.judgeBroadcast([...cheap.values()].flat())
    for (const [lookupId, base] of byLookup) {
      const { layers, partial } = await this.stackChunk(base, lookupId, cheap.get(lookupId) ?? [])
      this.alive()
      const k = xyzKey(base)
      this.bytesHeld -= this.chunks.get(k)?.bytes ?? 0
      const bytes = layerBytes(layers)
      touch(this.chunks, k, { layers, bytes, at: d.now(), partial: partial || cut })
      this.bytesHeld += bytes
      this.failedAt.delete(k)
      this.evictChunks(k)
    }
    this.version++
  }

  /** Let the least lately used chunks go past the caps, never a pinned one or the one just read. */
  private evictChunks(justRead: string): void {
    for (const [k, c] of this.chunks) {
      if (this.chunks.size <= TV_CHUNKS_KEPT && this.bytesHeld <= TV_LAYER_BYTES_KEPT) break
      if (k === justRead || this.pinned.has(k)) continue
      this.chunks.delete(k)
      this.bytesHeld -= c.bytes
    }
  }

  /** A chunk's layers that count by §6, those in no-broadcast stretches left out (judgeBroadcast has judged them). */
  private async stackChunk(base: ChunkBase, lookupId: string, list: NostrEvent[]): Promise<{ layers: StackLayer[]; partial: boolean }> {
    const d = this.deps
    let partial = false
    const shown: NostrEvent[] = []
    for (const ev of list) {
      const ok = noBroadcast(ev) ? false : this.broadcastable.get(ev.id)
      if (ok === undefined) partial = true
      if (ok === true) shown.push(ev)
    }
    const byAuthor = new Map<string, string[]>()
    for (const ev of shown) { const a = layerShape(ev)!.author; byAuthor.set(a, [...(byAuthor.get(a) ?? []), ev.pubkey]) }
    const status = new Map<string, KeyStatus>()
    for (const [author, ks] of byAuthor) for (const [k, st] of await this.statusesOf(author, ks)) status.set(`${author}|${k}`, st)
    this.alive()
    const { key } = this.regionKey(base)
    const layers: StackLayer[] = []
    for (const ev of shown) {
      const r = await readLayer(ev, {
        verify: d.verify, key, lookupId,
        ground: (plane, rev) => this.groundOf({ ...base, plane }, rev),
        keyStatus: async (author, builder) => status.get(`${author}|${builder}`) ?? 'unknown',
      }).catch(() => null)
      this.alive()
      if (r === null || r.status === 'pending') partial = true
      else if (r.status === 'counted') layers.push(r.layer)
    }
    return { layers, partial }
  }

  /**
   * Judge whether layers may be shown on TV (spec §8.13: not published during
   * the tutorial), into `broadcastable`. Per author, one question for the
   * movement actions in the NB_LOOKBACK_S before each of their layers'
   * publishes; a layer is hidden when ANY action fetched for it carries the
   * tag. A layer with no action in its look-back (a long build held
   * still) is asked about on its own: the newest few at or before its publish.
   * No action at all, or no answer, leaves it undecided (left out, the chunk
   * read again later). An answer that may be cut off at the relay's cap is
   * not trusted for the look-back: each layer is asked about on its own.
   */
  private async judgeBroadcast(events: NostrEvent[]): Promise<void> {
    const byAuthor = new Map<string, NostrEvent[]>()
    for (const ev of events) {
      if (noBroadcast(ev) || this.broadcastable.has(ev.id)) continue
      const a = layerShape(ev)!.author
      byAuthor.set(a, [...(byAuthor.get(a) ?? []), ev])
    }
    const own = (author: string, moves: NostrEvent[]): NostrEvent[] => moves.filter((m) => m.kind === ACTION_KIND && m.pubkey === author && this.deps.verify(m))
    const decide = (ev: NostrEvent, fetched: NostrEvent[]): void => {
      if (fetched.length === 0) return
      touch(this.broadcastable, ev.id, !fetched.some(noBroadcast))
      trim(this.broadcastable, TV_VERDICTS_KEPT)
    }
    for (const [author, layers] of byAuthor) {
      const since = Math.min(...layers.map((l) => l.created_at)) - NB_LOOKBACK_S
      const until = Math.max(...layers.map((l) => l.created_at))
      let moves: NostrEvent[] | null
      try { moves = await this.ask({ kinds: [ACTION_KIND], authors: [author], since, until, limit: TV_RELAY_CAP }) } catch (e) {
        if (e instanceof ReaderEnded) throw e
        moves = null
      }
      const trusted = moves !== null && moves.length < TV_RELAY_CAP ? own(author, moves) : null
      for (const ev of layers) {
        const near = trusted?.filter((m) => m.created_at <= ev.created_at && m.created_at >= ev.created_at - NB_LOOKBACK_S) ?? []
        if (near.length) { decide(ev, near); continue }
        if (moves === null) continue
        let before: NostrEvent[]
        try { before = await this.ask({ kinds: [ACTION_KIND], authors: [author], until: ev.created_at, limit: 5 }) } catch (e) {
          if (e instanceof ReaderEnded) throw e
          continue
        }
        decide(ev, own(author, before).filter((m) => m.created_at <= ev.created_at))
      }
    }
  }

  /** Builder keys' status, kept a while per key; a read that fails knows nothing yet. */
  private async statusesOf(author: string, keys: string[]): Promise<Map<string, KeyStatus>> {
    const out = new Map<string, KeyStatus>()
    const now = this.deps.now()
    const ask: string[] = []
    for (const k of new Set(keys)) {
      const have = this.statuses.get(`${author}|${k}`)
      if (have && now - have.at < (have.s === 'unknown' ? TV_UNKNOWN_FRESH_MS : TV_STATUS_FRESH_MS)) out.set(k, have.s)
      else ask.push(k)
    }
    if (ask.length) {
      this.alive()
      let got: Map<string, KeyStatus>
      try { got = await this.deps.keyStatus(author, ask) } catch { got = new Map() }
      this.alive()
      for (const k of ask) {
        const st = got.get(k) ?? 'unknown'
        out.set(k, st)
        this.statuses.set(`${author}|${k}`, { s: st, at: now })
      }
      trim(this.statuses, 2000)
    }
    return out
  }

  /** What a chunk shows at tape time `t` (seconds), or null while it is not read. */
  asOf(base: ChunkBase, t: number): ChunkAsOf | null {
    const xk = xyzKey(base)
    const read = this.chunks.get(xk)
    if (!read) return null
    // Lately used: the last to be let go.
    touch(this.chunks, xk, read)
    const plane = base.plane as 0 | 1
    const view = tvStackView(base)
    // §7.1 against the real clock (a layer dated past it is not counted yet), mutes removed, at most 64 authors.
    const live = countedLayers(read.layers, view, this.deps.muted(), Math.floor(this.deps.now() / 1000))
    const { counted, later, stack } = layersAsOf(live, plane, t)
    const rev = baseRevision(surveysOf(stack, plane, view))
    const cells = counted.some((l) => l.planes.some((p) => p.plane === plane && p.changed.length > 0))
    const ids = (ls: StackLayer[]): string => ls.map((l) => l.id).sort().join(',')
    const key = chunkKey(base)
    const surveyedBy = stack.filter((l) => l.createdAt === -1)
    return { base, key, layers: counted, later, stack, surveyed: rev !== null, baseRevision: rev, cells, signature: `${key}|${rev ?? '-'}|${ids(counted)}|${ids(surveyedBy)}` }
  }

  /** Whether a chunk has a counted survey at or before `t`; null while it is not read. */
  surveyedAsOf(base: ChunkBase, t: number): boolean | null {
    const a = this.asOf(base, t)
    return a ? a.surveyed : null
  }

  /**
   * A chunk's blocks at tape time `t` by the Stack: the ground at the base
   * revision where it is surveyed, open space where not, each changed cell
   * its winner's. Null for a chunk not read yet, or with nothing in it then.
   * Cached by signature (never letting go a pinned chunk's).
   */
  blocksAsOf(base: ChunkBase, t: number): Promise<Uint8Array | null> {
    const a = this.asOf(base, t)
    if (!a || (!a.surveyed && !a.cells) || this.ended) return Promise.resolve(null)
    const had = this.blocks.get(a.signature)
    if (had) { touch(this.blocks, a.signature, had); return had.p }
    const made = this.compose(a)
    const entry = { xyz: xyzKey(base), p: made }
    this.blocks.set(a.signature, entry)
    made.catch(() => { if (this.blocks.get(a.signature) === entry) this.blocks.delete(a.signature) })
    trim(this.blocks, TV_BLOCKS_KEPT, (_k, v) => this.pinned.has(v.xyz))
    return made
  }

  /** A chunk's ground at a revision, made once and kept (TV_GROUNDS_KEPT, never a pinned chunk's); a failed one is asked again next time. */
  private groundOf(base: ChunkBase, revision: GroundRevision): Promise<Uint8Array> {
    if (this.ended) return Promise.reject(new ReaderEnded())
    const k = `${chunkKey(base)}|${revision}`
    const had = this.grounds.get(k)
    if (had) { touch(this.grounds, k, had); return had.p }
    const made = this.deps.ground(base, revision)
    const entry = { xyz: xyzKey(base), p: made }
    this.grounds.set(k, entry)
    made.catch(() => { if (this.grounds.get(k) === entry) this.grounds.delete(k) })
    trim(this.grounds, TV_GROUNDS_KEPT, (_k, v) => this.pinned.has(v.xyz))
    return made
  }

  private async compose(a: ChunkAsOf): Promise<Uint8Array> {
    const plane = a.base.plane as 0 | 1
    const r = resolveStack(a.stack, plane, tvStackView(a.base))
    const ground = a.baseRevision !== null ? await this.groundOf(a.base, a.baseRevision) : null
    const out = new Uint8Array(CELLS)
    for (let c = 0; c < CELLS; c++) {
      const v = r.values[c]
      out[c] = v >= 0 ? Math.min(v, 255) : ground ? ground[c] : 0
    }
    return out
  }
}
