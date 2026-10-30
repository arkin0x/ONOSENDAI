/**
 * looks.ts: what a chest or a door looks like in the world (chest and door
 * design, D2, D3, R14; arkinox, 2026-10-26).
 *
 * A chest used to be the note's cube. It is now a model, placed like a
 * shard: its origin on the chest's place, at its true size. Two built-in
 * looks, each with an open version that swaps in once this identity has
 * opened it (R14):
 *
 *   TREASURE  the owner's own treasure chest (treasure-chest-arkinox.json),
 *             closed, and open with the lid up and gold inside.
 *   DOOR      the Maze Kit's 2 x 3 door slab, closed, and open: slid up into
 *             the lintel, its bottom rail all that shows.
 *
 * The models are the Maze Kit's files as built and checked there
 * (onosendai/chest-door/models/README.md), bundled with the app and read
 * once by sno-core like any payload. Nothing here is written to the wire,
 * and nothing is fetched.
 *
 * A door is a chest that carries a `door` tag (DECK-0004 §3.7, cyberspace
 * PR #82, not yet merged). That tag is only read here, never written: no
 * client writes one until SEAL A DOOR lands. Every chest without it is a
 * chest.
 *
 * THE SEAM for custom looks: `lookOf`. Spec PR #82's `["look", payload]` and
 * `["look", payload, "open"]` tags, once merged, are read there and win over
 * the built-in, with a custom closed look and no open one keeping its closed
 * look when opened (§5.4). Everything that draws a chest or a door asks
 * `lookOf`, so a custom look plugs in at that one function. `lid` is the
 * built-in TREASURE's alone: the hinge is only ever applied to a look whose
 * lid is known.
 */

import { fromPayload, type ShardModel } from 'sno-core/shards'
import chestClosed from './looks/chest.json'
import chestOpen from './looks/chest-open.json'
import doorClosed from './looks/door-standard.json'
import doorOpen from './looks/door-standard-open.json'

/** The built-in looks. */
export type LookName = 'treasure' | 'door'

/** A look: what is drawn while closed, and once opened (null: an opened look is not drawn at all). */
export interface Look {
  name: LookName
  closed: ShardModel
  open: ShardModel | null
}

/** The tag that marks a chest as a door (DECK-0004 §3.7). Read only. */
export const DOOR_TAG = 'door'

/** Whether a chest's tags mark it a door: any `door` tag. */
export function isDoor(tags: readonly unknown[] | undefined): boolean {
  return !!tags && tags.some((t) => Array.isArray(t) && t[0] === DOOR_TAG)
}

const PAYLOADS: Record<LookName, { closed: unknown; open: unknown }> = {
  treasure: { closed: chestClosed, open: chestOpen },
  door: { closed: doorClosed, open: doorOpen },
}

const cache = new Map<LookName, Look>()

/** A built-in look, read once and shared by every chest that wears it. */
export function builtInLook(name: LookName): Look {
  const held = cache.get(name)
  if (held) return held
  const p = PAYLOADS[name]
  const closed = fromPayload(p.closed, `look:${name}`)
  if (!closed) throw new Error(`the built-in ${name} look does not parse`)
  const look: Look = { name, closed, open: fromPayload(p.open, `look:${name}:open`) }
  cache.set(name, look)
  return look
}

/** What lookOf reads: a chest, and its event's tags when known. */
export interface LookSubject {
  type: string
  event?: { tags: readonly unknown[] } | null
}

/**
 * The look a chest or a door wears, or null for anything else. The built-in
 * for now: TREASURE for a chest, DOOR for a door. A custom `look` (spec PR
 * #82) will be read here, first.
 */
export function lookOf(item: LookSubject): Look | null {
  if (item.type !== 'chest') return null
  return builtInLook(isDoor(item.event?.tags) ? 'door' : 'treasure')
}

/** The model drawn for a look: the open one once opened, when it has one, else the closed one; null when an opened look is not drawn. */
export function drawnLook(look: Look, opened: boolean): ShardModel | null {
  if (!opened) return look.closed
  if (look.open) return look.open
  // A door with no open look is not drawn once opened; a chest keeps its closed look (§5.4).
  return look.name === 'door' ? null : look.closed
}
