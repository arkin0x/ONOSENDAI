/**
 * parts.ts - fetching the objects an object places (DECK-0003 §1.10), once.
 *
 * sno-core decides what a placement means and what to do when its object is
 * missing (sno-core/parts resolveParts): depth four, a loop is missing, a
 * scale out of range is missing, and missing is a placeholder, never a
 * rejection of the parent. What it cannot do is reach a relay, so this is the
 * fetch it is handed, with one cache for the whole app: a wall of four
 * columns, the bench it is open on and the same wall hidden in the world ask
 * for the column once. Ported from snocrash's lib/parts.ts so both clients
 * draw the same thing.
 *
 * Objects are published by snocrash to the general relays and to the
 * cyberspace relay, so the fetch asks both sets. A reference that found
 * nothing is not remembered: the next draw asks again, since a relay that was
 * slow a moment ago may answer now.
 *
 * In authoring views only, your own objects are answered from your workshop
 * first (fetchOwnFirst, OwnPartsContext; the source is wired by
 * store/localObjects.ts): a kit imported with PUBLISH off places pieces no
 * relay has ("we never published the parts and i dont want to", arkinox
 * 2026-10-25), and a piece you are editing is drawn on the bench as you left
 * it. An edit of one says so (localObjectsChanged), and every bench draw that
 * placed it, at any depth, asks again. Everywhere in the world the relays
 * alone answer, as before, so you see there what finders see.
 *
 * Before any of that, an object's own `objects` (DECK-0003 §1.10): the pieces
 * it carries inside its payload, keyed by the address they are placed by, so
 * that what you hid with unpublished pieces draws the same for everyone who
 * finds it. sno-core looks every placement up there first, at any depth, and
 * never fetches what it holds, so on the bench a carried copy wins over your
 * workshop's piece of the same address: the copy is the parent's own data.
 * Keys under any pubkey but that of the event an object came in are ignored
 * (D5), and that is applied where an object is read from its event
 * (lib/carried.ts keepOwnTable), which also says whose the model is, so every
 * draw passes that pubkey on (authorOf); a model made here is yours.
 */

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Fetched, MAX_PLACED, parseAddress, refKey, resolveParts, type Placed } from 'sno-core/parts'
import { authorOf } from './carried'
import { giveReads, onReadsBack, readCap, takeReads, type ReadPool } from './readPools'
import { chargeByTrust } from './trust'
import { fromPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { GENERAL_RELAYS } from './contacts'
import { queryAny, relaySet } from './relay'

const SNO_KIND = 33331
/** How long one reference waits on the relays before it is drawn as a placeholder. */
const FETCH_WAIT_MS = 5000

const cache = new Map<string, Promise<unknown>>()
/** What fetchRef has already been answered for, by reference key: for fetchSettled. */
const settled = new Map<string, unknown>()

/**
 * Your own object at an address, from this browser rather than a relay: its
 * payload, or undefined when the address is not one of yours held here.
 */
export type LocalObjects = (address: { kind: number; pubkey: string; d: string }) => unknown | undefined
let local: LocalObjects | null = null
const localListeners = new Set<(keys: ReadonlySet<string>) => void>()

/** Answer your own references from here (store/localObjects.ts), or stop (null). */
export function setLocalObjects(source: LocalObjects | null): void {
  local = source
}

/** The payload a local answer gives for a reference, or undefined. Only an `a`: an `e` names one signed event. */
function localPayload(ref: Ref): unknown | undefined {
  if (!local || ref[0] !== 'a') return undefined
  const a = parseAddress(ref[1])
  return a && a.kind === SNO_KIND ? local(a) : undefined
}

/**
 * Some of your own objects changed here, by reference key (refKey): every
 * authoring draw that placed one asks again. What the relays hold for them is
 * not touched: an edit here changes nothing there.
 */
export function localObjectsChanged(keys: ReadonlySet<string>): void {
  if (keys.size === 0) return
  for (const l of localListeners) l(keys)
}

/** Hear of localObjectsChanged; the return stops it. */
export function onLocalObjects(listener: (keys: ReadonlySet<string>) => void): () => void {
  localListeners.add(listener)
  return () => { localListeners.delete(listener) }
}

/** Every reference a resolved tree touched, found or not, at any depth. */
export function touchedKeys(placed: readonly Placed[], into: Set<string> = new Set()): Set<string> {
  for (const p of placed) { into.add(refKey(p.ref)); touchedKeys(p.children, into) }
  return into
}

/**
 * Your own object from your workshop, else what the relays hold (fetchRef).
 * For authoring views only: the bench (through OwnPartsContext), the
 * workshop's pictures of your shards. The world never asks this way: what is
 * hidden there is drawn from what everyone else can fetch, so you see what
 * finders see (arkinox, 2026-10-25: "inline SNO fixes this once it ships
 * because then everyone sees the same data").
 */
export function fetchOwnFirst(ref: Ref): Promise<unknown> {
  const mine = localPayload(ref)
  return mine !== undefined ? Promise.resolve(mine) : fetchRef(ref)
}

/**
 * Whether the draws under it answer your own references from your workshop
 * first (fetchOwnFirst). False, the default, everywhere in the world; the
 * bench provides true inside its own canvas.
 */
export const OwnPartsContext = createContext(false)

/** The payload a reference names, parsed, or null. The newest version of an `a`; the one event of an `e`. From the relays only. */
export function fetchRef(ref: Ref): Promise<unknown> {
  const key = refKey(ref)
  const held = cache.get(key)
  if (held) return held
  const hint = typeof ref[2] === 'string' && /^wss?:\/\//.test(ref[2]) ? [ref[2]] : []
  const relays = [...new Set([...hint, ...relaySet(), ...GENERAL_RELAYS])]
  const got = (async (): Promise<unknown> => {
    let filter
    if (ref[0] === 'a') {
      const a = parseAddress(ref[1])
      if (!a) return null
      filter = { kinds: [a.kind], authors: [a.pubkey], '#d': [a.d] }
    } else filter = { ids: [ref[1]] }
    const found = await queryAny(relays, filter, FETCH_WAIT_MS)
    // Several relays may each hold a different edit; the newest is the object.
    const ev = found.sort((x, y) => y.created_at - x.created_at)[0]
    if (!ev || ev.kind !== SNO_KIND) return null
    let payload: unknown
    try { payload = JSON.parse(ev.content) } catch { return null }
    // By `e`, whose event it is goes with it, so what it carries counts under
    // its signer (sno-core Fetched; an `a` names its author already).
    return ref[0] === 'e' ? new Fetched(payload, ev.pubkey) : payload
  })()
  cache.set(key, got)
  void got.then((p) => {
    if (cache.get(key) !== got) return
    if (p == null) cache.delete(key)
    else settled.set(key, p)
  }, () => { if (cache.get(key) === got) cache.delete(key) })
  return got
}

/**
 * What fetchRef already holds for a reference, without asking any relay: the
 * payload a relay answered earlier, or null. WALK's walls build a shard first
 * from this and from what the shard carries, which lands within the task, so
 * a step never passes a shard before it is built (store/walkWalls.ts); what
 * still needs a relay is fetched after, its shard's own faces standing.
 */
export function fetchSettled(ref: Ref): Promise<unknown> {
  return Promise.resolve(settled.get(refKey(ref)) ?? null)
}

/** Answer a reference from here instead of a relay: for tests and the dev harness. */
export function primeRef(ref: Ref, payload: unknown): void {
  const got = Promise.resolve(payload)
  cache.set(refKey(ref), got)
  void got.then((p) => { if (p != null && cache.get(refKey(ref)) === got) settled.set(refKey(ref), p) })
}

/**
 * Drop a reference from the cache, after publishing a new version of the
 * object it names (store/usePublished.ts), so the next draw of anything that
 * places it fetches that version rather than the one held here. Ported from
 * snocrash's forgetRef.
 */
export function forgetRef(ref: Ref): void {
  cache.delete(refKey(ref))
  settled.delete(refKey(ref))
}

/** What a reference resolved to, whatever its placement: its object and that object's own parts, and whether a table carried it. */
export type Resolved = Pick<Placed, 'model' | 'missing' | 'children' | 'carried'>

/**
 * Every object `shard` places, resolved, keyed by reference. Keyed by
 * reference rather than by placement so moving a placement redraws at once
 * and only a new reference waits for a fetch. Until the first answer the map
 * is empty and nothing is drawn for the parts; after that the previous answer
 * stays up while a new one is fetched, so an edit never flashes them away.
 */
/** Whether anything a resolve placed, at any depth, was cut for reads (sno-core 'objects'). */
function cutForReads(placed: readonly Placed[]): boolean {
  return placed.some(function short(p): boolean { return p.missing === 'objects' || p.children.some(short) })
}

/** A share of a read pool one resolve holds: given, and given back so far. */
interface Held { pool: ReadPool; share: { left: number }; given: number; back: number }

export function useResolved(shard: ShardModel | null, pool?: ReadPool): Map<string, Resolved> {
  const own = useContext(OwnPartsContext)
  const [byRef, setByRef] = useState<Map<string, Resolved>>(() => new Map())
  // On the bench only: bumped when one of your own objects this draw placed,
  // at any depth, is edited here, or when anything of yours is edited while a
  // resolve is still waiting (its deeper references are not known yet).
  const [again, setAgain] = useState(0)
  const touched = useRef<Set<string>>(new Set())
  const pending = useRef(false)
  // An edit of yours heard while a resolve was waiting: resolve once more after
  // it lands, rather than restart it and ask the relays again for parts that
  // had already come back empty.
  const dirty = useRef(false)
  const refs = shard?.refs ?? []
  const key = refs.map(refKey).join('|')
  // The carried objects (§1.10), by identity: an edit of a carried copy makes a
  // new table, and every placement drawn from it must be read again.
  const carried = shard?.objects
  const listens = own && refs.length > 0
  useEffect(() => {
    if (!listens) return
    return onLocalObjects((changed) => {
      if (pending.current) { dirty.current = true; return }
      for (const k of changed) if (touched.current.has(k)) { setAgain((n) => n + 1); return }
    })
  }, [listens])
  // The read pools this draw was cut short by, for want of reads in them (not
  // by its own share's ceiling): resolved again when reads come back to one.
  const starvedOf = useRef<Set<ReadPool>>(new Set())
  useEffect(() => {
    if (!pool) return
    return onReadsBack((back) => { if (!pending.current && starvedOf.current.has(back)) setAgain((n) => n + 1) })
  }, [pool])
  useEffect(() => {
    touched.current = new Set(refs.map(refKey))
    dirty.current = false
    if (!shard || refs.length === 0) { pending.current = false; setByRef((m) => (m.size ? new Map() : m)); return }
    let live = true
    let landed = false
    pending.current = true
    starvedOf.current = new Set()
    // One placement per reference is enough: what a reference resolves to does not depend on where it stands.
    const probe: ShardModel = { ...shard, parts: refs.map((_, i) => ({ ref: i, at: [0, 0, 0], turn: [0, 0, 0], step: 0 })) }
    // In the scene: what it reads is charged to its pool (lib/readPools.ts), a
    // stranger's object under a trusted shard to the strangers'.
    const held: Held[] = []
    const share = (from: ReadPool): { left: number; models: { left: number } } => {
      const models = takeReads(from)
      held.push({ pool: from, share: models, given: models.left, back: 0 })
      return { left: MAX_PLACED, models }
    }
    const mine = pool ? share(pool) : undefined
    const charge = mine && pool === 'trusted' ? chargeByTrust(mine, () => share('stranger')) : undefined
    /** Give back what `h` holds beyond what it read (`keep`), or all of it. */
    const giveBack = (keep: boolean): void => {
      for (const h of held) {
        const n = keep ? h.share.left : h.given - h.back
        if (keep) h.share.left = 0
        h.back += Math.max(0, n)
        giveReads(h.pool, n)
      }
    }
    // Shared, so a part whose payload did not change keeps its model object
    // across an edit of its sibling, and its mesh keeps its geometry: an
    // OPACITY drag on one piece must not rebuild everything placing it.
    void resolvePartsShared(probe, own ? fetchOwnFirst : fetchRef, undefined, mine, charge).then((placed) => {
      landed = true
      // Drawn no more, or resolving again: everything it held goes back.
      if (!live) { giveBack(false); return }
      // What it did not read goes back now; what it read, when it is drawn no more.
      if (cutForReads(placed)) for (const h of held) if (h.given < readCap(h.pool)) starvedOf.current.add(h.pool)
      giveBack(true)
      pending.current = false
      touched.current = touchedKeys(placed, new Set(refs.map(refKey)))
      const m = new Map<string, Resolved>()
      placed.forEach((p) => m.set(refKey(p.ref), { model: p.model, missing: p.missing, children: p.children, ...(p.carried ? { carried: p.carried } : {}) }))
      setByRef(m)
      if (dirty.current) { dirty.current = false; setAgain((n) => n + 1) }
    })
    // Still resolving, it may read until it lands: what it holds goes back then.
    return () => { live = false; if (landed) giveBack(false) }
    // The references and the table, not the shard: a placement moving needs no new fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, carried, again, own])
  return byRef
}

/**
 * Payloads already read into models, by the payload object fetchRef keeps
 * for its reference, then by the key the model was read under. A payload
 * object is never changed after it is fetched, so the model read from it is
 * the same every time; once read, it is read for everyone.
 */
const parsed = new WeakMap<object, Map<string, ShardModel | 'invalid'>>()

function parseShared(payload: unknown, key: string): ShardModel | 'invalid' {
  if (typeof payload !== 'object' || payload === null) return fromPayload(payload, key) ?? 'invalid'
  let byKey = parsed.get(payload)
  if (!byKey) parsed.set(payload, (byKey = new Map()))
  let m = byKey.get(key)
  if (m === undefined) byKey.set(key, (m = fromPayload(payload, key) ?? 'invalid'))
  return m
}

/** parseShared as sno-core's resolveParts wants a read: null for a payload §1.9 refuses. */
function readShared(payload: unknown, key: string): ShardModel | null {
  const m = parseShared(payload, key)
  return m === 'invalid' ? null : m
}

/**
 * sno-core resolveParts (§1.10: the carried objects first, the depth, loops,
 * scale, placeholders), with each placed object read from its payload once
 * for the whole app rather than once a call. WALK resolves the parts of
 * every shard around you on the way in (store/walkWalls.ts), and read once a
 * call, a world of rooms placed by reference read every room again for
 * every shard that places it, in one go: 160 MB of models made and thrown
 * away for 24 small mazes, and the tab frozen while it happened (arkinox,
 * 2026-10-23: "I was at 1.9GB and then I went into walk mode, it froze, and
 * then I was suddenly at 6.9GB"). A carried entry is a payload object held
 * by its parent's table, so it too is read once while the table holds it.
 * partsShared.test.ts holds the two side by side.
 */
export function resolvePartsShared(
  model: ShardModel,
  fetch: (ref: Ref) => Promise<unknown> = fetchRef,
  self?: Ref,
  budget?: { left: number },
  budgetFor?: (author: string | null, parent: { left: number }) => { left: number },
): Promise<Placed[]> {
  // Whose keys of its table count: the event's it was read from, or yours for
  // a model made here (lib/carried.ts authorOf), never every key. `budget`, when
  // given, is shared with every other resolve handed the same one (WALK's
  // walls); `budgetFor` charges each placement to a budget by whose object it
  // places (sno-core 0.1.22).
  return resolveParts(model, fetch, { self, read: readShared, author: authorOf(model), ...(budget ? { budget } : {}), ...(budgetFor ? { budgetFor } : {}) })
}
