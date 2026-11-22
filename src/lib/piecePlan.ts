/**
 * piecePlan.ts: which pieces a split build places, and the build with its refs
 * renamed to the addresses they go out under (lib/pieces.ts). On its own, with
 * nothing but sno-core under it, so the workshop's store can plan a TAKE too.
 */

import { MAX_PART_DEPTH, parseAddress } from 'sno-core/parts'
import type { Ref, ShardModel } from 'sno-core/shards'

const OBJECT_KIND = 33331

/** A payload as JSON reads it: the fields this file touches are `refs` and `objects`. */
export type Payload = Record<string, unknown>

/** One piece to seal: the address it was placed by, the address it goes out under, its `d`, and its payload as it is sealed. */
export interface PlannedPiece {
  from: string
  address: string
  d: string
  payload: string
  /** Its name, for the words when it is too big. */
  name: string
}

/** The parent with its refs naming the sealed pieces, and every piece to seal. */
export interface PiecePlan {
  parent: ShardModel
  pieces: PlannedPiece[]
}

export const hasKey = (table: unknown, key: string): boolean =>
  !!table && typeof table === 'object' && !Array.isArray(table) && Object.prototype.hasOwnProperty.call(table, key)

/** A ref that may name a piece: an `a` ref of a kind 33331 object under `owner`. With `noHint`, only one without a relay hint (a ref with one is a live link). */
function pieceRef(r: unknown, owner: string, noHint: boolean): string | null {
  if (!Array.isArray(r) || r[0] !== 'a' || typeof r[1] !== 'string') return null
  if (noHint && typeof r[2] === 'string' && r[2].length > 0) return null
  const a = parseAddress(r[1])
  return a && a.kind === OBJECT_KIND && a.pubkey === owner ? r[1] : null
}

/** Refs with each renamed address replaced; a ref's relay hint goes with the old address, since the new object is on no relay yet. */
function renamed<T>(refs: T[], names: ReadonlyMap<string, string>): T[] {
  return refs.map((r) => (Array.isArray(r) && r[0] === 'a' && typeof r[1] === 'string' && names.has(r[1]) ? (['a', names.get(r[1])] as unknown as T) : r))
}

/** A payload's table with only keys under `owner`: a key under anyone else's would be dropped by every reader (§1.10), and it is not yours to seal. */
function ownTable(payload: Payload, owner: string): Payload {
  const table = payload.objects
  if (!table || typeof table !== 'object' || Array.isArray(table)) return payload
  const kept = Object.entries(table as Record<string, unknown>).filter(([k]) => k.startsWith(`${OBJECT_KIND}:${owner}:`))
  const { objects: _all, ...rest } = payload
  void _all
  return kept.length ? { ...rest, objects: Object.fromEntries(kept) } : rest
}

/**
 * The pieces `parent` places, found by `lookup` and planned for sealing:
 * breadth first from the parent's refs, to MAX_PART_DEPTH. `lookup` gives the
 * payload at an address (a workshop piece's), or undefined when that address
 * is not a piece to seal. `noHint` keeps refs with a relay hint out (live
 * links, for a hide from the workshop). An address the root's table holds is
 * drawn from there and is never a piece, nor one a piece's own table holds for
 * it. Each piece gets `newD()`; every ref naming it, in the parent and in the
 * pieces, is rewritten. Synchronous, so a hide plans before it awaits anything
 * (one hide at a time: a second press must find it working).
 */
export function planPiecesNow(
  parent: ShardModel,
  owner: string,
  lookup: (address: string) => Payload | undefined,
  newD: () => string,
  noHint = true,
): PiecePlan {
  const names = new Map<string, string>()
  const found: Array<{ from: string; d: string; payload: Payload }> = []
  let level: Array<{ refs: unknown; table: unknown }> = [{ refs: parent.refs, table: parent.objects }]
  for (let depth = 1; depth <= MAX_PART_DEPTH && level.length > 0; depth++) {
    const next: typeof level = []
    for (const holder of level) {
      if (!Array.isArray(holder.refs)) continue
      for (const r of holder.refs) {
        const address = pieceRef(r, owner, noHint)
        if (!address || names.has(address) || hasKey(parent.objects, address) || hasKey(holder.table, address)) continue
        const got = lookup(address)
        if (!got || typeof got !== 'object' || Array.isArray(got)) continue
        const payload = ownTable(got, owner)
        const d = newD()
        names.set(address, `${OBJECT_KIND}:${owner}:${d}`)
        found.push({ from: address, d, payload })
        next.push({ refs: payload.refs, table: payload.objects })
      }
    }
    level = next
  }
  if (found.length === 0) return { parent, pieces: [] }
  const pieces = found.map(({ from, d, payload }): PlannedPiece => {
    const written = Array.isArray(payload.refs) ? { ...payload, refs: renamed(payload.refs as unknown[], names) } : payload
    return { from, address: names.get(from)!, d, payload: JSON.stringify(written), name: typeof payload.name === 'string' ? payload.name : 'piece' }
  })
  return { parent: { ...parent, refs: renamed(parent.refs ?? [], names) as Ref[] }, pieces }
}

/**
 * planPiecesNow with a lookup that waits (a move opens each piece with its old
 * key, from the relays): each pass asks for the addresses the one before could
 * not answer yet, one depth further each time, until nothing new is asked.
 */
export async function planPieces(
  parent: ShardModel,
  owner: string,
  lookup: (address: string) => Promise<Payload | undefined> | Payload | undefined,
  newD: () => string,
  noHint = true,
): Promise<PiecePlan> {
  const known = new Map<string, Payload | undefined>()
  for (let pass = 0; pass <= MAX_PART_DEPTH; pass++) {
    const asked: string[] = []
    const plan = planPiecesNow(parent, owner, (a) => {
      if (known.has(a)) return known.get(a)
      asked.push(a)
      return undefined
    }, newD, noHint)
    if (asked.length === 0) return plan
    // Each pass's addresses asked together: a relay's wait is paid once a depth, not once a piece.
    const got = await Promise.all(asked.map((a) => lookup(a)))
    asked.forEach((a, i) => known.set(a, got[i]))
  }
  return planPiecesNow(parent, owner, (a) => known.get(a), newD, noHint)
}

