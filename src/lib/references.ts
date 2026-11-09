/**
 * references.ts - fetching the events a bag's reference entries name (spec §7.6).
 *
 * A reference is `["a", "<kind>:<pubkey>:<d>", relay, coord]`, which follows
 * its author's edits, or `["e", id, relay, coord]`, which pins one version.
 * Only the user's relays are asked; a hint among them goes first. Discovery rescans
 * often, so each answer is kept for a minute; a miss is kept too, so a
 * missing object costs one query a minute rather than one per scan.
 *
 * Batched (spec §7.6 Reading, rule 2): every reference asked for in the same
 * turn of the event loop is fetched together, one query per kind and author
 * (`{"kinds": [k], "authors": [pk], "#d": [d, ...]}`) and one per set of ids,
 * in chunks of REFERENCE_BATCH. A bag of sealed entries, which share a kind and
 * an author, opens with a handful of queries rather than one per entry, so a
 * full bag (some 850 references) is not 850 round trips.
 */

import { queryAny, relaySet } from './relay'
import { entryKey, type Reference } from './hidden'
import type { NostrEvent } from './events'

const TTL_MS = 60_000
/**
 * The answers kept, oldest first (an answer asked again goes last). Bounded
 * two ways: an answer past TTL_MS goes at the next ask, whoever asks; and the
 * events kept take at most REFERENCES_KEPT_BYTES (UTF-8, as signed), oldest
 * first out, as lib/hidden.ts bounds what it parses. A full bag names some
 * 850 sealed entries, each up to one event in size, and Cyberspace TV scans
 * without pause, so a cache that only ever replaced a key grew without end.
 */
const cache = new Map<string, { at: number; event: Promise<NostrEvent | null>; size: number }>()
export const REFERENCES_KEPT_BYTES = 8 * 1024 * 1024
let budget = REFERENCES_KEPT_BYTES
let keptBytes = 0
const encoder = new TextEncoder()

function drop(key: string): void {
  const was = cache.get(key)
  if (!was) return
  cache.delete(key)
  keptBytes -= was.size
}

/** Answers past their minute go, and the oldest go while the rest take more than the budget. The map is oldest first, so this stops at the first that stays. */
function sweep(now: number): void {
  for (const [k, v] of cache) {
    if (now - v.at < TTL_MS && keptBytes <= budget) break
    drop(k)
  }
}

/** The most `d` values or ids one query carries: small enough that a relay's own result limit never cuts an answer short. */
export const REFERENCE_BATCH = 100

/**
 * The relays to ask: the user's own, with the hint first only when it is one
 * of them. A hint anywhere else is ignored (spec §7.6 References: a reader
 * SHOULD NOT open a connection to a hinted relay it does not already use
 * without its user's consent). Asking a relay the bag's author chose would
 * tell that relay who found the bag and when, which a hider could use as a
 * beacon on people moving in LOCAL mode, and every new relay may ask the
 * finder to sign in. A reference whose event lives only on such a relay is a
 * missing entry here.
 */
function relaysFor(ref: Reference): string[] {
  const hint = ref[2]
  const all = relaySet()
  return hint && all.includes(hint) ? [hint, ...all.filter((r) => r !== hint)] : all
}

/** One reference waiting for its batch. */
interface Waiting { ref: Reference; done: (ev: NostrEvent | null) => void }
/** The references asked for this turn, by the query they share. */
let pending = new Map<string, Waiting[]>()
let flushing = false

/** The query a reference joins: its relays and, for an address, its kind and author; null for one that names nothing fetchable. */
function groupOf(ref: Reference): string | null {
  const relays = relaysFor(ref).join(' ')
  if (ref[0] === 'e') return /^[0-9a-f]{64}$/.test(ref[1]) ? `e|${relays}` : null
  const [kind, pubkey] = ref[1].split(':')
  const k = Number(kind)
  if (!Number.isInteger(k) || !/^[0-9a-f]{64}$/.test(pubkey ?? '')) return null
  return `a|${k}|${pubkey}|${relays}`
}

/** The newest event for an address among `found`, as a relay keeps it. */
function newestAt(found: NostrEvent[], ref: Reference): NostrEvent | null {
  const [kind, pubkey, ...rest] = ref[1].split(':')
  const d = rest.join(':')
  return found.filter((e) => String(e.kind) === kind && e.pubkey === pubkey && (e.tags.find((t) => t[0] === 'd')?.[1] ?? '') === d)
    .sort((a, b) => b.created_at - a.created_at)[0] ?? null
}

async function fetchGroup(group: string, waiting: Waiting[]): Promise<void> {
  const relays = relaysFor(waiting[0].ref)
  for (let i = 0; i < waiting.length; i += REFERENCE_BATCH) {
    const chunk = waiting.slice(i, i + REFERENCE_BATCH)
    let found: NostrEvent[] = []
    try {
      if (group.startsWith('e|')) {
        found = await queryAny(relays, { ids: [...new Set(chunk.map((w) => w.ref[1]))] })
      } else {
        const [kind, pubkey] = chunk[0].ref[1].split(':')
        const ds = [...new Set(chunk.map((w) => w.ref[1].split(':').slice(2).join(':')))]
        found = await queryAny(relays, { kinds: [Number(kind)], authors: [pubkey], '#d': ds })
      }
    } catch { found = [] }
    for (const w of chunk) w.done(w.ref[0] === 'e' ? found.find((e) => e.id === w.ref[1]) ?? null : newestAt(found, w.ref))
  }
}

function flush(): void {
  flushing = false
  const groups = pending
  pending = new Map()
  for (const [group, waiting] of groups) void fetchGroup(group, waiting).catch(() => { for (const w of waiting) w.done(null) })
}

function fetchReference(ref: Reference): Promise<NostrEvent | null> {
  const group = groupOf(ref)
  if (!group) return Promise.resolve(null)
  return new Promise((done) => {
    pending.set(group, [...(pending.get(group) ?? []), { ref, done }])
    if (!flushing) {
      flushing = true
      setTimeout(flush, 0)
    }
  })
}

/** The event a reference names, or null. Pass to unbag as its resolver. */
export function resolveReference(ref: Reference): Promise<NostrEvent | null> {
  const key = entryKey(ref)
  const now = Date.now()
  sweep(now)
  const hit = cache.get(key)
  if (hit && now - hit.at < TTL_MS) return hit.event
  drop(key)
  const event = fetchReference(ref).catch(() => null)
  const entry = { at: now, event, size: 0 }
  cache.set(key, entry)
  // Its size is known once it lands: counted then, if it is still the one kept.
  void event.then((ev) => {
    if (!ev || cache.get(key) !== entry) return
    entry.size = encoder.encode(JSON.stringify(ev)).length
    keptBytes += entry.size
    sweep(Date.now())
  })
  return event
}

/** Forget a cached answer, for example after publishing the object it names. */
export function forgetReference(ref: Reference): void {
  drop(entryKey(ref))
}

/** Forget every cached answer, and say how many there were: in tests, where `bytes` sets the bound. */
export function forgetReferences(bytes: number = REFERENCES_KEPT_BYTES): number {
  const n = cache.size
  cache.clear()
  keptBytes = 0
  budget = bytes
  return n
}

/** How much the cache holds, for tests: how many answers, and the bytes of the events among them. */
export function referencesKept(): { count: number; bytes: number } {
  return { count: cache.size, bytes: keptBytes }
}
