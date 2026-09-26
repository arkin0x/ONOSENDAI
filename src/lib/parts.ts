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
 */

import { useEffect, useState } from 'react'
import { parseAddress, refKey, resolveParts, type Placed } from 'sno-core/parts'
import type { Ref, ShardModel } from 'sno-core/shards'
import { GENERAL_RELAYS } from './contacts'
import { queryAny, relaySet } from './relay'

const SNO_KIND = 33331
/** How long one reference waits on the relays before it is drawn as a placeholder. */
const FETCH_WAIT_MS = 5000

const cache = new Map<string, Promise<unknown>>()

/** The payload a reference names, parsed, or null. The newest version of an `a`; the one event of an `e`. */
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
  const refs = shard?.refs ?? []
  const key = refs.map(refKey).join('|')
  useEffect(() => {
    if (!shard || refs.length === 0) { setByRef((m) => (m.size ? new Map() : m)); return }
    let live = true
    // One placement per reference is enough: what a reference resolves to does not depend on where it stands.
    const probe: ShardModel = { ...shard, parts: refs.map((_, i) => ({ ref: i, at: [0, 0, 0], turn: [0, 0, 0], step: 0 })) }
    void resolveParts(probe, fetchRef).then((placed) => {
      if (!live) return
      const m = new Map<string, Resolved>()
      placed.forEach((p) => m.set(refKey(p.ref), { model: p.model, missing: p.missing, children: p.children }))
      setByRef(m)
    })
    return () => { live = false }
    // The references, not the shard: a placement moving needs no new fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return byRef
}
