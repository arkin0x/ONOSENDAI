/**
 * rescan.ts: RESCAN ALL, and SCAN on one place.
 *
 * The automatic scan asks about the thirteen cubes you stand in, once, as you
 * arrive. Something hidden in one of them after you left is never seen unless
 * you stand there again. RESCAN ALL asks the relays about every key this
 * device keeps, the held keys and every place's cube keys, in one pass:
 *
 * - Each lookup id once. A key that is held and is also a place key, or that
 *   many places share, is asked about one time.
 * - RESCAN_BATCH lookup ids to a request, a few requests at a time, so a
 *   device with thousands of places sends a few hundred modest requests
 *   rather than one a relay would refuse.
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

/** Lookup ids per request. */
export const RESCAN_BATCH = 150
/** Requests in flight at once: enough to overlap the waits, few enough not to crowd a relay's subscription limit. */
export const RESCAN_PARALLEL = 3

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
function heldEntry(k: HeldKey): RescanEntry {
  const cube = !k.heights || (k.heights.x === k.heights.y && k.heights.y === k.heights.z)
  return cube
    ? { lookupId: k.lookupId, keyHex: k.keyHex, height: k.height, origin: originOf(k.base, k.plane) }
    : { lookupId: k.lookupId, keyHex: k.keyHex }
}

function placeKeyEntry(k: PlaceKey, plane: HeldKey['plane'], now: number): RescanEntry {
  return {
    lookupId: k.lookupId,
    keyHex: k.keyHex,
    height: k.height,
    origin: originOf(k.base, plane),
    promote: { lookupId: k.lookupId, keyHex: k.keyHex, height: k.height, base: k.base, plane, source: 'scan', at: now },
  }
}

/**
 * Every key kept, one entry per lookup id: the held keys first, so a key that
 * is both is read as the held one, then each place key no held key covers.
 */
export function allEntries(
  keys: Record<string, HeldKey>,
  places: Record<string, Place>,
  placeKeys: Record<string, PlaceKey>,
  now: number = Math.floor(Date.now() / 1000),
): RescanEntry[] {
  const out: RescanEntry[] = Object.values(keys).map(heldEntry)
  const seen = new Set(out.map((e) => e.lookupId))
  // The plane each place key was last stood in, found in one pass over places.
  const planeOf = new Map<string, { plane: HeldKey['plane']; at: number }>()
  for (const p of Object.values(places)) {
    for (const id of p.keys) {
      const was = planeOf.get(id)
      if (!was || p.at > was.at) planeOf.set(id, { plane: p.plane, at: p.at })
    }
  }
  for (const k of Object.values(placeKeys)) {
    if (seen.has(k.lookupId)) continue
    seen.add(k.lookupId)
    out.push(placeKeyEntry(k, planeOf.get(k.lookupId)?.plane ?? 0, now))
  }
  return out
}

/** One place's cube keys as entries; a key already held is read as the held one. */
export function placeEntries(
  place: Place,
  keys: Record<string, HeldKey>,
  placeKeys: Record<string, PlaceKey>,
  now: number = Math.floor(Date.now() / 1000),
): RescanEntry[] {
  const out: RescanEntry[] = []
  for (const id of new Set(place.keys)) {
    if (keys[id]) { out.push(heldEntry(keys[id])); continue }
    const k = placeKeys[id]
    // In this place's plane: this is the place being asked about.
    if (k) out.push(placeKeyEntry(k, place.plane, now))
  }
  return out
}

/** Items in runs of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface Asked {
  found: Hidden[]
  /** The lookup ids whose key opened at least one item. */
  opened: Set<string>
  requests: number
}

/**
 * Ask about these entries in batches and open what comes back. The relay and
 * the decryption are passed in, so the batching is testable without either.
 */
