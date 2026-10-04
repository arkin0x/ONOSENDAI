/**
 * rescan.ts: RESCAN ALL, and SCAN on one place.
 *
 * The automatic scan asks about the thirteen cubes you stand in, once, as you
 * arrive. Something hidden in one of them after you left is never seen unless
 * you stand there again. RESCAN ALL asks the relays about every key this
 * device keeps, the held keys and every place's cube keys, in one pass:
 *
 * - Each lookup id once. A key that is held and is also a place key is asked
 *   about as the held one; place keys are stored once already.
 * - RESCAN_BATCH lookup ids to a request, a few requests at a time, read from
 *   storage a batch at a time, so a device with a hundred thousand places
 *   never has all their keys in memory at once.
 * - An answer that comes back full may have been cut off: a relay caps how
 *   many events one filter returns (strfry's default is 500). A batch whose
 *   answer reaches CAP_SUSPECT is split in half and each half asked again,
 *   down to a single lookup id, and a single id that still fills an answer is
 *   paged backwards in time with `until`.
 * - Every answer is opened with the key whose lookup id it is filed under,
 *   and filed as the automatic scan files it: the reveal for a first find,
 *   and a place key that opened something becomes a held key ('scan'), as it
 *   would have if the scan had found it while you stood there.
 */

import type { NostrEvent } from 'nostr-tools'
import { HIDDEN_KIND, unbag, type Hidden, type RegionOrigin } from '../hidden'
import { hexToBytes } from '../events'
import { query } from '../relay'
import { resolveReference } from '../references'
import { useCeremony } from '../../store/useCeremony'
import { useSecrets, type HeldKey, type RescanStatus } from '../../store/useSecrets'
import { useShards } from '../../store/useShards'
import type { Place, PlaceKey } from './places'
import { placeById, placeKeyPages, placeKeysOf } from './vault'

/** Lookup ids per request. */
export const RESCAN_BATCH = 150
/** Requests in flight at once: enough to overlap the waits, few enough not to crowd a relay's subscription limit. */
export const RESCAN_PARALLEL = 3
/** An answer this long may be a relay's cap rather than everything there is. */
export const CAP_SUSPECT = 400
/** How far back one lookup id is paged before giving up on it. */
const MAX_PAGES = 50

/** One key to ask about, and how to read what comes back. */
export interface RescanEntry {
  lookupId: string
  keyHex: string
  /** The cube's height, so a bag without `h` (spec §8.6) reads at its true size; undefined for a hop's box. */
  height?: number
  /** Where a reference with no point of its own is drawn: the region's corner, as the automatic scan draws it. */
  origin?: RegionOrigin
  /** For a place key not held: the held key it becomes when it opens something. */
  promote?: HeldKey
}

function originOf(base: { x: string; y: string; z: string }, plane: HeldKey['plane']): RegionOrigin {
  return { at: { x: BigInt(base.x), y: BigInt(base.y), z: BigInt(base.z) }, plane }
}

/** A held key as an entry. A box (one height per axis) is not a cube and carries no height or origin. */
export function heldEntry(k: HeldKey): RescanEntry {
  const cube = !k.heights || (k.heights.x === k.heights.y && k.heights.y === k.heights.z)
  return cube
    ? { lookupId: k.lookupId, keyHex: k.keyHex, height: k.height, origin: originOf(k.base, k.plane) }
    : { lookupId: k.lookupId, keyHex: k.keyHex }
}

/** A place key as an entry, in the plane it was last stood in. */
export function placeKeyEntry(k: PlaceKey, now: number): RescanEntry {
  return {
    lookupId: k.lookupId,
    keyHex: k.keyHex,
    height: k.height,
    origin: originOf(k.base, k.plane),
    promote: { lookupId: k.lookupId, keyHex: k.keyHex, height: k.height, base: k.base, plane: k.plane, source: 'scan', at: now },
  }
}

/**
 * Every key kept, in batches of `size`: the held keys first, so a key that is
 * both is read as the held one, then the place keys a page at a time.
 */
