/**
 * carried.ts - the objects an object carries inside its own payload
 * (DECK-0003 §1.10, `objects`), as ONOSENDAI reads them.
 *
 * A build whose pieces were never published carries them in its payload, keyed
 * by the address each placement names, so a finder draws the pieces from the
 * bag instead of asking relays for names nobody published ("we never published
 * the parts and i dont want to", arkinox 2026-10-25). sno-core reads the table
 * and resolves placements from it first (sno-core/parts resolveParts); this is
 * the part that depends on where an object came from.
 */

import { carriedTable, withAuthor } from 'sno-core/parts'
import { toPayload, type ShardModel } from 'sno-core/shards'
import { withAuthoredConstrain } from './walkConstrain'

/**
 * `model` as read from an event whose pubkey is `pubkey`: its author set
 * (sno-core withAuthor, local only, never written) and only the carried
 * objects keyed under that pubkey kept. A key under anyone else's is ignored,
 * and its address fetched as though the table did not hold it (D5, arkinox
 * 2026-10-25; the spec's "keys are under the author's own pubkey"). With no
 * pubkey to check against, nothing carried is honoured. Applied wherever an
 * object is read from its event; for an unsigned item in a bag, the pubkey is
 * the bag's signer, and in a chest there is none, never the item's own claim.
 */
export function keepOwnTable(model: ShardModel, pubkey: string | null | undefined): ShardModel {
  return withAuthor(model, pubkey ?? null)
}

/**
 * `model` with only the carried objects keyed under `pubkey` (or none at all
 * without one), and no author. A table counts as yours only when it was read
 * from an event you signed; see signedTableOnly and noTable for the two ways
 * a model comes into the workshop.
 */
export function ownTableOnly(model: ShardModel, pubkey: string | null): ShardModel {
  const { author: _was, ...bare } = model
  if (!model.objects) return model.author === undefined ? model : bare
  const kept = carriedTable(model, pubkey)
  const { objects: _all, ...rest } = bare
  return Object.keys(kept).length ? { ...rest, objects: kept } : rest
}

/**
 * A copy into your workshop of a model read from an event (the feed, a bag, a
 * chest, an avatar): its table is kept only when that event was signed by you
 * (`author`, set where it was read), and then only your keys; from anyone else
 * nothing it carries comes in. Their keys would not count once it is yours,
 * and keys under your name in their event are a forgery.
 */
export function signedTableOnly(model: ShardModel, me: string | null): ShardModel {
  return ownTableOnly(model, me && model.author === me ? me : null)
}

/**
 * A model read from text or a file (PASTE, IMPORT, a zip, its UPDATE): nobody
 * signed it, so nothing it carries is trusted, not even keys under your own
 * name, which anyone can write. Its table goes whole. A placement it makes of
 * a piece your workshop holds is still carried when you hide it, from the
 * workshop's own piece (store/localObjects.ts carryLibrary).
 */
export function noTable(model: ShardModel): ShardModel {
  return ownTableOnly(model, null)
}

/** Who "you" are, for a model made here (store/localObjects.ts wires it): null when no one is signed in. */
let localAuthor: () => string | null = () => null

/** Say who you are (store/localObjects.ts), or stop (null). */
export function setLocalAuthor(get: (() => string | null) | null): void {
  localAuthor = get ?? (() => null)
}

/** You, or null. */
export function you(): string | null {
  return localAuthor()
}

/**
 * Whose keys of `model`'s table count (DECK-0003 §1.10): the pubkey of the
 * event it was read from (keepOwnTable), or, for a model with none, yours,
 * since every model read from an event has one and so a model without one was
 * made here, by you. Never every key.
 */
export function authorOf(model: Pick<ShardModel, 'author'>): string | null {
  return model.author ?? localAuthor()
}

/**
 * The most a payload carrying pieces may be, in bytes: what a relay that takes
 * 131,072 bytes has left for the payload of a hidden object as this client
 * publishes it (DECK-0003 §1.10 Size). Base64 takes 98,304 bytes to 131,072;
 * the cipher's nonce and tag and the rest of the event take 523 of those: the
 * spec's 415, plus this client's `alt` and `client` tags and its 32-digit `d`.
 * Measured against the real event in deployCarried.test.ts. Every piece of the
 * Maze Kit fits.
 */
export const CARRY_BUDGET_BYTES = 97_781

/** How the refusal names the budget, in the words of D3 (arkinox 2026-10-25). */
const BUDGET_KB = 96

/** The size of the payload a hide writes for `shard`, in bytes (OPAQUE where its author never chose, as every hide writes it). */
export function payloadBytes(shard: ShardModel): number {
  return new TextEncoder().encode(JSON.stringify(toPayload(withAuthoredConstrain(shard)))).length
}

/**
 * Why a shard carrying pieces is not hidden, or null when it fits (D3,
 * arkinox 2026-10-25, his words). Kilobytes rounded up, and never fewer than
 * 97, so a payload over the budget never reads as 96 of 96. Only a shard that
 * carries something is held to it: one that carries nothing goes as it always
 * has, inline or by reference.
 */
export function carryRefusal(shard: ShardModel): string | null {
  if (!shard.objects || Object.keys(shard.objects).length === 0) return null
  const bytes = payloadBytes(shard)
  if (bytes <= CARRY_BUDGET_BYTES) return null
  return `${Math.max(BUDGET_KB + 1, Math.ceil(bytes / 1024))}kb of ${BUDGET_KB}kb may be larger than relays will accept. Keep this part separate.`
}

