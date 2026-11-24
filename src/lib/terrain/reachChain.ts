/**
 * reachChain.ts - what an author's movement chain says about their builder
 * keys and their reach (DECK-0009 §4.4, §6.2).
 *
 * A reach event counts when it is a real position (a spawn, a hop, a
 * sidestep, a hyperspace action, an exit: the chain's `base` and `exit`
 * roles, never an action inside a virtual bracket or a skipped one) on the
 * stretch of the chain the chain rules accept (lib/chainStop.ts
 * countsThrough, the rule presence uses for everyone's chain). A builder key
 * is valid for it when an action at or before it on that line names the
 * key, none at or before it retires the key, and no action of the author's
 * anywhere retires it with `all`.
 *
 * The line is the chain as buildChain resolves it from the newest spawn: a
 * reach event on a chain a respawn has ended, or on a fork that lost, is not
 * found there, and its layer does not count for now (§4.4: a reader that
 * cannot walk the ancestry treats the key as not valid). Recorded as a
 * limit in the PR.
 */

import { buildChain, type ActionEvent, type NostrEvent } from '../events'
import { countsThrough } from '../chainStop'
import { BUILDER_RETIRE_TAG, BUILDER_TAG } from './builderTags'
import { reachDistance, REACH } from './world'
import type { ChunkBase } from './coords'
import type { ReachPlace } from './layerReader'

/** An author's chain, read once: its line from the newest spawn, how far it counts, and every event by id. */
export interface ReadChain {
  pubkey: string
  line: ActionEvent[]
  /** Actions before this index count (countsThrough). */
  end: number
  byId: Map<string, NostrEvent>
  /** Every movement action of the author's held, on any chain. */
  all: NostrEvent[]
}

/** Read an author's events into a ReadChain. `v1List` is the 5.13 list for old hops (null: taken as they stand). */
export function readChainOf(pubkey: string, events: readonly NostrEvent[], v1List: ReadonlySet<string> | null): ReadChain {
  const own = events.filter((e) => e.pubkey === pubkey && e.kind === 3333)
  const line = buildChain(own, pubkey)
  const { end } = countsThrough(line, v1List)
  return { pubkey, line, end, byId: new Map(own.map((e) => [e.id, e])), all: own }
}

const carries = (ev: NostrEvent | undefined, name: string, key: string): boolean => !!ev && ev.tags.some((t) => t[0] === name && t[1] === key)

/** Whether the author retired `key` with `all` on any action held (§4.3). */
export function retiredAll(c: ReadChain, key: string): boolean {
  return c.all.some((e) => e.tags.some((t) => t[0] === BUILDER_RETIRE_TAG && t[1] === key && t[2] === 'all'))
}

/** Whether the author retired `key` in either form on any action held: such a key cannot list builders (§7.3 rule 3). */
export function retiredAnywhere(c: ReadChain, key: string): boolean {
  return c.all.some((e) => carries(e, BUILDER_RETIRE_TAG, key))
}

/** The index on the line of an action that may be a reach event, or -1. */
function reachIndex(c: ReadChain, id: string): number {
  const i = c.line.findIndex((a) => a.id === id)
  if (i < 0 || i >= c.end) return -1
  const role = c.line[i].role
  return role === 'base' || role === 'exit' ? i : -1
}

/** Whether `key` is valid for a layer whose reach event is line[i] (§4.4 rules 1 to 3). */
function validAt(c: ReadChain, key: string, i: number): boolean {
  let named = false
  for (let j = 0; j <= i; j++) {
    const ev = c.byId.get(c.line[j].id)
    if (carries(ev, BUILDER_RETIRE_TAG, key)) return false
    if (carries(ev, BUILDER_TAG, key)) named = true
  }
  return named && !retiredAll(c, key)
}

/** Of the reach events a layer names, those the key is valid for, with their places (§4.4, §6.2). */
export function reachPlaces(c: ReadChain, key: string, ids: readonly string[]): Map<string, ReachPlace> {
  const out = new Map<string, ReachPlace>()
  for (const id of ids) {
    const i = reachIndex(c, id)
    if (i < 0 || !validAt(c, key, i)) continue
    const a = c.line[i]
    out.set(id, { x: a.position.x, y: a.position.y, z: a.position.z, plane: a.plane })
  }
  return out
}

/**
 * Candidates for the reach event of this device's next layer at a chunk,
 * newest first: actions on its own line that may be reach events, within
 * REACH of the chunk in its plane, at or after the action that named `key`,
 * and valid for it. Which of them the canonical relay holds is the caller's
 * to ask; the newest it holds is the reach event.
 */
export function reachCandidates(c: ReadChain, key: string, namedId: string, chunk: ChunkBase, most = 20): ActionEvent[] {
  const at = c.line.findIndex((a) => a.id === namedId)
  if (at < 0 || at >= c.end) return []
  const out: ActionEvent[] = []
  for (let i = c.end - 1; i >= at && out.length < most; i--) {
    const a = c.line[i]
    if (a.role !== 'base' && a.role !== 'exit') continue
    if (reachDistance({ x: a.position.x, y: a.position.y, z: a.position.z, plane: a.plane }, chunk) > REACH) continue
    if (validAt(c, key, i)) out.push(a)
  }
  return out
}

/** Whether the action that named a key is on the author's line (a respawn starts a line without it). */
export function onLine(c: ReadChain, id: string): boolean {
  const i = c.line.findIndex((a) => a.id === id)
  return i >= 0 && i < c.end
}