export async function* allBatches(
  keys: Record<string, HeldKey>,
  pages: AsyncIterable<PlaceKey[]>,
  size: number = RESCAN_BATCH,
  now: number = Math.floor(Date.now() / 1000),
): AsyncGenerator<RescanEntry[]> {
  // One buffer for both, so the held keys and the first place keys share a
  // full request rather than the held keys going out in a short one.
  const buf: RescanEntry[] = Object.values(keys).map(heldEntry)
  while (buf.length >= size) yield buf.splice(0, size)
  for await (const page of pages) {
    for (const k of page) if (!keys[k.lookupId]) buf.push(placeKeyEntry(k, now))
    while (buf.length >= size) yield buf.splice(0, size)
  }
  if (buf.length > 0) yield buf
}

/** One place's cube keys as entries; a key already held is read as the held one. */
export function placeEntries(place: Place, keys: Record<string, HeldKey>, placeKeys: PlaceKey[], now: number = Math.floor(Date.now() / 1000)): RescanEntry[] {
  const byId = new Map(placeKeys.map((k) => [k.lookupId, k]))
  const out: RescanEntry[] = []
  for (const id of new Set(place.keys)) {
    if (keys[id]) { out.push(heldEntry(keys[id])); continue }
    const k = byId.get(id)
    // In this place's plane: this is the place being asked about.
    if (k) out.push(placeKeyEntry({ ...k, plane: place.plane }, now))
  }
  return out
}

/** Ask the relays about some lookup ids, optionally only for events at or before `until`. */
export type Ask = (ids: string[], until?: number) => Promise<NostrEvent[]>

/**
 * Everything the relays have under these ids, however many: an answer that
 * may have been cut off at a relay's cap is asked again in halves, and a
 * single id that still fills one is paged back with `until`. A request that
 * fails counts as an empty answer. Each event once.
 */
export async function askAll(ids: string[], ask: Ask, cap: number = CAP_SUSPECT): Promise<NostrEvent[]> {
  const events = await ask(ids).catch(() => [] as NostrEvent[])
  if (events.length < cap) return events
  if (ids.length > 1) {
    const mid = Math.ceil(ids.length / 2)
    const halves = await Promise.all([askAll(ids.slice(0, mid), ask, cap), askAll(ids.slice(mid), ask, cap)])
    return unique([...halves[0], ...halves[1]])
  }
  const seen = new Map(events.map((e) => [e.id, e]))
  // `until` includes its own second, so nothing at the boundary is skipped;
  // a page that brings nothing new steps one second further back.
  let until = oldest(events)
  for (let page = 0; page < MAX_PAGES && until >= 0; page++) {
    const more = await ask(ids, until).catch(() => [] as NostrEvent[])
    let fresh = 0
    for (const e of more) if (!seen.has(e.id)) { seen.set(e.id, e); fresh++ }
    if (more.length < cap) break
    const next = oldest(more)
    until = fresh === 0 || next >= until ? Math.min(next, until) - 1 : next
  }
  return [...seen.values()]
}

function oldest(events: NostrEvent[]): number {
  let at = Infinity
  for (const e of events) at = Math.min(at, e.created_at)
  return at
}

function unique(events: NostrEvent[]): NostrEvent[] {
  return [...new Map(events.map((e) => [e.id, e])).values()]
}

export interface Asked {
  found: Hidden[]
  /** The entries whose key opened at least one item. */
  opened: RescanEntry[]
  /** Distinct lookup ids asked about, and batches sent. */
  asked: number
  batches: number
}

/**
 * Ask about every batch and open what comes back, RESCAN_PARALLEL batches at
 * a time. The relay and the decryption are passed in, so the batching is
 * testable without either.
 */
