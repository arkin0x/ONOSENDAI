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
 * - RESCAN_BATCH lookup ids to a request, read from storage a batch at a
 *   time, so a device with a hundred thousand places never has all their keys
 *   in memory at once. Every request the rescan sends, split halves and pages
 *   included, waits its turn behind one limiter of RESCAN_PARALLEL, so a run
 *   never has more than that many subscriptions open on a relay.
 * - Each relay's answer is judged on its own (review of #219, S3). A relay
 *   caps how many events one filter returns at a number of its own (strfry's
 *   default is 500) and says nothing; an answer of CAP_SUSPECT or more from
 *   any relay may have been cut off, so the batch is split in half and each
 *   half asked again, down to a single lookup id, and a single id that still
 *   fills an answer is paged backwards in time with `until`.
 * - What cannot be completed is said, not dropped: a relay that refuses a
 *   request, one that does not answer, one that ignores `until`, and a region
 *   with more than MAX_PAGES pages are listed in the status as skipped, and
 *   the panel says the rescan is incomplete.
 * - Every answer is opened with the key whose lookup id it is filed under,
 *   and filed as the automatic scan files it: the reveal for a first find,
 *   and a place key that opened something becomes a held key ('scan'), as it
 *   would have if the scan had found it while you stood there.
 */

import type { NostrEvent } from 'nostr-tools'
import { HIDDEN_KIND, unbag, type Hidden, type RegionOrigin } from '../hidden'
import { hexToBytes } from '../events'
import { queryEach } from '../relay'
import { mergeAnswers, type RelayAnswer } from '../relayOutcome'
import { describeError } from './db'
import { resolveReference } from '../references'
import { useCeremony } from '../../store/useCeremony'
import { useSecrets, type HeldKey, type RescanStatus } from '../../store/useSecrets'
import { useShards } from '../../store/useShards'
import type { Place, PlaceKey } from './places'
import { placeById, placeKeyPages, placeKeysAmong, placeKeysOf } from './vault'

/** Lookup ids per request. */
export const RESCAN_BATCH = 150
/**
 * Requests in flight at once, for everything one rescan sends: enough to
 * overlap the waits, few enough not to crowd a relay's subscription limit.
 */
export const RESCAN_PARALLEL = 3
/** The most events one request asks for, sent as the filter's `limit`. */
export const RESCAN_LIMIT = 500
/**
 * An answer this long from one relay may be that relay's cap rather than
 * everything it has. Low on purpose: relays cap at numbers of their own,
 * some at 100 to 300, and a region with this many hidden things is rare, so
 * checking costs little.
 */
export const CAP_SUSPECT = 100
/** How far back one lookup id is paged before it is reported as not finished. */
export const MAX_PAGES = 50

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

/**
 * A place key as an entry, in the plane it was last stood in. A key the first
 * build of this database stored has no plane (review of #219, N3); it is read
 * in dataspace rather than held with no plane at all.
 */
