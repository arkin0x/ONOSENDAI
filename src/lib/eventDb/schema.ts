/**
 * schema.ts - the shape of `onosendai:events`, the one database every nostr
 * event ONOSENDAI keeps lives in (the owner's ruling, 2026-10-30: "every
 * nostr event should be in indexeddb"; the design is
 * onosendai/event-db-design.md, section 3).
 *
 * One row per event, as it arrived: signed, and still ciphertext when it was
 * ciphertext. Beside the event, a row carries what a check found (nip01,
 * proof, chain), so a check is done once per event and not on every load.
 * Inner events and other plaintext never enter `events`; they have stores of
 * their own, scoped to the identity that owns them.
 *
 * Nothing here touches the database. Upgrades only ever add a store or an
 * index (lib/idb.ts), so a newer schema is a superset of an older one. A build
 * that goes back a version, or a tab left open through an upgrade, asks for a
 * lower version than the database has, and IndexedDB refuses that with a
 * VersionError; connection.ts then opens whatever version is there. It reads
 * what it knows: a row's unknown fields are ignored, and a later version's
 * stores are left alone.
 */

import type { IndexSpec } from '../idb'
import type { NostrEvent } from '../events'

export const EVENT_DB = 'onosendai:events'
export const EVENT_DB_VERSION = 1

export const EVENTS = 'events'
export const CHAINS = 'chains'
export const PARTED = 'parted'
export const OUTBOX = 'outbox'
export const DELETIONS = 'deletions'
export const MARKS = 'marks'
export const CURSORS = 'cursors'
export const HELD = 'held'
export const MINE = 'mine'
export const OPENED = 'opened'
export const FOUND = 'found'
export const META = 'meta'

const BY_CHAIN: IndexSpec = { name: 'byChain', keyPath: ['chainOf', 'chainN'] }

/** Every store of version 1, as lib/idb.ts openDatabase takes them. */
export const EVENT_DB_STORES: Array<[string, string | string[], IndexSpec[]?]> = [
  [EVENTS, 'id', [
    { name: 'byAuthorKind', keyPath: ['pubkey', 'kind', 'created_at'] },
    { name: 'byKind', keyPath: ['kind', 'created_at'] },
    { name: 'byAddr', keyPath: 'addr', unique: true },
    { name: 'byTag', keyPath: 'tagx', multiEntry: true },
    { name: 'byUse', keyPath: ['pin', 'usedAt'] },
    BY_CHAIN,
  ]],
  [CHAINS, 'pubkey'],
  // With the head: two branches set aside in one millisecond are two branches.
  [PARTED, ['pubkey', 'at', 'headId']],
  [OUTBOX, 'id', [{ name: 'byPubkey', keyPath: 'pubkey' }]],
  [DELETIONS, 'target'],
  [MARKS, ['owner', 'id'], [{ name: 'byOwner', keyPath: 'owner' }]],
  [CURSORS, 'name'],
  [HELD, ['owner', 'id'], [{ name: 'byOwner', keyPath: 'owner' }]],
  [MINE, ['owner', 'bagAddr', 'itemId'], [{ name: 'byOwner', keyPath: 'owner' }]],
  [OPENED, ['owner', 'id'], [{ name: 'byOwner', keyPath: 'owner' }]],
  [FOUND, ['owner', 'bagAddr'], [{ name: 'byOwner', keyPath: 'owner' }]],
  [META, 'key'],
]

/** 0 not checked; 1 id and signature verified; 2 id verified, unsigned on purpose (your own sign-later action). */
export type Nip01Flag = 0 | 1 | 2
/** 0 not checked; 1 valid; 2 valid by the exemption list; 3 no proof needed; -1 invalid. */
export type ProofFlag = 0 | 1 | 2 | 3 | -1
/** 0 not checked; 1 valid through here; -1 broken here or before. */
export type ChainFlag = 0 | 1 | -1

/**
 * How much a NIP-01 flag says about the row's bytes: a signature checked says
 * most, an id checked and unsigned on purpose less, nothing checked least. An
 * arrival that outranks the row replaces the row's bytes, so a flag always
 * describes the bytes beside it.
 */