export async function askAndOpen(
  entries: RescanEntry[],
  ask: (ids: string[]) => Promise<NostrEvent[]>,
  open: (ev: NostrEvent, entry: RescanEntry) => Promise<Hidden[]>,
  onBatch?: (done: number, requests: number) => void,
  size: number = RESCAN_BATCH,
  parallel: number = RESCAN_PARALLEL,
): Promise<Asked> {
  const byId = new Map<string, RescanEntry>()
  for (const e of entries) if (!byId.has(e.lookupId)) byId.set(e.lookupId, e)
  const batches = chunk([...byId.keys()], size)
  const out: Asked = { found: [], opened: new Set(), requests: batches.length }
  let next = 0
  let done = 0
  const worker = async (): Promise<void> => {
    while (next < batches.length) {
      const ids = batches[next++]
      // A batch the relays did not answer is a batch with nothing in it;
      // the rest still run.
      const events = await ask(ids).catch(() => [] as NostrEvent[])
      for (const ev of events) {
        const id = ev.tags.find((t) => t[0] === 'd')?.[1]
        const entry = id ? byId.get(id) : undefined
        if (!entry) continue
        const items = await open(ev, entry).catch(() => [] as Hidden[])
        if (items.length > 0) out.opened.add(entry.lookupId)
        out.found.push(...items)
      }
      onBatch?.(++done, batches.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, batches.length) }, worker))
  return out
}

const askRelays = (ids: string[]): Promise<NostrEvent[]> => query({ kinds: [HIDDEN_KIND], '#d': ids })

/** A held box key has no height of its own; your own deployment there may say it. */
const openEntry = (ev: NostrEvent, entry: RescanEntry): Promise<Hidden[]> => {
  const height = entry.height ?? useShards.getState().mine.find((d) => d.lookupId === entry.lookupId)?.height
  return unbag(ev, hexToBytes(entry.keyHex), resolveReference, entry.origin, height)
}

/**
 * Ask about these entries, file what opens, and hold the place keys that
 * opened something. Resolves to the counts the panel reports.
 */
export async function rescanEntries(entries: RescanEntry[], onProgress?: (status: RescanStatus) => void): Promise<RescanStatus> {
  const asked = new Set(entries.map((e) => e.lookupId)).size
  const status: RescanStatus = { running: true, done: 0, requests: Math.ceil(asked / RESCAN_BATCH), asked, found: 0, fresh: 0, held: 0 }
  onProgress?.({ ...status })
  // The SCANNING tag, as SCAN on one row lights it.
  useShards.getState().setScanning(true)
  const result = await askAndOpen(entries, askRelays, openEntry, (done, requests) => onProgress?.({ ...status, done, requests }))
    .finally(() => useShards.getState().setScanning(false))
  // Asked before addDiscovered, which records these as seen.
  const shards = useShards.getState()
  const fresh = shards.freshOf(result.found)
  if (result.found.length > 0) shards.addDiscovered(result.found)
  if (fresh.length > 0) useCeremony.getState().mark(fresh)
  const secrets = useSecrets.getState()
  const promoted = entries.filter((e) => e.promote && result.opened.has(e.lookupId) && !secrets.keys[e.lookupId]).map((e) => e.promote!)
  secrets.hold(promoted)
  return { ...status, running: false, done: result.requests, requests: result.requests, found: result.found.length, fresh: fresh.length, held: promoted.length }
}

let rescanning: Promise<RescanStatus> | null = null

/** RESCAN ALL: every held key and every place key. A second press while one runs joins it. */
export function rescanAll(): Promise<RescanStatus> {
  if (rescanning) return rescanning
  const { keys, places, placeKeys, setRescan } = useSecrets.getState()
  const run = rescanEntries(allEntries(keys, places, placeKeys), setRescan).then(
    (status) => { setRescan(status); return status },
    (err: unknown) => { setRescan(null); throw err },
  )
  rescanning = run
  const clear = (): void => { if (rescanning === run) rescanning = null }
  run.then(clear, clear)
  return run
}

/** SCAN on one place: its cube keys, asked about now. Resolves to how many items opened. */
export async function rescanPlace(id: string): Promise<number> {
  const { keys, places, placeKeys } = useSecrets.getState()
  const place = places[id]
  if (!place) return 0
  const status = await rescanEntries(placeEntries(place, keys, placeKeys))
  return status.found
}
