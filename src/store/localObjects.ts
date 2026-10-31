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
 * A shard this browser knows was published under another key is not answered
 * for this one: kit pieces have the same ids for everyone who imports them,
 * so after a switch of identity `33331:<new key>:maze-kit/...` could
 * otherwise be drawn from the piece the old key made.
 *
 * Only authoring views ask (lib/parts.ts fetchOwnFirst): the bench, and the
 * workshop's and the chest composer's pictures of your shards. The world, WALK,
 * items and the feeds draw what the relays hold, which is what everyone else
 * sees (arkinox, 2026-10-25: "inline SNO fixes this once it ships because
 * then everyone sees the same data").
 *
 * Every change to the list says which of your addresses changed, at most once
 * a frame (an OPACITY drag is one edit per percent), so each bench draw
 * placing one, at any depth, asks again (lib/parts.ts localObjectsChanged).
 */

import { toPayload, type ShardModel } from 'sno-core/shards'
import { SNO_KIND, objectAddress } from 'sno-core/feed'
import { MAX_PART_DEPTH, carriedModel, carryAll, parseAddress } from 'sno-core/parts'
import { hash53, thumbKeyOf } from '../lib/thumbKey'
import { localObjectsChanged, setLocalObjects } from '../lib/parts'
import { dOf, isQuietD, ownKeysOnly, rekeyTable, setLocalAuthor } from '../lib/carried'
import { withAuthoredConstrain } from '../lib/walkConstrain'
import { usePublished } from './usePublished'
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

/** Your shard at an address, from the workshop, or undefined when it is not yours, not here, or empty. */
export function localShard(address: { kind: number; pubkey: string; d: string }): ShardModel | undefined {
  const me = useCyberspace.getState().identity.pubkey
  if (!me || address.pubkey !== me || address.kind !== SNO_KIND) return undefined
  const s = byId(useWorkshop.getState().shards).get(address.d)
  if (!s || (s.vertices.length === 0 && (s.parts?.length ?? 0) === 0)) return undefined
  const rec = usePublished.getState().ledger[s.id]
  if (rec && rec.pubkey !== me) return undefined
  return s
}

/** Your object at an address, from the workshop, or undefined when it is not yours or not here. */
export function localObject(address: { kind: number; pubkey: string; d: string }): unknown | undefined {
  const s = localShard(address)
  return s ? payloadOf(s) : undefined
}

/**
 * `shard` carrying, in its own table (DECK-0003 §1.10), every piece it places
 * from your library: at any depth, each placement by an `a` reference under
 * your key, with no relay hint, that names a shard in your workshop, published
 * or not (arkinox 2026-10-25: "if i chose my water in my library, then its
 * inlined. if i chose my water from the feed, then its a live reference").
 *
 * A reference with a relay hint is a live link: the Stamp's FEED and BY
 * ADDRESS write one, and it stays a reference, your own published objects
 * included. Someone else's object is never carried, so every key written is
 * under your own pubkey. A piece the table already holds stays exactly as it
 * is, so an edited copy is never replaced by the workshop's piece. Each piece
 * goes in written as a hide writes it, OPAQUE where its author never chose
 * (DECK-0003 §1.12). Run at DEPLOY, EDIT and PUT IN CHEST; the caller checks
 * the size (lib/carried.ts carryRefusal).
 *
 * A piece with no event of its own, whose `d` says something about it (a kit's
 * path, a name), goes in under a `d` that says nothing, because an older reader
 * asks public relays for every carried address (§1.10). A published piece keeps
 * its address, so that reader finds it. What the hide writes names the new
 * address; the workshop's shard is not touched. Every key that goes out is under
 * the signer's pubkey, as a publisher MUST write (§1.10; lib/carried.ts ownKeysOnly).
 */
export function carryLibrary(shard: ShardModel): ShardModel {
  const carried = carryAll(shard, (ref) => {
    if (ref[0] !== 'a' || ref[2]) return null
    const a = parseAddress(ref[1])
    const piece = a ? localShard(a) : undefined
    return piece ? { object: withAuthoredConstrain(piece), carry: true } : null
  })
  const me = useCyberspace.getState().identity.pubkey
  if (!me) return carried
  const held = shard.objects ?? {}
  const ledger = usePublished.getState().ledger
  const quiet = rekeyTable(carried, me, (key) => !Object.prototype.hasOwnProperty.call(held, key) && !isQuietD(dOf(key)) && !ledger[dOf(key)])
  return ownKeysOnly(quiet, me)
}

/** A piece's version for a picture key: a hash of its payload, once per version of it, the same in every session. */
const versions = new WeakMap<ShardModel, string>()
function versionOf(s: ShardModel): string {
  let v = versions.get(s)
  if (v === undefined) versions.set(s, (v = hash53(JSON.stringify(payloadOf(s)))))
  return v
}

/**
 * The picture key of a shard of yours drawn with your own pieces (hud/ShardThumb
 * `own`): its shape's key, and the version of every piece of yours it places
 * from the workshop, at any depth (§1.10's four), so editing a piece draws
 * every picture placing it again. A piece the shard carries in its own table
 * (§1.10) is drawn from there, never the workshop, and the shape's key holds
 * the table already, so only what it places through it is looked for here.
 *
 * Whenever the shard names any address of yours the key is an own key, even
 * when none of those pieces is in the workshop yet: drawn here they may be
 * answered from the workshop later, and a picture drawn that way must never
 * be kept under the key the world's picture of the same shape uses. The
 * shape's key alone only when it names nothing of yours.
 */
export function ownThumbKey(shard: ShardModel): string {
  const me = useCyberspace.getState().identity.pubkey
  const list = byId(useWorkshop.getState().shards)
  const table = shard.objects ?? {}
  const stamps: string[] = []
  const seen = new Set<string>()
  let mine = false
  const walk = (s: ShardModel, depth: number): void => {
    if (depth > MAX_PART_DEPTH) return
    for (const r of s.refs ?? []) {
      const a = r[0] === 'a' ? parseAddress(r[1]) : null
      if (!a || a.kind !== SNO_KIND || a.pubkey !== me || seen.has(a.d)) continue
      seen.add(a.d)
      mine = true
      if (Object.prototype.hasOwnProperty.call(table, r[1])) {
        const held = carriedModel(table, r[1])
        if (held) walk(held, depth + 1)
        continue
      }
      const piece = list.get(a.d)
      if (!piece || localObject(a) === undefined) continue
      stamps.push(`${a.d}@${versionOf(piece)}`)
      walk(piece, depth + 1)
    }
  }
  walk(shard, 1)
  const base = thumbKeyOf(shard)
  return mine ? `${base}:own:${hash53(stamps.join('|'))}` : base
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

/** Addresses changed since the last frame, said together on the next. */
let due = new Set<string>()
let scheduled = false
const nextFrame = (fn: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn)
  else setTimeout(fn, 0)
}

/** Say now what has changed since the last frame (tests; the next frame does it otherwise). */
export function flushLocalObjects(): void {
  scheduled = false
  const keys = due
  due = new Set()
  localObjectsChanged(keys)
}

function announce(pubkey: string, ids: Iterable<string>): void {
  for (const id of ids) due.add(`a:${objectAddress(pubkey, id)}`)
  if (due.size === 0 || scheduled) return
  scheduled = true
  nextFrame(() => { if (scheduled) flushLocalObjects() })
}

let wired: (() => void) | null = null

/** Answer your own references from the workshop, and say when they change. Once; the return undoes it (tests). */
export function wireLocalObjects(): () => void {
  if (wired) return wired
  setLocalObjects(localObject)
  // A model made here is yours (lib/carried.ts authorOf).
  setLocalAuthor(() => useCyberspace.getState().identity.pubkey || null)
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
  // A record of a publish under another key takes a shard out of what is answered here (and its removal puts it back).
  const offLedger = usePublished.subscribe((s, prev) => {
    if (s.ledger === prev.ledger) return
    const me = useCyberspace.getState().identity.pubkey
    if (!me) return
    const ids = new Set([...Object.keys(s.ledger), ...Object.keys(prev.ledger)])
    announce(me, [...ids].filter((id) => s.ledger[id]?.pubkey !== prev.ledger[id]?.pubkey))
  })
  wired = () => { offShards(); offIdentity(); offLedger(); setLocalObjects(null); setLocalAuthor(null); due = new Set(); scheduled = false; wired = null }
  return wired
}