export function placeKeyEntry(k: PlaceKey, now: number): RescanEntry {
  const plane = k.plane ?? 0
  return {
    lookupId: k.lookupId,
    keyHex: k.keyHex,
    height: k.height,
    origin: originOf(k.base, plane),
    promote: { lookupId: k.lookupId, keyHex: k.keyHex, height: k.height, base: k.base, plane, source: 'scan', at: now },
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

/** Ask every relay about some lookup ids, at most `limit` events, optionally only at or before `until`; each relay's answer apart. */
export type Ask = (ids: string[], opts: { until?: number; limit: number }) => Promise<RelayAnswer[]>

/** Lookup ids a relay did not fully answer, and why. */
export interface Skip { relay: string; why: string; ids: number }

/** Everything asked for, and what could not be completed. */
export interface Got { events: NostrEvent[]; skipped: Skip[] }

/** At most `n` calls of `fn` running at once; the rest wait in order. */
export function limited<A extends unknown[], R>(n: number, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  let active = 0
  const waiting: Array<() => void> = []
  const next = (): void => {
    if (active >= n) return
    const start = waiting.shift()
    if (!start) return
    active++
    start()
  }
  return (...args) => new Promise<R>((resolve, reject) => {
    waiting.push(() => { fn(...args).then(resolve, reject).finally(() => { active--; next() }) })
    next()
  })
}

/** The relays that did not answer a request, as skips for these ids. */
function notAnswered(answers: RelayAnswer[], ids: number): Skip[] {
  const out: Skip[] = []
  for (const a of answers) {
    if (a.outcome === 'refused') out.push({ relay: a.url, why: `refused the request (${a.reason})`, ids })
    else if (a.outcome === 'unreachable') out.push({ relay: a.url, why: `did not answer (${a.reason})`, ids })
  }
  return out
}

/** The relays whose answer may have been cut off at their cap. */
function fullRelays(answers: RelayAnswer[]): Set<string> {
  return new Set(answers.filter((a) => a.outcome === 'answered' && a.events.length >= CAP_SUSPECT).map((a) => a.url))
}

async function asking(ask: Ask, ids: string[], opts: { until?: number; limit: number }): Promise<RelayAnswer[]> {
  try {
    return await ask(ids, opts)
  } catch (err) {
    return [{ url: 'every relay', outcome: 'unreachable', reason: describeError(err), events: [] }]
  }
}

/**
 * Everything the relays have under these ids. An answer that may have been
 * cut off at a relay's cap is asked again in halves, down to one id, and a
 * single id that still fills an answer is paged back with `until`. What
 * cannot be completed comes back in `skipped`. Each event once.
 */
export async function askAll(ids: string[], ask: Ask): Promise<Got> {
  const answers = await asking(ask, ids, { limit: RESCAN_LIMIT })
  if (fullRelays(answers).size === 0) return { events: mergeAnswers(answers), skipped: notAnswered(answers, ids.length) }
  if (ids.length > 1) {
    // Every relay is asked the halves again, so their answers replace this one.
    const mid = Math.ceil(ids.length / 2)
    const halves = await Promise.all([askAll(ids.slice(0, mid), ask), askAll(ids.slice(mid), ask)])
    return { events: unique([...halves[0].events, ...halves[1].events]), skipped: [...halves[0].skipped, ...halves[1].skipped] }
  }
  return pageBack(ids, answers, ask)
}

/**
 * One busy lookup id, paged back in time. `until` includes its own second,
 * so nothing at the boundary is skipped. A full page that brings nothing new
 * is a whole page of events from that one second, and there may be more from
 * it than a relay returns at once; no filter can ask for the rest, so the id
 * is reported and paging steps one second further back. A relay that answers
 * with events newer than `until` is ignoring it and cannot be paged; it is
 * reported, as is a region still full after MAX_PAGES pages.
 */
async function pageBack(ids: string[], first: RelayAnswer[], ask: Ask): Promise<Got> {
  const seen = new Map(mergeAnswers(first).map((e) => [e.id, e]))
  const skips = new Map<string, Skip>()
  const skip = (relay: string, why: string): void => { skips.set(`${relay}\n${why}`, { relay, why, ids: 1 }) }
  for (const s of notAnswered(first, 1)) skip(s.relay, s.why)
  const ignoring = new Set<string>()
  let full = fullRelays(first)
  let until = oldest(first.filter((a) => full.has(a.url)).flatMap((a) => a.events))
  for (let page = 0; full.size > 0 && until >= 0; page++) {
    if (page >= MAX_PAGES) {
      for (const relay of full) skip(relay, `has more than ${MAX_PAGES} pages of ${RESCAN_LIMIT} events in one region`)
      break
    }
    const answers = await asking(ask, ids, { until, limit: RESCAN_LIMIT })
    for (const s of notAnswered(answers, 1)) skip(s.relay, s.why)
    let fresh = 0
    for (const a of answers) {
      if (a.outcome !== 'answered') continue
      if (a.events.some((e) => e.created_at > until)) { ignoring.add(a.url); continue }
      for (const e of a.events) if (!seen.has(e.id)) { seen.set(e.id, e); fresh++ }
    }
    full = new Set([...fullRelays(answers)].filter((url) => !ignoring.has(url)))
    if (fresh === 0) for (const relay of full) skip(relay, `has more events in one second than one request returns, in one region`)
    const next = oldest(answers.filter((a) => full.has(a.url)).flatMap((a) => a.events))
    until = fresh === 0 || next >= until ? Math.min(next, until) - 1 : next
  }
  for (const relay of ignoring) skip(relay, 'ignores `until`, so what it holds past its cap cannot be asked for')
  return { events: [...seen.values()], skipped: [...skips.values()] }
}

function oldest(events: NostrEvent[]): number {
  let at = Infinity
  for (const e of events) at = Math.min(at, e.created_at)
  return at
}

function unique(events: NostrEvent[]): NostrEvent[] {
  return [...new Map(events.map((e) => [e.id, e])).values()]
}

/** Skips with the same relay and reason, added up. */
function tally(skips: Skip[]): Skip[] {
  const by = new Map<string, Skip>()
  for (const s of skips) {
    const key = `${s.relay}\n${s.why}`
    const had = by.get(key)
    by.set(key, had ? { ...had, ids: had.ids + s.ids } : { ...s })
  }
  return [...by.values()]
}

export interface Asked {
  found: Hidden[]
  /** The entries whose key opened at least one item. */
  opened: RescanEntry[]
  /** Distinct lookup ids asked about, and batches sent. */
  asked: number
  batches: number
  skipped: Skip[]
}

/**
 * Ask about every batch and open what comes back, RESCAN_PARALLEL batches at
 * a time. The relay and the decryption are passed in, so the batching is
 * testable without either; `ask` should already be behind the rescan's one
 * limiter.
 */
export async function askAndOpen(
  batches: AsyncIterable<RescanEntry[]>,
  ask: Ask,
  open: (ev: NostrEvent, entry: RescanEntry) => Promise<Hidden[]>,
  onBatch?: (done: number, asked: number) => void,
  parallel: number = RESCAN_PARALLEL,
): Promise<Asked> {
  const out: Asked = { found: [], opened: [], asked: 0, batches: 0, skipped: [] }
  const it = batches[Symbol.asyncIterator]()
  const worker = async (): Promise<void> => {
    for (;;) {
      const next = await it.next()
      if (next.done) return
      const byId = new Map<string, RescanEntry>()
      for (const e of next.value) if (!byId.has(e.lookupId)) byId.set(e.lookupId, e)
      out.asked += byId.size
      const got = await askAll([...byId.keys()], ask)
      out.skipped = tally([...out.skipped, ...got.skipped])
      const opened = new Set<string>()
      for (const ev of got.events) {
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

const askRelays: Ask = (ids, { until, limit }) =>
  queryEach({ kinds: [HIDDEN_KIND], '#d': ids, limit, ...(until !== undefined ? { until } : {}) })

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
  const status: RescanStatus = { running: true, done: 0, requests: Math.max(1, Math.ceil(expected / RESCAN_BATCH)), asked: 0, found: 0, fresh: 0, held: 0, error: null, skipped: [] }
  onProgress?.({ ...status })
  // The SCANNING tag, as SCAN on one row lights it.
  useShards.getState().setScanning(true)
  // One limiter for every request this run sends, however it splits or pages.
  const result = await askAndOpen(batches, limited(RESCAN_PARALLEL, askRelays), openEntry, (done, asked) => {
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
  return { ...status, running: false, done: result.batches, requests: result.batches, asked: result.asked, found: result.found.length, fresh: fresh.length, held: promoted.length, skipped: result.skipped }
}

let rescanning: Promise<RescanStatus> | null = null

/** RESCAN ALL: every held key and every place key. A second press while one runs joins it. */
export function rescanAll(): Promise<RescanStatus> {
  if (rescanning) return rescanning
  const { keys, storage, setRescan } = useSecrets.getState()
  const run = (async () => {
    // How many distinct ids there are: a held key that is also a place key is asked once.
    const held = Object.keys(keys)
    const expected = held.length + storage.placeKeys - await placeKeysAmong(held).catch(() => 0)
    return rescanBatches(allBatches(keys, placeKeyPages(RESCAN_BATCH)), expected, setRescan)
  })().then(
    (status) => { setRescan(status); return status },
    (err: unknown) => {
      setRescan({ running: false, done: 0, requests: 0, asked: 0, found: 0, fresh: 0, held: 0, error: describeError(err), skipped: [] })
      throw err
    },
  )
  rescanning = run
  const clear = (): void => { if (rescanning === run) rescanning = null }
  run.then(clear, clear)
  return run
}

/** SCAN on one place: its cube keys, asked about now. Resolves to what it found and what it could not finish. */
export async function rescanPlace(id: string): Promise<{ found: number; skipped: Skip[] }> {
  const place = await placeById(id)
  if (!place) return { found: 0, skipped: [] }
  const keys = useSecrets.getState().keys
  const entries = placeEntries(place, keys, await placeKeysOf(place.keys.filter((k) => !keys[k])))
  async function* one(): AsyncGenerator<RescanEntry[]> { yield entries }
  const status = await rescanBatches(one(), entries.length)
  return { found: status.found, skipped: status.skipped }
}

/** What a rescan skipped, in a sentence per relay and reason. */
export function describeSkips(skipped: Skip[]): string {
  return skipped.map((s) => `${s.relay} ${s.why} for ${s.ids} lookup id${s.ids === 1 ? '' : 's'}`).join('; ')
}
