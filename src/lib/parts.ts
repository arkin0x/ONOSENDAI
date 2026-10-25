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
 * Your own objects are answered from your workshop first (setLocalObjects,
 * wired by store/localObjects.ts), before any relay is asked: a kit imported
 * with PUBLISH off places pieces no relay has ("we never published the parts
 * and i dont want to", arkinox 2026-10-25), and a piece you are editing is
 * drawn as you left it, not as you last published it. An edit of one says so
 * (localObjectsChanged), and every draw that placed it, at any depth, asks
 * again.
 */

import { useEffect, useRef, useState } from 'react'
import { MAX_PART_DEPTH, parseAddress, refKey, resolveParts, type Placed } from 'sno-core/parts'
import { MAX_UNIT, fromPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { GENERAL_RELAYS } from './contacts'
import { queryAny, relaySet } from './relay'

const SNO_KIND = 33331
/** How long one reference waits on the relays before it is drawn as a placeholder. */
const FETCH_WAIT_MS = 5000

const cache = new Map<string, Promise<unknown>>()

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
 * Some of your own objects changed here, by reference key (refKey): what is
 * held for them is dropped, and every draw that placed one asks again.
 */
export function localObjectsChanged(keys: ReadonlySet<string>): void {
  if (keys.size === 0) return
  for (const k of keys) cache.delete(k)
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

/** The payload a reference names, parsed, or null. The newest version of an `a`; the one event of an `e`. */
export function fetchRef(ref: Ref): Promise<unknown> {
  const mine = localPayload(ref)
  if (mine !== undefined) return Promise.resolve(mine)
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
    try { return JSON.parse(ev.content) } catch { return null }
  })()
  cache.set(key, got)
  void got.then((p) => { if (p == null && cache.get(key) === got) cache.delete(key) }, () => { if (cache.get(key) === got) cache.delete(key) })
  return got
}

/** Answer a reference from here instead of a relay: for tests and the dev harness. */
export function primeRef(ref: Ref, payload: unknown): void {
  cache.set(refKey(ref), Promise.resolve(payload))
}

/**
 * Drop a reference from the cache, after publishing a new version of the
 * object it names (store/usePublished.ts), so the next draw of anything that
 * places it fetches that version rather than the one held here. Ported from
 * snocrash's forgetRef.
 */
export function forgetRef(ref: Ref): void {
  cache.delete(refKey(ref))
}

/** What a reference resolved to, whatever its placement: its object and that object's own parts. */
export type Resolved = Pick<Placed, 'model' | 'missing' | 'children'>

/**
 * Every object `shard` places, resolved, keyed by reference. Keyed by
 * reference rather than by placement so moving a placement redraws at once
 * and only a new reference waits for a fetch. Until the first answer the map
 * is empty and nothing is drawn for the parts; after that the previous answer
 * stays up while a new one is fetched, so an edit never flashes them away.
 */
export function useResolved(shard: ShardModel | null): Map<string, Resolved> {
  const [byRef, setByRef] = useState<Map<string, Resolved>>(() => new Map())
  // Bumped when one of your own objects this draw placed, at any depth, is edited here.
  const [again, setAgain] = useState(0)
  const touched = useRef<Set<string>>(new Set())
  const refs = shard?.refs ?? []
  const key = refs.map(refKey).join('|')
  useEffect(() => onLocalObjects((changed) => {
    for (const k of changed) if (touched.current.has(k)) { setAgain((n) => n + 1); return }
  }), [])
  useEffect(() => {
    touched.current = new Set(refs.map(refKey))
    if (!shard || refs.length === 0) { setByRef((m) => (m.size ? new Map() : m)); return }
    let live = true
    // One placement per reference is enough: what a reference resolves to does not depend on where it stands.
    const probe: ShardModel = { ...shard, parts: refs.map((_, i) => ({ ref: i, at: [0, 0, 0], turn: [0, 0, 0], step: 0 })) }
    void resolveParts(probe, fetchRef).then((placed) => {
      if (!live) return
      touched.current = touchedKeys(placed, new Set(refs.map(refKey)))
      const m = new Map<string, Resolved>()
      placed.forEach((p) => m.set(refKey(p.ref), { model: p.model, missing: p.missing, children: p.children }))
      setByRef(m)
    })
    return () => { live = false }
    // The references, not the shard: a placement moving needs no new fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, again])
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

/**
 * sno-core resolveParts, rule for rule (§1.10: the depth, loops, scale,
 * placeholders), except that each placed object is read from its payload
 * once for the whole app rather than once a call. WALK resolves the parts of
 * every shard around you on the way in (store/walkWalls.ts), and read once a
 * call, a world of rooms placed by reference read every room again for
 * every shard that places it, in one go: 160 MB of models made and thrown
 * away for 24 small mazes, and the tab frozen while it happened (arkinox,
 * 2026-10-23: "I was at 1.9GB and then I went into walk mode, it froze, and
 * then I was suddenly at 6.9GB"). parts.test.ts holds the two side by side.
 */
export async function resolvePartsShared(model: ShardModel, fetch: (ref: Ref) => Promise<unknown> = fetchRef, self?: Ref): Promise<Placed[]> {
  const cache = new Map<string, Promise<ShardModel | 'unreachable' | 'invalid'>>()
  const load = (ref: Ref): Promise<ShardModel | 'unreachable' | 'invalid'> => {
    const key = refKey(ref)
    let got = cache.get(key)
    if (!got) {
      got = fetch(ref).then((payload) => (payload == null ? 'unreachable' : parseShared(payload, key)), () => 'unreachable' as const)
      cache.set(key, got)
    }
    return got
  }
  const walk = async (m: ShardModel, depth: number, chain: Set<string>): Promise<Placed[]> => {
    const refs = m.refs ?? []
    return Promise.all((m.parts ?? []).map(async (part): Promise<Placed> => {
      const ref = refs[part.ref]
      const key = refKey(ref)
      const miss = (missing: NonNullable<Placed['missing']>): Placed => ({ part, ref, model: null, missing, children: [] })
      if (chain.has(key)) return miss('cycle')
      if (depth > MAX_PART_DEPTH) return miss('deep')
      const got = await load(ref)
      if (typeof got === 'string') return miss(got)
      if (got.unit + part.step < 0 || got.unit + part.step > MAX_UNIT) return miss('scale')
      const children = got.parts ? await walk(got, depth + 1, new Set([...chain, key])) : []
      return { part, ref, model: got, children }
    }))
  }
  return walk(model, 1, new Set(self ? [refKey(self)] : []))
}