export const nip01Rank = (flag: Nip01Flag): number => (flag === 1 ? 2 : flag === 2 ? 1 : 0)

/** Movement actions. A deletion has no effect on them: relays and verifiers still see a fork, and a fork ends a chain. */
export const MOVEMENT_KIND = 3333

export interface EventRow extends NostrEvent {
  /** `kind:pubkey:d` or `kind:pubkey:`, on the current version of an address only. */
  addr?: string
  /** `[letter:value, created_at]` for the tags read locally (TAG_INDEX): the time is in the key, so a limited read stops at its limit. */
  tagx: Array<[string, number]>
  /** Normalized URLs of the relays this event came from or that took it. */
  seen: string[]
  nip01: Nip01Flag
  proof: ProofFlag
  proofRev?: string
  chain: ChainFlag
  chainEpoch?: number
  chainRev?: string
  /** On the first broken action only: the reason the rules gave. */
  breakAt?: string
  /** Size of the event's JSON. What the budget counts. */
  bytes: number
  /** When a read last used it (ms, rounded to the minute). */
  usedAt: number
  /** 1: never evicted, and not counted against the budget. */
  pin: 0 | 1
  savedAt: number
  /** A relay took it. On a row of a chain this is what `published` was on the old record. */
  acked?: 1
  /** A valid deletion named it, and it is pinned (your own history is the chain's evidence). */
  deleted?: 1
  /**
   * The identity whose chain holds this row, and its place in that chain, on
   * the rows of a chain in hand only. A row dropped by a fold loses both and
   * stays, as a signed fact nothing reads as part of the chain. Membership
   * is stored rather than walked back from the head, because a forked chain
   * is kept whole (2026-10-08 ruling) and a walk from one head reads one branch.
   */
  chainOf?: string
  chainN?: number
}

/** The tag letters ONOSENDAI queries locally, taken from the filters the code sends. */
export const TAG_INDEX: ReadonlySet<string> = new Set(['a', 'd', 'e', 'p', 'k', 't', 'A', 'E', 'K', 'S', 'X', 'Y', 'Z'])

/** A tag's value is indexed only up to this long: a key that long is not a thing anyone looks up. */
const TAG_VALUE_MAX = 256
/** How many index entries one row may have. The row is stored whole past it; only the index stops, so one event cannot bloat it. */
export const TAG_ENTRIES_MAX = 256

/** The multi-entry index keys of `event`. An event's other tags, `mp` among them, cost the index nothing. */
export function tagIndexOf(event: Pick<NostrEvent, 'tags' | 'created_at'>): Array<[string, number]> {
  const out = new Set<string>()
  for (const t of event.tags) {
    if (out.size >= TAG_ENTRIES_MAX) break
    if (TAG_INDEX.has(t[0]) && typeof t[1] === 'string' && t[1].length <= TAG_VALUE_MAX) out.add(`${t[0]}:${t[1]}`)
  }
  return [...out].map((tag) => [tag, event.created_at])
}

const isReplaceableKind = (kind: number): boolean => kind === 0 || kind === 3 || (kind >= 10_000 && kind < 20_000)
const isAddressableKind = (kind: number): boolean => kind >= 30_000 && kind < 40_000

/** Whether an event of this kind is held to one current version per address. */
export const isAddressKind = (kind: number): boolean => isReplaceableKind(kind) || isAddressableKind(kind)

/** The address of a replaceable or addressable event; undefined for every other kind. */
export function addressOf(event: Pick<NostrEvent, 'kind' | 'pubkey' | 'tags'>): string | undefined {
  if (isReplaceableKind(event.kind)) return `${event.kind}:${event.pubkey}:`
  if (isAddressableKind(event.kind)) return `${event.kind}:${event.pubkey}:${event.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`
  return undefined
}

/** Inner events: they live inside a bag or a seal, plaintext, and never enter `events` (design 3.9). */
const INNER_KINDS: ReadonlySet<number> = new Set([13, 14, 3330, 3340, 3341])

/**
 * Whether a kind is kept: every kind but the ephemeral range (auth and wallet
 * traffic are in it), block anchors (their stops are kept, a million signed
 * events are not) and inner events. Chat envelopes are the one ephemeral kind
 * kept (the ruling of 2026-10-31: chat at rest is the encrypted envelope,
 * decrypted on load).
 */
