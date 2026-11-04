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
import { uuid, type ShardModel } from 'sno-core/shards'
import { parseAddress } from 'sno-core/parts'

/**
 * `model` as read from an event whose pubkey is `pubkey`: its author set
 * (sno-core withAuthor, local only, never written) and only the carried
 * objects keyed under that pubkey kept. A key under anyone else's is ignored,
 * and its address fetched as though the table did not hold it (D5, arkinox
 * 2026-10-25; the spec's "keys are under the author's own pubkey"). With no
 * pubkey to check against, nothing carried is honoured. Applied wherever an
 * object is read from its event; for an unsigned item, the pubkey is the bag's
 * or the chest's signer, never the item's own claim.
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

/** A model that came out of a bag or a chest: local only, never on the wire, like `author`. */
type Taken = ShardModel & { takenFromBag?: true }

/**
 * A model taken into your keeping from where it was hidden: its table keyed under
 * you (rekeyCarried), and marked, so that what was sealed does not go public with
 * a PUBLISH (withoutCarried). Only one that carries anything needs the mark.
 */
export function takeIntoKeeping(model: ShardModel, me: string | null): ShardModel {
  const out = rekeyCarried(model, me)
  return out.objects ? ({ ...out, takenFromBag: true } as Taken) : out
}

/** Whether this model carries parts that came to you sealed: publishing them in the clear needs asking. */
export function carriesSealedParts(model: ShardModel): boolean {
  return !!(model as Taken).takenFromBag && !!model.objects && Object.keys(model.objects).length > 0
}

/**
 * A model without the parts it carries from where it was hidden, as it goes out in
 * public: the table, the placements that drew on it, and their refs. A placement
 * of a public object stays. The same model when there is nothing to take out.
 */
export function withoutCarried(model: ShardModel): ShardModel {
  if (!carriesSealedParts(model)) return model
  const carried = new Set(Object.keys(model.objects ?? {}))
  const refs = model.refs ?? []
  const kept = refs.map((r, i) => [r, i] as const).filter(([r]) => !(r[0] === 'a' && carried.has(r[1])))
  const index = new Map(kept.map(([, old], now) => [old, now]))
  const parts = (model.parts ?? []).filter((p) => index.has(p.ref)).map((p) => ({ ...p, ref: index.get(p.ref)! }))
  const { objects: _table, takenFromBag: _mark, refs: _refs, parts: _parts, ...rest } = model as Taken
  void _table
  void _mark
  void _refs
  void _parts
  return { ...rest, ...(kept.length ? { refs: kept.map(([r]) => r) } : {}), ...(parts.length ? { parts } : {}) }
}
