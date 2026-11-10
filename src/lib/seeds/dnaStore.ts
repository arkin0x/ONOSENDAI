/**
 * dnaStore.ts - a seed's DNA, by id: checked, cached, fetched once.
 *
 * A seed names its DNA (kind 3350) by event id (DECK-0008 §8.2). A reader
 * looks among the items of the bag that holds the seed first (noteDna, from
 * lib/hidden.ts), then on relays. Every DNA is checked before it is used
 * (checkDna): its id is its hash, its signature verifies, its text is valid
 * SEEDO and its caps tag is well formed. A mixed DNA (empty content, a mix
 * commit) is recognised and not grown yet.
 *
 * Cached in memory, and in IndexedDB for DNAs that came from relays (public
 * events: a DNA hidden in a bag is plaintext of that bag, and stays in
 * memory only). A DNA asked for and not found is asked for again after a
 * while, never on every frame. Ids asked for together go out in one query.
 */

import { capsFromTags, capsPrice, eventId, tryParseDna, type Caps } from 'sno-core/seeds'
import type { NostrEvent } from '../events'
import { verifyOnce } from '../verifiedSigs'
import { openDatabase, request } from '../idb'
import { DNA_KIND } from './seedItem'

/** What this client knows of a DNA. */
export type DnaVerdict =
  | { state: 'ok'; id: string; author: string; text: string; name: string; species: string; caps: Caps; price: number; event: NostrEvent }
  /** A mixed DNA: a mix commit (§6). Recognised, not computed yet. */
  | { state: 'mixed'; id: string; author: string; event: NostrEvent }
  /** Found and refused: why, in the engine's words. */
  | { state: 'invalid'; id: string; error: string }
  /** Asked for and not found on any relay. */
  | { state: 'missing'; id: string }
  | { state: 'fetching'; id: string }

const HEX64 = /^[0-9a-f]{64}$/

/**
 * Check an event as the DNA `id` names (§8.1). Pure apart from the
 * signature check, which is passed in for tests.
 */
export function checkDna(ev: NostrEvent, id: string, verify: (ev: NostrEvent) => boolean = verifyOnce): DnaVerdict {
  if (!ev || ev.kind !== DNA_KIND || ev.id !== id || typeof ev.content !== 'string' || !Array.isArray(ev.tags)) return { state: 'invalid', id, error: 'Not that DNA.' }
  let hashed: string
  try { hashed = eventId(ev) } catch { return { state: 'invalid', id, error: 'Its id is not its hash.' } }
  if (hashed !== id) return { state: 'invalid', id, error: 'Its id is not its hash.' }
  let signed = false
  try { signed = verify(ev) } catch { signed = false }
  if (!signed) return { state: 'invalid', id, error: 'Its signature does not verify.' }
  if (ev.content === '') return { state: 'mixed', id, author: ev.pubkey, event: ev }
  const caps = capsFromTags(ev.tags)
  if (!caps) return { state: 'invalid', id, error: 'Its size limit is malformed.' }
  const price = capsPrice(caps)
  if (price === null) return { state: 'invalid', id, error: 'Its size limit is out of range.' }
  const parsed = tryParseDna(ev.content)
  if (!parsed.ok) return { state: 'invalid', id, error: parsed.error }
  return { state: 'ok', id, author: ev.pubkey, text: ev.content, name: parsed.dna.name, species: parsed.dna.species, caps, price, event: ev }
}

/** Where DNAs come from: relays and a persistent cache. Replaced in tests. */
export interface DnaSources {
  /** The events with these ids, from the reader's relays. */
  fetch: (ids: string[]) => Promise<NostrEvent[]>
  load: (id: string) => Promise<NostrEvent | undefined>
  save: (ev: NostrEvent) => Promise<void>
}

/**
 * How long a DNA nobody had is left before it is asked for again: 15 s, then
 * twice as long each time, up to two minutes. A first miss is often a relay
 * not signed in yet, or one taken for hung.
 */
export const MISSING_RETRY_MS = 15_000
export const MISSING_RETRY_MAX_MS = 2 * 60_000
/** How long ids wait to be asked for together. */
export const BATCH_MS = 60

const DB_NAME = 'onosendai-seeds'
const DNA_STORE = 'dna'
let dbOpen: Promise<IDBDatabase | null> | null = null
function db(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  dbOpen ??= openDatabase(DB_NAME, 1, [[DNA_STORE, 'id']]).catch(() => null)
  return dbOpen
}

/** IndexedDB, for the DNAs relays gave. Best effort: a failed read is a miss, a failed write is nothing. */
export const idbDnaCache: Pick<DnaSources, 'load' | 'save'> = {
  load: async (id) => {
    const d = await db()
    if (!d) return undefined
    try { return (await request(d.transaction(DNA_STORE, 'readonly').objectStore(DNA_STORE).get(id))) as NostrEvent | undefined } catch { return undefined }
  },
  save: async (ev) => {
    const d = await db()
    if (!d) return
    try { await request(d.transaction(DNA_STORE, 'readwrite').objectStore(DNA_STORE).put(ev)) } catch { /* best effort */ }
  },
}

