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

import { carriedModel, carriedPayload, carriedTable, carryObject, withAuthor } from 'sno-core/parts'
import { addressesIn, toPayload, type Ref, type ShardModel } from 'sno-core/shards'
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

/**
 * `parent` carrying a copy of `source`, a piece of your workshop, and the
 * reference a placement of it names (STAMP > OBJECT, YOURS; arkinox
 * 2026-10-25: "once copied we should just edit the copy directly").
 *
 * The copy is keyed under a `d` of its own, sixteen random hex digits, never
 * under the source's own address, and never one that names it:
 * - every reader that does not know `objects` asks public relays for that
 *   address, so the `d` says nothing about the piece (DECK-0003 §1.10, "What an
 *   older reader asks relays for"), and finds nothing there, rather than the
 *   source as it is published today;
 * - the workshop never answers for it (lib/parts.ts fetchOwnFirst), so the
 *   bench draws the copy, which is the parent's own data;
 * - stamping the source again after the copy was edited makes a new copy
 *   rather than another placement of the edited one;
 * - two parents' copies of one piece, made at different times, never collide
 *   when both are carried in one hide (a writer flattens into one table).
 *
 * A copy of the source exactly as it is now, already in this parent under your
 * key, is used again, so a piece stamped ten times in one parent travels once
 * and its placements edit together. The copy keeps the source's name, as a
 * label, sealed inside with the payload. Written as a hide writes it (OPAQUE
 * where never chosen), and what the source itself carries joins the parent's
 * one table, under your key. A source whose table came out of a bag marks the
 * parent too, so PUBLISH asks before writing it in the clear (§1.10).
 */
export function copyInto(parent: ShardModel, source: ShardModel, pubkey: string): { shard: ShardModel; ref: Ref } {
  const written = withAuthoredConstrain(ownKeysOnly(source, pubkey))
  const text = JSON.stringify(carriedPayload(written))
  const mine = `33331:${pubkey}:`
  const marked = (s: ShardModel): ShardModel => ((source as FromBag).fromBag ? ({ ...s, fromBag: true } as FromBag) : s)
  for (const [key, entry] of Object.entries(parent.objects ?? {})) {
    if (key.startsWith(mine) && JSON.stringify(entry) === text) return { shard: marked(parent), ref: ['a', key] }
  }
  const address = `${mine}${quietD()}`
  return { shard: marked(carryObject(parent, address, written)), ref: ['a', address] }
}

/**
 * One step into a shard in the workshop's edit view of a placed part (arkinox,
 * 2026-10-25: double-tap a part's box, ROOM > WATER, EXIT returns): the
 * address the placement names, and, for a live link, the object as its
 * author's event has it. A step without `live` is a copy carried in the root
 * shard's own table, and is edited in place.
 */
export interface InsideStep {
  address: string
  /** A live link (FEED, BY ADDRESS): read-only, as fetched. DETACH makes it a copy. */
  live?: ShardModel
}

/** A copy as a model, once per version of the root's table. */
const focused = new WeakMap<object, Map<string, ShardModel | null>>()

/**
 * The copy at `address` in `root`'s table as a model to edit: its id is its
 * `d`, so `33331:<you>:<id>` is its own address, and it holds the root's whole
 * table, since the root's table answers for its placements at every depth
 * (DECK-0003 §1.10). The same object for the same table. Null when the table
 * does not hold it, or holds one the format refuses.
 */
export function carriedCopy(root: ShardModel, address: string): ShardModel | null {
  const table = root.objects
  if (!table) return null
  let byAddress = focused.get(table)
  if (!byAddress) focused.set(table, (byAddress = new Map()))
  if (byAddress.has(address)) return byAddress.get(address) ?? null
  const m = carriedModel(table, address)
  const model = m ? { ...m, id: dOf(address), objects: table } : null
  byAddress.set(address, model)
  return model
}

/**
 * What the table of the event a placed object travels in holds for `address`
 * (DECK-0003 §1.10, in the order a reader looks): the root's, then, inside a
 * live link, that link's own. A carried answer is never fetched, even a bad
 * one. `read` is the model, or null for a bad entry; undefined when neither
 * holds it, and only then is it fetched.
 */