/** Sixteen random hex digits: a `d` that says nothing about what it names. */
export function quietD(): string {
  const b = new Uint8Array(8)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** The `d` of an address. */
export const dOf = (address: string): string => address.split(':').slice(2).join(':')

/**
 * Whether a `d` says nothing about what it names: random hex, or this
 * workshop's own uuid. A kit's path is the opposite, and so is a name
 * (DECK-0003 §1.10, "What an older reader asks relays for").
 */
export function isQuietD(d: string): boolean {
  return /^[0-9a-f]{16,}$/.test(d) || /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(d)
}

/** One `refs` list with the addresses in `moved` renamed, relay hints kept. The same list when nothing changes. */
function movedRefs<T>(refs: T, moved: ReadonlyMap<string, string>): T {
  if (!Array.isArray(refs)) return refs
  let changed = false
  const out = refs.map((r: unknown) => {
    const to = Array.isArray(r) && r[0] === 'a' ? moved.get(r[1] as string) : undefined
    if (to === undefined) return r
    changed = true
    return [(r as unknown[])[0], to, ...(r as unknown[]).slice(2)]
  })
  return (changed ? out : refs) as T
}

/**
 * `model` with each table key that `should` names moved to a fresh address
 * under `pubkey`, and every `a` ref naming it, in `model` and in the table's
 * entries, moved with it (the steps of DECK-0004 §3.4, "Taking an object that
 * carries its parts"; sno-core toPayload writes the keys in code point order).
 * An entry this rewrites is one this tool writes, so it is written OPAQUE when
 * nobody chose (DECK-0003 §1.12); one it leaves alone is carried as found. An
 * object placed by an address not in the table is a link, and stays as it is.
 */
export function rekeyTable(model: ShardModel, pubkey: string, should: (key: string) => boolean): ShardModel {
  const table = model.objects
  if (!table) return model
  const moved = new Map<string, string>()
  for (const key of Object.keys(table)) if (should(key)) moved.set(key, `33331:${pubkey}:${quietD()}`)
  if (moved.size === 0) return model
  const entries = Object.entries(table).map(([key, entry]): [string, unknown] => {
    const to = moved.get(key) ?? key
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [to, entry]
    const raw = entry as Record<string, unknown>
    const refs = movedRefs(raw.refs, moved)
    if (to === key && refs === raw.refs) return [to, entry]
    const chosen = raw.constrain === 'all' || raw.constrain === 'opaque' || raw.constrain === 'off'
    return [to, { ...raw, ...(refs === undefined ? {} : { refs }), ...(chosen ? {} : { constrain: 'opaque' }) }]
  })
  return { ...model, ...(model.refs ? { refs: movedRefs(model.refs, moved) } : {}), objects: Object.fromEntries(entries) }
}

/**
 * `model` with every table key under `pubkey`, the signer about to write it: a
 * publisher MUST write no other, because a reader ignores it and asks relays
 * for that address instead (DECK-0003 §1.10). A workshop is kept per device,
 * not per key, so a shard built under one identity can be hidden under
 * another. Its pieces stay inside, as that signer's copies.
 */
export function ownKeysOnly(model: ShardModel, pubkey: string): ShardModel {
  return rekeyTable(model, pubkey, (key) => !key.startsWith(`33331:${pubkey}:`))
}

/** A model whose table came out of a bag, as the workshop remembers it: local only, never written. */
type FromBag = ShardModel & { fromBag?: true }

/**
 * A copy into your workshop of an object taken from a bag or a chest: its
 * table comes with it, under your key (DECK-0004 §3.4, "Taking an object that
 * carries its parts"), and it remembers where it came from, so PUBLISH asks
 * before writing that table in the clear (DECK-0003 §1.10). Only the keys that
 * counted where it was read come in: an object read with no pubkey that counts
 * brings nothing.
 */
export function takenCopy(model: ShardModel, me: string | null): ShardModel {
  const author = model.author ?? null
  const own = ownTableOnly(model, author)
  if (!own.objects) return own
  const keyed = me && author !== me ? rekeyTable(own, me, () => true) : own
  return me ? ({ ...keyed, fromBag: true } as FromBag) : noTable(model)
}

/** Whether `model` holds a table that came out of a bag and that nobody chose to publish. */
export function tableFromBag(model: ShardModel): boolean {
  return (model as FromBag).fromBag === true && Object.keys(model.objects ?? {}).length > 0
}

/** `model` with its table's origin forgotten: its user chose to keep the table when it is published. */
export function keepTable(model: ShardModel): ShardModel {
  const { fromBag: _chosen, ...rest } = model as FromBag
  return rest
}

/**
 * `model` as it goes out in the clear, as a public object or an avatar: a table
 * from a bag stays out of it unless its user chose to keep it (DECK-0003 §1.10,
 * "A table taken from a bag stays out of the clear"). Choosing to publish is
 * not that choice, so this is the default at the writer, and only keepTable
 * lifts it.
 */
export function inTheClear(model: ShardModel): ShardModel {
  if (!(model as FromBag).fromBag || !model.objects) return model
  const { objects: _sealed, ...rest } = model
  return rest
}