/** A DNA resolver: one per page in the app (dnaResolver), one per test. */
export class DnaResolver {
  private verdicts = new Map<string, DnaVerdict>()
  /** DNAs this page holds without fetching: from a bag, or signed here. Never persisted. */
  private local = new Map<string, NostrEvent>()
  private missingAt = new Map<string, number>()
  /** Misses in a row, by id: each waits twice as long as the one before. */
  private misses = new Map<string, number>()
  private inflight = new Map<string, Promise<DnaVerdict>>()
  private queue = new Map<string, Array<(ev: NostrEvent | undefined) => void>>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<() => void>()
  /** Rises whenever a verdict changes. */
  version = 0

  constructor(private sources: DnaSources, private now: () => number = () => Date.now(), private verify: (ev: NostrEvent) => boolean = verifyOnce) {}

  /** What is known now, without asking anyone. */
  verdict(id: string): DnaVerdict | undefined {
    return this.verdicts.get(id)
  }

  /**
   * A DNA this page holds without fetching it: an item of a bag (§8.2: the
   * bag that holds the seed is looked in first), or one signed here. A DNA
   * already resolved is left as it is.
   */
  note(ev: NostrEvent): void {
    if (!ev || ev.kind !== DNA_KIND || typeof ev.id !== 'string' || !HEX64.test(ev.id)) return
    this.local.set(ev.id, ev)
    const was = this.verdicts.get(ev.id)
    if (was && was.state !== 'missing' && was.state !== 'fetching') return
    const v = checkDna(ev, ev.id, this.verify)
    if (v.state === 'ok' || v.state === 'mixed') { this.set(v); this.missingAt.delete(ev.id); this.misses.delete(ev.id) }
  }

  /** Resolve a DNA: memory, then the bag's or this page's own, then IndexedDB, then relays. */
  resolve(id: string): Promise<DnaVerdict> {
    if (!HEX64.test(id)) return Promise.resolve({ state: 'invalid', id, error: 'Not a DNA id.' })
    const known = this.verdicts.get(id)
    if (known && known.state !== 'missing' && known.state !== 'fetching') return Promise.resolve(known)
    const at = this.missingAt.get(id)
    if (known?.state === 'missing' && at !== undefined && this.now() - at < this.retryAfter(id)) return Promise.resolve(known)
    const running = this.inflight.get(id)
    if (running) return running
    const job = this.run(id).finally(() => { this.inflight.delete(id) })
    this.inflight.set(id, job)
    return job
  }

  /** How long after its last miss a DNA is asked for again. */
  retryAfter(id: string): number {
    const n = Math.max(1, this.misses.get(id) ?? 1)
    return Math.min(MISSING_RETRY_MAX_MS, MISSING_RETRY_MS * 2 ** (n - 1))
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private async run(id: string): Promise<DnaVerdict> {
    if (!this.verdicts.has(id)) this.set({ state: 'fetching', id })
    const local = this.local.get(id)
    if (local) return this.settle(id, checkDna(local, id, this.verify), false)
    const cached = await this.sources.load(id).catch(() => undefined)
    if (cached) {
      const v = checkDna(cached, id, this.verify)
      if (v.state === 'ok' || v.state === 'mixed') return this.settle(id, v, false)
    }
    const fetched = await this.ask(id)
    if (!fetched) {
      this.missingAt.set(id, this.now())
      this.misses.set(id, (this.misses.get(id) ?? 0) + 1)
      return this.settle(id, { state: 'missing', id }, false)
    }
    return this.settle(id, checkDna(fetched, id, this.verify), true)
  }

  private settle(id: string, v: DnaVerdict, fromRelays: boolean): DnaVerdict {
    // A DNA a bag gave while this was out wins over a miss.
    const local = this.local.get(id)
    if (v.state === 'missing' && local) v = checkDna(local, id, this.verify)
    this.set(v)
    if (fromRelays && (v.state === 'ok' || v.state === 'mixed')) void this.sources.save(v.event).catch(() => undefined)
    return v
  }

  private set(v: DnaVerdict): void {
    const was = this.verdicts.get(v.id)
    if (was && was.state === v.state && (was.state !== 'invalid' || (v as { error: string }).error === was.error)) return
    this.verdicts.set(v.id, v)
    this.version++
    for (const l of this.listeners) l()
  }

  /** One id, asked for with any others asked within BATCH_MS. */
  private ask(id: string): Promise<NostrEvent | undefined> {
    return new Promise((resolve) => {
      const waiting = this.queue.get(id) ?? []
      waiting.push(resolve)
      this.queue.set(id, waiting)
      this.timer ??= setTimeout(() => { void this.flush() }, BATCH_MS)
    })
  }

  private async flush(): Promise<void> {
    this.timer = null
    const batch = new Map(this.queue)
    this.queue.clear()
    let events: NostrEvent[] = []
    try { events = await this.sources.fetch([...batch.keys()]) } catch { events = [] }
    for (const [id, waiters] of batch) {
      // The first event that is this DNA; anything else a relay sent is ignored.
      const ev = events.find((e) => e && e.id === id && e.kind === DNA_KIND)
      for (const w of waiters) w(ev)
    }
  }
}