export async function askAndOpen(
  batches: AsyncIterable<RescanEntry[]>,
  ask: Ask,
  open: (ev: NostrEvent, entry: RescanEntry) => Promise<Hidden[]>,
  onBatch?: (done: number, asked: number) => void,
  parallel: number = RESCAN_PARALLEL,
): Promise<Asked> {
  const out: Asked = { found: [], opened: [], asked: 0, batches: 0 }
  const it = batches[Symbol.asyncIterator]()
  const worker = async (): Promise<void> => {
    for (;;) {
      const next = await it.next()
      if (next.done) return
      const byId = new Map<string, RescanEntry>()
      for (const e of next.value) if (!byId.has(e.lookupId)) byId.set(e.lookupId, e)
      out.asked += byId.size
      const events = await askAll([...byId.keys()], ask)
      const opened = new Set<string>()
      for (const ev of events) {
        const id = ev.tags.find((t) => t[0] === 'd')?.[1]
        const entry = id ? byId.get(id) : undefined
        if (!entry) continue
        const items = await open(ev, entry).catch(() => [] as Hidden[])
        if (items.length > 0 && !opened.has(entry.lookupId)) { opened.add(entry.lookupId); out.opened.push(entry) }
        out.found.push(...items)
      }
      out.batches++
      onBatch?.(out.batches, out.asked)
    }
  }
  await Promise.all(Array.from({ length: parallel }, worker))
  return out
}

const askRelays: Ask = (ids, until) => query({ kinds: [HIDDEN_KIND], '#d': ids, ...(until !== undefined ? { until } : {}) })

/** A held box key has no height of its own; your own deployment there may say it. */
const openEntry = (ev: NostrEvent, entry: RescanEntry): Promise<Hidden[]> => {
  const height = entry.height ?? useShards.getState().mine.find((d) => d.lookupId === entry.lookupId)?.height
  return unbag(ev, hexToBytes(entry.keyHex), resolveReference, entry.origin, height)
}

/**
 * Ask about these batches, file what opens, and hold the place keys that
 * opened something. Resolves to the counts the panel reports.
 */
export async function rescanBatches(batches: AsyncIterable<RescanEntry[]>, expected: number, onProgress?: (status: RescanStatus) => void): Promise<RescanStatus> {
  const status: RescanStatus = { running: true, done: 0, requests: Math.max(1, Math.ceil(expected / RESCAN_BATCH)), asked: 0, found: 0, fresh: 0, held: 0, error: null }
  onProgress?.({ ...status })
  // The SCANNING tag, as SCAN on one row lights it.
  useShards.getState().setScanning(true)
  const result = await askAndOpen(batches, askRelays, openEntry, (done, asked) => {
    onProgress?.({ ...status, done, asked, requests: Math.max(status.requests, done) })
  }).finally(() => useShards.getState().setScanning(false))
  // Asked before addDiscovered, which records these as seen.
  const shards = useShards.getState()
  const fresh = shards.freshOf(result.found)
  if (result.found.length > 0) shards.addDiscovered(result.found)
  if (fresh.length > 0) useCeremony.getState().mark(fresh)
  const secrets = useSecrets.getState()
  const promoted = result.opened.filter((e) => e.promote && !secrets.keys[e.lookupId]).map((e) => e.promote!)
  secrets.hold(promoted)
  return { ...status, running: false, done: result.batches, requests: result.batches, asked: result.asked, found: result.found.length, fresh: fresh.length, held: promoted.length }
}

let rescanning: Promise<RescanStatus> | null = null

/** RESCAN ALL: every held key and every place key. A second press while one runs joins it. */
export function rescanAll(): Promise<RescanStatus> {
  if (rescanning) return rescanning
  const { keys, storage, setRescan } = useSecrets.getState()
  const expected = Object.keys(keys).length + storage.placeKeys
  const run = rescanBatches(allBatches(keys, placeKeyPages(RESCAN_BATCH)), expected, setRescan).then(
    (status) => { setRescan(status); return status },
    (err: unknown) => {
      const error = err instanceof Error ? err.message : String(err)
      setRescan({ running: false, done: 0, requests: 0, asked: 0, found: 0, fresh: 0, held: 0, error })
      throw err
    },
  )
  rescanning = run
  const clear = (): void => { if (rescanning === run) rescanning = null }
  run.then(clear, clear)
  return run
}

/** SCAN on one place: its cube keys, asked about now. Resolves to how many items opened. */
export async function rescanPlace(id: string): Promise<number> {
  const place = await placeById(id)
  if (!place) return 0
  const keys = useSecrets.getState().keys
  const entries = placeEntries(place, keys, await placeKeysOf(place.keys.filter((k) => !keys[k])))
  async function* one(): AsyncGenerator<RescanEntry[]> { yield entries }
  const status = await rescanBatches(one(), entries.length)
  return status.found
}
