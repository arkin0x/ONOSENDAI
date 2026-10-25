/**
 * localObjects.ts - your own objects, answered from your workshop before any
 * relay (lib/parts.ts setLocalObjects).
 *
 * An object placed by reference names its author's address,
 * `33331:<pubkey>:<d>`, and a workshop shard's id is the `d` it is published
 * under (lib/published.ts publicObjectTemplate), as a kit's piece's stable id
 * is after a zip import (lib/shardZip.ts resolveRefs). So a reference naming
 * the identity at hand and the id of one of its shards here is that shard,
 * published or not: a kit imported with PUBLISH off draws whole on the bench
 * instead of as placeholders ("we never published the parts and i dont want
 * to", arkinox 2026-10-25), and a piece is drawn as last edited here rather
 * than as last published. Anyone else's reference, and yours to a shard this
 * browser does not hold, still goes to the relays.
 *
 * Every change to the list says which of your addresses changed, so each
 * draw placing one asks again (lib/parts.ts localObjectsChanged), and an item
 * wearing one is measured again (hooks/useItemModel.ts forgetItemModel).
 */

import { toPayload, type ShardModel } from 'sno-core/shards'
import { objectAddress } from 'sno-core/feed'
import { localObjectsChanged, setLocalObjects } from '../lib/parts'
import { withAuthoredConstrain } from '../lib/walkConstrain'
import { forgetItemModel } from '../hooks/useItemModel'
import { useCyberspace } from './useCyberspace'
import { useWorkshop } from './useWorkshop'

/**
 * The payload of a shard, made once per version of it: a shard object is
 * replaced, never changed, on every edit, so the same version gives the same
 * payload object, and lib/parts.ts reads each payload into a model once.
 * Written as a publish would write it (OPAQUE where its author never chose).
 */
const payloads = new WeakMap<ShardModel, unknown>()
function payloadOf(s: ShardModel): unknown {
  let p = payloads.get(s)
  if (p === undefined) payloads.set(s, (p = toPayload(withAuthoredConstrain(s))))
  return p
}

/** The list by id, once per list. */
const indexes = new WeakMap<readonly ShardModel[], Map<string, ShardModel>>()
function byId(list: readonly ShardModel[]): Map<string, ShardModel> {
  let m = indexes.get(list)
  if (!m) indexes.set(list, (m = new Map(list.map((s) => [s.id, s]))))
  return m
}

/** Your object at an address, from the workshop, or undefined when it is not yours or not here. */
export function localObject(address: { kind: number; pubkey: string; d: string }): unknown | undefined {
  const me = useCyberspace.getState().identity.pubkey
  if (!me || address.pubkey !== me) return undefined
  const s = byId(useWorkshop.getState().shards).get(address.d)
  if (!s || (s.vertices.length === 0 && (s.parts?.length ?? 0) === 0)) return undefined
  return payloadOf(s)
}

/** The ids whose shard is not the same object in both lists: added, edited or removed. */
export function changedIds(prev: readonly ShardModel[], next: readonly ShardModel[]): string[] {
  const before = byId(prev)
  const after = byId(next)
  const out: string[] = []
  for (const [id, s] of after) if (before.get(id) !== s) out.push(id)
  for (const id of before.keys()) if (!after.has(id)) out.push(id)
  return out
}

function announce(pubkey: string, ids: Iterable<string>): void {
  const keys = new Set<string>()
  for (const id of ids) {
    const address = objectAddress(pubkey, id)
    keys.add(`a:${address}`)
    forgetItemModel(address)
  }
  localObjectsChanged(keys)
}

let wired: (() => void) | null = null

/** Answer your own references from the workshop, and say when they change. Once; the return undoes it (tests). */
export function wireLocalObjects(): () => void {
  if (wired) return wired
  setLocalObjects(localObject)
  const offShards = useWorkshop.subscribe((s, prev) => {
    if (s.shards === prev.shards) return
    const me = useCyberspace.getState().identity.pubkey
    if (me) announce(me, changedIds(prev.shards, s.shards))
  })
  // Another identity: what was yours is not, and what is now yours is.
  const offIdentity = useCyberspace.subscribe((s, prev) => {
    if (s.identity.pubkey === prev.identity.pubkey) return
    const ids = useWorkshop.getState().shards.map((x) => x.id)
    if (prev.identity.pubkey) announce(prev.identity.pubkey, ids)
    if (s.identity.pubkey) announce(s.identity.pubkey, ids)
  })
  wired = () => { offShards(); offIdentity(); setLocalObjects(null); wired = null }
  return wired
}