export function keptKind(kind: number): boolean {
  if (kind === 23_330) return true
  if (kind >= 20_000 && kind < 30_000) return false
  return kind !== 321 && !INNER_KINDS.has(kind)
}

/** Whether an event may enter `events`: a kept kind, and no private key in a `secret` tag, whatever its kind says. */
export function keptEvent(event: Pick<NostrEvent, 'kind' | 'tags'>): boolean {
  return keptKind(event.kind) && !event.tags.some((t) => t[0] === 'secret')
}

const HEX_64 = /^[0-9a-f]{64}$/

/** Whether a value handed in has the shape of an event at all. One that does not is refused alone, and costs the batch nothing. */
export function isEventShape(e: unknown): e is NostrEvent {
  const v = e as Partial<NostrEvent> | null
  return !!v
    && typeof v.id === 'string' && HEX_64.test(v.id)
    && typeof v.pubkey === 'string' && HEX_64.test(v.pubkey)
    && Number.isSafeInteger(v.created_at) && Number.isSafeInteger(v.kind)
    && typeof v.content === 'string' && typeof v.sig === 'string'
    && Array.isArray(v.tags) && v.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string'))
}

/** The event's NIP-40 expiration (seconds), or null when it has none. */
export function expirationOf(event: Pick<NostrEvent, 'tags'>): number | null {
  const v = event.tags.find((t) => t[0] === 'expiration')?.[1]
  if (v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** A time for `usedAt`: rounded to the minute, so most reads have nothing to write back. */
export const useTime = (ms: number): number => Math.floor(ms / 60_000) * 60_000

const utf8 = new TextEncoder()

/** Bytes as stored, not UTF-16 units. */
export const utf8Bytes = (value: unknown): number => utf8.encode(JSON.stringify(value)).length

export interface RowOptions {
  nip01: Nip01Flag
  pin?: boolean
  /** The relay it came from or that took it, normalized. */
  relay?: string
}

/** A new row for `event`. Only the event's own seven fields are copied, whatever else the object carries. */
export function rowOf(event: NostrEvent, opts: RowOptions, now: number): EventRow {
  const clean: NostrEvent = { id: event.id, pubkey: event.pubkey, created_at: event.created_at, kind: event.kind, tags: event.tags, content: event.content, sig: event.sig }
  const addr = addressOf(event)
  return {
    ...clean,
    ...(addr !== undefined ? { addr } : {}),
    tagx: tagIndexOf(event),
    seen: opts.relay ? [opts.relay] : [],
    nip01: opts.nip01,
    proof: 0,
    chain: 0,
    bytes: utf8Bytes(clean),
    usedAt: useTime(now),
    pin: opts.pin ? 1 : 0,
    savedAt: now,
  }
}

/** The event a row holds: the seven fields a consumer knows, and nothing the row added. */
export function eventOf(row: EventRow): NostrEvent {
  return { id: row.id, pubkey: row.pubkey, created_at: row.created_at, kind: row.kind, tags: row.tags, content: row.content, sig: row.sig }
}

/**
 * The budget for rows that are not pinned (the ruling of 2026-10-31: 100 MB
 * for other people's events; your own are never evicted). Counted in event
 * JSON bytes (UTF-8). Real numbers from 2026-10-31: a v1 hop is 913 bytes and a real
 * v2 hop 8,124 (its `mp` tag is 7,177, and is not indexed), so this holds
 * about 12,900 v2 hops, or about 9 neighbors with a chain of 1,300 v2 hops
 * each. The eviction pass that enforces it is a later phase.
 */
export const OTHERS_BUDGET_BYTES = 100 * 1024 * 1024

/** The running totals `meta` keeps under this key, exact per transaction (the `onosendai:secrets` pattern). */
export const BUDGET_KEY = 'budget'
export interface BudgetTotals { pinnedBytes: number; pinnedRows: number; unpinnedBytes: number; unpinnedRows: number; tombstoneBytes: number }
export const EMPTY_BUDGET: BudgetTotals = { pinnedBytes: 0, pinnedRows: 0, unpinnedBytes: 0, unpinnedRows: 0, tombstoneBytes: 0 }
