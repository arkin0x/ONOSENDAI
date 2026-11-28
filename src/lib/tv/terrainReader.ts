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
 *   reader can: the h5 region of a public coordinate), into a cache of TV's
 *   own (tvRegionKey). Never the keyring: nothing here holds a key where
 *   RESCAN ALL or the Secrets list would find it (review of #390).
 * - A layer published while its author's chain was in a no-broadcast
 *   stretch (spec §8.13: the tutorial) is skipped: the author's newest
 *   movement action at or before the layer's publish carries the tag. Layers
 *   are signed by builder keys and never carry the tag themselves (one that
 *   does is skipped too). A read that cannot tell leaves the layer out and
 *   the chunk is read again later: TV never shows what may be a tutorial's.
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
 * deps, which cache it; the stacked blocks are cached here by what went into
 * them (ChunkAsOf `signature`).
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

/** Lookup ids asked for in one question: the relay sends at most 500 events a filter. */
export const TV_READ_BATCH = 25
/** A chunk whose read failed, or left a layer undecided, is read again after this long (ms). */
export const TV_READ_AGAIN_MS = 20_000
/** Chunks kept read, the least lately used let go first. */
export const TV_CHUNKS_KEPT = 1024
/**
 * Layers kept across those chunks: a decoded plane is 128 KB (a value per
 * cell), and the stream runs all day, so past this many the least lately
 * used chunks go too (about 48 MB at most).
 */
export const TV_LAYERS_KEPT = 384
/** Stacked chunks kept (32 KB each). */
export const TV_BLOCKS_KEPT = 160
/** Grounds kept (32 KB each). */
export const TV_GROUNDS_KEPT = 160
/** How long a builder key's status is trusted (ms); an unknown one is asked again sooner. */
export const TV_STATUS_FRESH_MS = 10 * 60_000
export const TV_UNKNOWN_FRESH_MS = 30_000

// ---------------------------------------------------------------------------------------------------------------
// TV's own region keys: never the keyring.

/** Region keys kept: one a chunk, 32 bytes and a lookup id. */
export const TV_KEYS_KEPT = 512
const tvKeys = new Map<string, { key: Uint8Array; lookupId: string }>()

/**
 * A chunk's h5 region key and lookup id (DECK-0009 §2.2, the same for both
 * planes), derived from its corner and kept in TV's own cache. Nothing else
 * reads this cache, and nothing here writes to the keyring (lib/secrets).
 */
export function tvRegionKey(base: Pick<ChunkBase, 'x' | 'y' | 'z'>): { key: Uint8Array; lookupId: string } {
  const k = `${base.x.toString(16)}:${base.y.toString(16)}:${base.z.toString(16)}`
  let v = tvKeys.get(k)
  if (!v) {
    const rk = regionKeyAt({ x: base.x, y: base.y, z: base.z }, 5, 5)
    v = { key: rk.key, lookupId: rk.lookupId }
    tvKeys.set(k, v)
    while (tvKeys.size > TV_KEYS_KEPT) tvKeys.delete(tvKeys.keys().next().value as string)
  }
  return v
}

/** How many region keys TV holds now (tests). */
export function tvRegionKeysHeld(): number {
  return tvKeys.size
}

/** Let TV's region keys go: TV ended. */
export function forgetTvRegionKeys(): void {
  tvKeys.clear()
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
  /** When read (ms), and whether something was left undecided (read again after TV_READ_AGAIN_MS). */
  at: number
  partial: boolean
}

const xyzKey = (b: Pick<ChunkBase, 'x' | 'y' | 'z'>): string => `${b.x.toString(16)}:${b.y.toString(16)}:${b.z.toString(16)}`

/**
 * One reader a TV run. `prepare` reads chunks (each once, kept); `asOf` and
 * `blocksAsOf` answer from what was read.
 */
export class TvTerrainReader {
  /** Bumped whenever a chunk read lands: what was worked out from the reads may have changed. */
  version = 0
  private chunks = new Map<string, ChunkRead>()
  /** Layers held across `chunks`. */
  private layersHeld = 0
  private failedAt = new Map<string, number>()
  private inFlight = new Map<string, Promise<void>>()
  private statuses = new Map<string, { s: KeyStatus; at: number }>()
  /** Layers by event id: shown (true) or in a no-broadcast stretch (false). */
  private broadcastable = new Map<string, boolean>()
  private blocks = new Map<string, Promise<Uint8Array | null>>()
  /** Grounds asked for, by chunk and revision: each made once (in the blocks worker) and kept. */
  private grounds = new Map<string, Promise<Uint8Array>>()

  constructor(private deps: TvTerrainDeps) {}

  /** Whether a chunk (either plane) has been read. */
  has(base: Pick<ChunkBase, 'x' | 'y' | 'z'>): boolean {
    return this.chunks.has(xyzKey(base))
  }

  /** Read the chunks not read yet (or due a read again); resolves once all of them have been tried. Never throws. */
  async prepare(bases: readonly ChunkBase[]): Promise<void> {
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
        const at = this.deps.now()
        for (const b of batch) this.failedAt.set(xyzKey(b), at)
      }).finally(() => { for (const b of batch) this.inFlight.delete(xyzKey(b)) })
      for (const b of batch) this.inFlight.set(xyzKey(b), job)
      waits.push(job)
    }
    await Promise.all(waits)
  }

  private async readBatch(bases: ChunkBase[]): Promise<void> {
    const byLookup = new Map<string, ChunkBase>()
    for (const b of bases) byLookup.set(tvRegionKey(b).lookupId, b)
    const events = await this.deps.query({ kinds: [LAYER_KIND], '#d': [...byLookup.keys()] })
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
    for (const [lookupId, base] of byLookup) {
      const { layers, partial } = await this.stackChunk(base, lookupId, [...(seen.get(lookupId)?.values() ?? [])])
      const k = xyzKey(base)
      this.layersHeld -= this.chunks.get(k)?.layers.length ?? 0
      this.chunks.delete(k)
      this.chunks.set(k, { layers, at: this.deps.now(), partial })
      this.layersHeld += layers.length
      this.failedAt.delete(k)
      while (this.chunks.size > 1 && (this.chunks.size > TV_CHUNKS_KEPT || this.layersHeld > TV_LAYERS_KEPT)) {
        const old = this.chunks.keys().next().value as string
        this.layersHeld -= this.chunks.get(old)!.layers.length
        this.chunks.delete(old)
      }
    }
    this.version++
  }

  /** A chunk's layers that count by §6, in no-broadcast stretches left out. */
  private async stackChunk(base: ChunkBase, lookupId: string, events: NostrEvent[]): Promise<{ layers: StackLayer[]; partial: boolean }> {
    const d = this.deps
    let partial = false
    // The cheap checks of §6 first (authentic, tags, limits), before any lookup: a flood of forged layers costs none.
    const list = events.filter((ev) => d.verify(ev) && serializedBytes(ev) <= LAYER_MAX_BYTES && freeTextWithinBounds(ev))
    const shown: NostrEvent[] = []
    for (const ev of list) {
      const ok = await this.shownOnTv(ev, layerShape(ev)!.author)
      if (ok === null) partial = true
      if (ok === true) shown.push(ev)
    }
    const byAuthor = new Map<string, string[]>()
    for (const ev of shown) { const a = layerShape(ev)!.author; byAuthor.set(a, [...(byAuthor.get(a) ?? []), ev.pubkey]) }
    const status = new Map<string, KeyStatus>()
    for (const [author, ks] of byAuthor) for (const [k, st] of await this.statusesOf(author, ks)) status.set(`${author}|${k}`, st)
    const { key } = tvRegionKey(base)
    const layers: StackLayer[] = []
    for (const ev of shown) {
      const r = await readLayer(ev, {
        verify: d.verify, key, lookupId,
        ground: (plane, rev) => this.groundOf({ ...base, plane }, rev),
        keyStatus: async (author, builder) => status.get(`${author}|${builder}`) ?? 'unknown',
      }).catch(() => null)
      if (r === null || r.status === 'pending') partial = true
      else if (r.status === 'counted') layers.push(r.layer)
    }
    return { layers, partial }
  }

  /**
   * Whether a layer may be shown on TV: not tagged no-broadcast, and its
   * author's newest movement action at or before its publish not tagged
   * either (spec §8.13: published during the tutorial). Null when the relay
   * could not say.
   */
  private async shownOnTv(ev: NostrEvent, author: string): Promise<boolean | null> {
    if (noBroadcast(ev)) return false
    const had = this.broadcastable.get(ev.id)
    if (had !== undefined) return had
    let moves: NostrEvent[]
    try { moves = await this.deps.query({ kinds: [ACTION_KIND], authors: [author], until: ev.created_at, limit: 3 }) } catch { return null }
    const own = moves.filter((m) => m.kind === ACTION_KIND && m.pubkey === author && m.created_at <= ev.created_at && this.deps.verify(m))
    const newest = own.reduce((n, m) => Math.max(n, m.created_at), -Infinity)
    // Any of the newest second tagged: hidden (two actions signed in one second, either order).
    const ok = !own.some((m) => m.created_at === newest && noBroadcast(m))
    this.broadcastable.set(ev.id, ok)
    while (this.broadcastable.size > 4096) this.broadcastable.delete(this.broadcastable.keys().next().value as string)
    return ok
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
      let got: Map<string, KeyStatus>
      try { got = await this.deps.keyStatus(author, ask) } catch { got = new Map() }
      for (const k of ask) {
        const st = got.get(k) ?? 'unknown'
        out.set(k, st)
        this.statuses.set(`${author}|${k}`, { s: st, at: now })
      }
      while (this.statuses.size > 2000) this.statuses.delete(this.statuses.keys().next().value as string)
    }
    return out
  }

  /** What a chunk shows at tape time `t` (seconds), or null while it is not read. */
  asOf(base: ChunkBase, t: number): ChunkAsOf | null {
    const xk = xyzKey(base)
    const read = this.chunks.get(xk)
    if (!read) return null
    // Lately used: the last to be let go.
    this.chunks.delete(xk)
    this.chunks.set(xk, read)
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
   * Cached by signature.
   */
  blocksAsOf(base: ChunkBase, t: number): Promise<Uint8Array | null> {
    const a = this.asOf(base, t)
    if (!a || (!a.surveyed && !a.cells)) return Promise.resolve(null)
    let p = this.blocks.get(a.signature)
    if (!p) {
      const made = this.compose(a)
      p = made
      this.blocks.set(a.signature, made)
      made.catch(() => { if (this.blocks.get(a.signature) === made) this.blocks.delete(a.signature) })
      while (this.blocks.size > TV_BLOCKS_KEPT) this.blocks.delete(this.blocks.keys().next().value as string)
    }
    return p
  }

  /** A chunk's ground at a revision, made once and kept (TV_GROUNDS_KEPT); a failed one is asked again next time. */
  private groundOf(base: ChunkBase, revision: GroundRevision): Promise<Uint8Array> {
    const k = `${chunkKey(base)}|${revision}`
    let g = this.grounds.get(k)
    if (!g) {
      const made = this.deps.ground(base, revision)
      g = made
      this.grounds.set(k, made)
      made.catch(() => { if (this.grounds.get(k) === made) this.grounds.delete(k) })
      while (this.grounds.size > TV_GROUNDS_KEPT) this.grounds.delete(this.grounds.keys().next().value as string)
    }
    return g
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