export function carriedAnswer(root: ShardModel, path: readonly InsideStep[], address: string): { read: ShardModel | null; live?: ShardModel } | undefined {
  if (root.objects && Object.prototype.hasOwnProperty.call(root.objects, address)) return { read: carriedCopy(root, address) }
  const link = path[path.length - 1]?.live
  const own = link?.objects
  if (!link || !own || !Object.prototype.hasOwnProperty.call(own, address)) return undefined
  const read = carriedModel(own, address) ?? null
  // It travels in the link's event, so it keeps that event's table and author.
  return { read, ...(read ? { live: { ...read, id: dOf(address), objects: own, ...(link.author ? { author: link.author } : {}) } } : {}) }
}

/**
 * Where a path into `root` really leads: the steps that still stand (an undo
 * can take a copy away from under the view), and the model the last of them
 * is, or the root itself for none.
 */
export function focusOf(root: ShardModel, path: readonly InsideStep[]): { path: InsideStep[]; model: ShardModel } {
  const kept: InsideStep[] = []
  let model = root
  for (const step of path) {
    const next = step.live ?? carriedCopy(root, step.address)
    if (!next) break
    kept.push(step)
    model = next
  }
  return { path: kept, model }
}

/** The addresses the root's own placements name. */
function placedBy(s: ShardModel): string[] {
  const used = new Set((s.parts ?? []).map((p) => p.ref))
  return (s.refs ?? []).filter((r, i) => used.has(i) && r[0] === 'a').map((r) => r[1])
}

/**
 * `root` with the copy at `address` replaced by `next`, an edit of it. What the
 * edit did to the table (a copy stamped inside the copy, a placement removed)
 * becomes the root's table, flat, and every entry the root still reaches, from
 * its own placements and through the table, is kept even when the copy no
 * longer places it. The copy is written here, so it is OPAQUE where nobody
 * chose (DECK-0003 §1.12); the entries it does not touch are carried as found.
 */
export function writeCopy(root: ShardModel, address: string, next: ShardModel): ShardModel {
  const before = root.objects ?? {}
  const table: Record<string, unknown> = { ...(next.objects ?? before) }
  table[address] = carriedPayload(withAuthoredConstrain(next))
  const seen = new Set<string>()
  const queue = placedBy(root)
  while (queue.length) {
    const a = queue.pop() as string
    if (seen.has(a)) continue
    seen.add(a)
    if (!(a in table) && a in before) table[a] = before[a]
    if (a in table) queue.push(...addressesIn(table[a]))
  }
  return { ...root, objects: table }
}

/**
 * DETACH: the live link at the end of `path` becomes a copy carried in the
 * shard that places it, keyed under your own pubkey (lib/carried.ts copyInto),
 * and every reference of that shard to the link names the copy instead, so
 * all its placements there follow. What the link's own event carries comes
 * with it, under your key (copyInto). The new path ends at the copy, to edit.
 * Null when the path does not end at a live link, or when a live link holds it:
 * nothing inside a link is yours to change until that link is detached.
 */
export function detachInto(root: ShardModel, path: readonly InsideStep[], pubkey: string): { root: ShardModel; path: InsideStep[] } | null {
  const top = path[path.length - 1]
  if (!top?.live) return null
  const above = path.slice(0, -1)
  if (above.some((step) => step.live)) return null
  const holder = above.length ? focusOf(root, above).model : root
  const { shard: withCopy, ref } = copyInto(holder, { ...top.live, id: dOf(top.address) }, pubkey)
  // The holder's references, the link's now the copy's, each named once (§1.10).
  const refs: Ref[] = []
  const index = new Map<string, number>()
  const moved = (withCopy.refs ?? []).map((r) => {
    const named = r[1] === top.address ? ref : r
    const key = `${named[0]}:${named[1]}`
    let i = index.get(key)
    if (i === undefined) { i = refs.length; index.set(key, i); refs.push(named) }
    return i
  })
  const next: ShardModel = { ...withCopy, refs, ...(withCopy.parts ? { parts: withCopy.parts.map((p) => ({ ...p, ref: moved[p.ref] })) } : {}) }
  const written = above.length ? writeCopy(root, above[above.length - 1].address, next) : next
  return { root: written, path: [...above, { address: ref[1] }] }
}
