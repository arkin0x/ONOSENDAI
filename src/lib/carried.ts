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

import { sha256 } from '@noble/hashes/sha2.js'
import { carriedTable, carryAll, parseAddress, withAuthor, type CarryChoice } from 'sno-core/parts'
import { toPayload, uuid, type Ref, type ShardModel } from 'sno-core/shards'
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
 * The new `d` is random unless `dFor` says otherwise.
 */
export function rekeyTable(model: ShardModel, pubkey: string, should: (key: string) => boolean, dFor: (key: string) => string = quietD): ShardModel {
  const table = model.objects
  if (!table) return model
  const moved = new Map<string, string>()
  for (const key of Object.keys(table)) if (should(key)) moved.set(key, `33331:${pubkey}:${dFor(key)}`)
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

/** Sixteen hex digits that say nothing, the same for one old key and one signer. */
function steadyD(key: string, pubkey: string): string {
  return [...sha256(new TextEncoder().encode(key + pubkey)).slice(0, 8)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/**
 * `model` with every table key under `pubkey`, the signer about to write it: a
 * publisher MUST write no other, because a reader ignores it and asks relays
 * for that address instead (DECK-0003 §1.10). A workshop is kept per device,
 * not per key, so a shard built under one identity can be hidden under
 * another. Its pieces stay inside, as that signer's copies. The new address
 * comes from the old one, so writing the shard again writes the same thing, and
 * the publish state does not read it as edited.
 */
export function ownKeysOnly(model: ShardModel, pubkey: string): ShardModel {
  return rekeyTable(model, pubkey, (key) => !key.startsWith(`33331:${pubkey}:`), (key) => steadyD(key, pubkey))
}

/** How many of `model`'s carried pieces were keyed under another identity, and so read as placeholders on this bench. */
export function foreignKeys(model: Pick<ShardModel, 'objects'>, pubkey: string): number {
  return Object.keys(model.objects ?? {}).filter((key) => !key.startsWith(`33331:${pubkey}:`)).length
}

/** What to say about them: the bench cannot show them, and they are written anyway. */
export function foreignNotice(count: number): string {
  return `${count} ${count === 1 ? 'piece here was' : 'pieces here were'} built under another key, so ${count === 1 ? 'it shows' : 'they show'} as a placeholder here. DEPLOY and PUBLISH write ${count === 1 ? 'it' : 'them'} under this key.`
}

/**
 * `model` as it goes out in the clear, as a public object or an avatar, with
 * the table entries no placement names left out: an entry no placement names
 * is carried to everyone and drawn by none (DECK-0003 §1.10), and in the
 * clear it is a piece its author removed. A fetched object's own table still
 * answers beneath it, so nothing is lost there. A table taken from a bag is
 * kept out before this, where its writer is asked (withoutCarried).
 */
export function placedOnly(model: ShardModel): ShardModel {
  if (!model.objects) return model
  return carryReached(model, () => null, authorOf(model))
}

/**
 * sno-core carryAll with `lookup`, and the entries no placement reaches
 * pruned (DECK-0003 §1.10), but only when every placement under your key
 * could be looked inside: one that could not (a LIVE LINK to your own object,
 * not opened here) may reach an entry through the table, which the root's
 * table answers at every depth, and what cannot be seen is not pruned. A
 * placement of someone else's object never blocks it, since keys under
 * their name in your table count for nothing (review of the stack).
 */
export function carryReached(model: ShardModel, lookup: (ref: Ref) => CarryChoice | null, me: string | null): ShardModel {
  let blind = false
  const mine = me ? `33331:${me}:` : null
  const look = (ref: Ref): CarryChoice | null => {
    const choice = lookup(ref)
    if (!choice && ref[0] === 'a' && (mine === null || ref[1].startsWith(mine))) blind = true
    return choice
  }
  const carried = carryAll(model, look)
  return blind ? carried : carryAll(carried, lookup, { prune: true })
}

/** The bytes a relay is taken to accept for one event, as DECK-0003 §1.8 measures them. */
const RELAY_EVENT_BYTES = 131_072

/**
 * Why an event carrying pieces in the clear is not worth the work of mining it,
 * or null when it fits or carries nothing (D3's words).
 */
export function clearRefusal(event: { content: string; tags: string[][] }, carries: boolean): string | null {
  return carries ? relayRefusal(event) : null
}

/**
 * Why an event is more than a relay takes, in D3's words, or null when it
 * fits: measured with the fields a signer adds (id, pubkey and sig, a
 * timestamp and a nonce tag). Every bag is held to it before it is signed
 * (store/useShards signBag), so no hide reports done for a bag no relay takes.
 */
export function relayRefusal(event: { content: string; tags: string[][] }): string | null {
  const bytes = new TextEncoder().encode(JSON.stringify({ id: '', pubkey: '', sig: '', ...event })).length + 350
  if (bytes <= RELAY_EVENT_BYTES) return null
  return `${Math.ceil(bytes / 1024)}kb of ${RELAY_EVENT_BYTES / 1024}kb may be larger than relays will accept. Keep this part separate.`
}

/**
 * A model taken out of a chest (or a bag) into your keeping, its carried
 * objects keyed under you (DECK-0004 §3.4 "Taking an object that carries its
 * parts", spec #82; chest and door design, R15). A table counts only under
 * the pubkey of the event it travels in, so a copy you later hide under your
 * own key would lose every carried part; instead each carried object keyed
 * under `model.author` (the event it was read from) gets an address of its
 * own, `33331:<you>:<fresh d>`, and every `refs` entry naming it, in the
 * model and in the carried payloads alike, is rewritten to match. Objects
 * placed by an address that is not in the table are links, and stay as they
 * are. Returned with you as its author, so the workshop keeps the table
 * (signedTableOnly). The same model when it carries nothing of its author's.
 */
export function rekeyCarried(model: ShardModel, me: string | null): ShardModel {
  const from = model.author
  if (!me || !from || !model.objects || from === me) return model
  const renamed = new Map<string, string>()
  for (const key of Object.keys(model.objects)) {
    const a = parseAddress(key)
    if (a && a.kind === 33331 && a.pubkey === from) renamed.set(key, `33331:${me}:${uuid()}`)
  }
  if (renamed.size === 0) return model
  const refsOf = <T extends { refs?: unknown }>(x: T): T => {
    if (!Array.isArray(x.refs)) return x
    return { ...x, refs: x.refs.map((r: unknown) => (Array.isArray(r) && r[0] === 'a' && typeof r[1] === 'string' && renamed.has(r[1]) ? ['a', renamed.get(r[1]), ...r.slice(2)] : r)) }
  }
  // The keys go back in code point order (DECK-0003 §1.2): plain string comparison.
  const rewritten: Array<[string, unknown]> = []
  for (const [key, payload] of Object.entries(model.objects)) {
    const next = renamed.get(key)
    if (next) rewritten.push([next, payload && typeof payload === 'object' && !Array.isArray(payload) ? refsOf(payload as { refs?: unknown }) : payload])
  }
  rewritten.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const objects = Object.fromEntries(rewritten)
  return { ...refsOf(model), objects, author: me }
}

/**
 * A model that came out of a bag or a chest: local only, never on the wire,
 * like `author`. The mark names the table entries that came sealed (D1,
 * arkinox's default of 2026-11-04), so your own pieces placed beside them
 * are never left out with them. `true` is the mark as #543 wrote it, for
 * every entry the shard held then (legacyMark reads it so at load).
 */
type Taken = ShardModel & { takenFromBag?: true | string[] }

/** The table entries that came to you sealed: the mark's keys the table still holds. */
export function sealedKeys(model: ShardModel): Set<string> {
  const mark = (model as Taken).takenFromBag
  const table = model.objects ?? {}
  if (mark === true) return new Set(Object.keys(table))
  return new Set((mark ?? []).filter((k) => Object.prototype.hasOwnProperty.call(table, k)))
}

/** `model` marked with `keys` sealed beside what it had, or unmarked when none are. */
export function withSealed(model: ShardModel, keys: Iterable<string>): ShardModel {
  const all = new Set([...sealedKeys(model), ...keys])
  const { takenFromBag: _was, ...rest } = model as Taken
  void _was
  return all.size ? ({ ...rest, takenFromBag: [...all].sort() } as Taken) : rest
}

/** A shard as the workshop stored it: #543's `takenFromBag: true` is every key it held when it loads. */
export function legacyMark(model: ShardModel): ShardModel {
  return (model as Taken).takenFromBag === true ? withSealed({ ...model, takenFromBag: undefined } as ShardModel, Object.keys(model.objects ?? {})) : model
}

/**
 * A model taken into your keeping from where it was hidden: its table keyed under
 * you (rekeyCarried), and every entry of it marked, so that what was sealed does
 * not go public with a PUBLISH (withoutCarried). Only one that carries anything
 * needs the mark, and only one that was sealed: a public object a bag only names
 * (a LIVE LINK) had its table in the clear already (`sealed` false).
 */
export function takeIntoKeeping(model: ShardModel, me: string | null, sealed = true): ShardModel {
  const out = rekeyCarried(model, me)
  return out.objects && sealed ? withSealed(out, Object.keys(out.objects)) : out
}

/** Whether this model carries parts that came to you sealed: publishing them in the clear needs asking. */
export function carriesSealedParts(model: ShardModel): boolean {
  return sealedKeys(model).size > 0
}

/**
 * A model without the parts it carries from where it was hidden, as it goes out in
 * public: those entries, the placements that drew on them, and their refs. Your
 * own pieces carried beside them stay, and so does a placement of a public
 * object. The same model when there is nothing to take out.
 */
export function withoutCarried(model: ShardModel): ShardModel {
  const sealed = sealedKeys(model)
  if (sealed.size === 0) return model
  const refs = model.refs ?? []
  const kept = refs.map((r, i) => [r, i] as const).filter(([r]) => !(r[0] === 'a' && sealed.has(r[1])))
  const index = new Map(kept.map(([, old], now) => [old, now]))
  const parts = (model.parts ?? []).filter((p) => index.has(p.ref)).map((p) => ({ ...p, ref: index.get(p.ref)! }))
  const table = Object.fromEntries(Object.entries(model.objects ?? {}).filter(([k]) => !sealed.has(k)))
  const { objects: _table, takenFromBag: _mark, refs: _refs, parts: _parts, ...rest } = model as Taken
  void _table
  void _mark
  void _refs
  void _parts
  return { ...rest, ...(Object.keys(table).length ? { objects: table } : {}), ...(kept.length ? { refs: kept.map(([r]) => r) } : {}), ...(parts.length ? { parts } : {}) }
}
