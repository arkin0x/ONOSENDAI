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

import { fromPayload, ticksOf, type ShardModel } from 'sno-core/shards'
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
  /** The closed look cut into its body and its lid, with the lid's hinge: the built-in TREASURE's alone. */
  lid?: Lid
}

/**
 * Where a lid turns: a line along X through (y, z) in the model's render
 * frame (model units, as sno-core toRender draws it), and how far it turns
 * up and back to stand as the open look's lid stands, radians about +X.
 */
export interface LidHinge {
  y: number
  z: number
  angle: number
}

/** A closed look as two models: everything but the lid, and the lid. */
export interface Lid {
  body: ShardModel
  lid: ShardModel
  hinge: LidHinge
}

/**
 * The treasure chest's lid: every face wholly at or above 62 ticks (0.52
 * gibson), where the body's walls end and the arch begins
 * (chest-door/models/README.md). The gold band crosses that height and stays
 * with the body.
 */
export const TREASURE_LID_CUT = 62
/**
 * The hinge along the back of the gold band, at its top (64 ticks) and its
 * back face (51.5 ticks behind the middle; the lock plate is at the front,
 * +Z, and the render frame's Z is the wire's, sno-core negating it once
 * into the model and once out), the lid turned 100 degrees up and back:
 * fitted against the owner's open model, where 82 of the lid's 90 points
 * land within two ticks of the open lid's (looks.test.ts).
 */
export const TREASURE_HINGE: LidHinge = { y: 64 / 120, z: -51.5 / 120, angle: -(100 * Math.PI) / 180 }

/**
 * Cut a model in two at a height: the faces whose every corner is at or
 * above `cutTicks` (in Y, the model's own ticks), and the rest, each with
 * only its own points (a point is drawn as a dot, so a shared one would be
 * drawn twice) and its own face colours.
 */
export function splitAt(shard: ShardModel, cutTicks: number): { below: ShardModel; above: ShardModel } {
  const up = shard.vertices.map((v) => ticksOf(v)[1] >= cutTicks)
  const part = (above: boolean, suffix: string): ShardModel => {
    const map = new Map<number, number>()
    const vertices: ShardModel['vertices'] = []
    const faces: ShardModel['faces'] = []
    const facecolors: NonNullable<ShardModel['facecolors']> = []
    shard.faces.forEach((f, i) => {
      if (f.every((k) => up[k]) !== above) return
      faces.push(f.map((k) => {
        let n = map.get(k)
        if (n === undefined) { n = vertices.length; map.set(k, n); vertices.push(shard.vertices[k]) }
        return n
      }) as [number, number, number])
      if (shard.facecolors) facecolors.push(shard.facecolors[i])
    })
    return { ...shard, id: `${shard.id}:${suffix}`, vertices, faces, ...(shard.facecolors ? { facecolors } : {}) }
  }
  return { below: part(false, 'body'), above: part(true, 'lid') }
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
  if (name === 'treasure') {
    const { below, above } = splitAt(closed, TREASURE_LID_CUT)
    look.lid = { body: below, lid: above, hinge: TREASURE_HINGE }
  }
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

/** A point, as a world item's place is. */
interface At { x: bigint; y: bigint; z: bigint }

/**
 * Whether a thing that came out of an opened chest stays in the chest: it
 * is listed under the chest's rows and floats out as loot, and is not drawn
 * again in the world on top of the chest. That is anything out of a chest
 * (not a door) that stands at the chest's own place. One aimed at its own
 * point (a room built in a chest's region, lib/chests.ts revealedIn) is
 * drawn where it stands, as before, until CONVERT TO DOOR moves such rooms
 * behind doors (chest and door design, P4b). Everything behind a door
 * stands in the room. A thing whose chest is not known is drawn, as before.
 */
export function keptInChest(item: { chestId?: string; at: At }, parent: { at: At; tags?: readonly unknown[] } | undefined): boolean {
  if (!item.chestId || !parent || isDoor(parent.tags)) return false
  return item.at.x === parent.at.x && item.at.y === parent.at.y && item.at.z === parent.at.z
}

/** The model drawn for a look: the open one once opened, when it has one, else the closed one; null when an opened look is not drawn. */
export function drawnLook(look: Look, opened: boolean): ShardModel | null {
  if (!opened) return look.closed
  if (look.open) return look.open
  // A door with no open look is not drawn once opened; a chest keeps its closed look (§5.4).
  return look.name === 'door' ? null : look.closed
}
