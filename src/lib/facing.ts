/**
 * facing.ts - which way an avatar points.
 *
 * After a hop or a sidestep the avatar turns to face the way it went, so a
 * shape with a front reads as going somewhere. A shard's front is its +Z
 * as held here, in cyberspace axes after the flip, which is the payload's -Z
 * (DECK-0003 §1.18, ruled 2026-11-16) and which the scene draws as render -Z
 * (shards.ts toRender), and it turns
 * about its own center with its top kept to cyberspace up wherever the move
 * allows. Worked out in cyberspace axes and then turned to the view, so the
 * avatar turns with the world when the compass turns it.
 *
 * That is the avatar's PATH facing, the default. An avatar whose payload says
 * `"face": "upright"` (DECK-0003 §1.18; arkinox, 2026-11-16) turns only left
 * and right, never tilting, and keeps its heading on a move straight up or
 * down. Upright is upright to you: its top is your view's up, the up of the
 * world as you have turned it with the 3D compass, which the scene always
 * draws as render +Y (its world group carries no rotation; the compass
 * changes `axes`). So an upright avatar is yawed about render +Y alone, and
 * stays on its feet on your screen however the world is turned. Everyone
 * sees it upright in their own view; facing is presentation, not state.
 */

import { Quaternion, Vector3 } from 'three'
import { drawnFace, type FaceMode } from 'sno-core/face'
import type { ShardModel } from 'sno-core/shards'
import type { AxisDirection, Position, ViewAxes } from './space'
import { composePose, renderPose, viewPose, type Pose, type V3 } from './pose'
import { yawOnly } from './avatarEye'

export type { FaceMode }

/**
 * The render-space direction of a move, under the view's axes (the same
 * mapping the scene draws positions with); null when nothing moved.
 */
export function moveDirection(from: Position, to: Position, axes: ViewAxes): Vector3 | null {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
  const abs = (n: bigint): bigint => (n < 0n ? -n : n)
  const widest = [abs(d.x), abs(d.y), abs(d.z)].reduce((a, b) => (a > b ? a : b), 0n)
  if (widest === 0n) return null
  // Proportions survive the narrowing: each axis as a thousandth of the widest.
  const part = (a: AxisDirection): number => Number((d[a.axis] * 1000n) / widest) / 1000 * a.dir
  return new Vector3(part(axes.right), part(axes.up), part(axes.out)).normalize()
}

/**
 * The two positions whose direction the avatar faces, at a point on the chain.
 *
 * Time decides the angle: the avatar faces the way the move that brought it
 * to this link went. At the head that is the last two links, as before.
 * While scrubbing the chain to link `index`, it is the link before and this
 * one, so the avatar turns as the history is walked rather than keeping the
 * heading it has now. At the spawn there is no move in yet, so it faces the
 * first move out. A chain of one link faces nothing.
 */
export function facingPair<T>(chain: T[], index: number | null): [T, T] | null {
  const n = chain.length
  if (n < 2) return null
  const i = index === null ? n - 1 : Math.max(0, Math.min(n - 1, index))
  if (i === 0) return [chain[0], chain[1]]
  return [chain[i - 1], chain[i]]
}

/** Cyberspace's own axes as a view frame, so moveDirection answers in cyberspace terms. */
const CYBERSPACE: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }
const IDENTITY: Pose = [1, 0, 0, 0, 1, 0, 0, 0, 1]

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (v: V3): V3 => { const n = Math.hypot(...v); return [v[0] / n, v[1] / n, v[2] / n] }

/**
 * Which way an avatar faces after a move, as a pose in cyberspace axes: the
 * nose, model +Z, along the move, and the top, model +Y, toward cyberspace
 * +Y wherever the move allows. A move straight up or down has no up of its
 * own to keep, so the top goes to cyberspace -Z, the side facing away from
 * the black sun. Null when nothing moved.
 *
 * In world terms, like a shard's pose, so the view frame is composed onto it
 * after (avatarTurn). It used to be built in render space with the screen's
 * up as the hint, which made an avatar stay screen-up when the compass turned
 * the world upside down (arkinox, 2026-10-08).
 */
export function facingPose(from: Position, to: Position): Pose | null {
  const d = moveDirection(from, to, CYBERSPACE)
  if (!d) return null
  const f: V3 = [d.x, d.y, d.z]
  const hint: V3 = Math.abs(f[1]) > 0.99 ? [0, 0, -1] : [0, 1, 0]
  const r = unit(cross(hint, f))
  const u = cross(f, r)
  return [r[0], r[1], r[2], u[0], u[1], u[2], f[0], f[1], f[2]]
}

/**
 * The turn an avatar's group carries in the view frame `axes`: its facing
 * after `move` (or none, lying on cyberspace axes as built), with the view
 * frame composed on, as a render-space rotation.
 *
 * This is exactly what a shard gets (pose.ts placedPose), only applied to the
 * group instead of the vertices, so the facing can ease between moves without
 * rebuilding geometry. A compass turn therefore turns every avatar with the
 * world: the one you are, the one you spectate, and everyone in presence.
 */
export function avatarTurn(axes: ViewAxes, move: readonly [Position, Position] | null): Quaternion {
  const facing = move ? facingPose(move[0], move[1]) : null
  return new Quaternion().setFromRotationMatrix(renderPose(composePose(viewPose(axes), facing ?? IDENTITY)))
}

/** How a worn shard turns as it moves (DECK-0003 §1.18): "path" unless its `face` says "upright"; the default avatar turns along its path. */
export function faceOf(shard: Pick<ShardModel, 'extra'> | null | undefined): FaceMode {
  return shard ? drawnFace(shard) : 'path'
}

/** Below this, a move's part across the view's up counts as none: straight up or down (render units of a unit vector). */
const LEVEL_EPS = 1e-6

/**
 * Whether a move has a part across the view's up: anything but straight up
 * or straight down as the view `axes` draws it. Measured on moveDirection, the
 * same thousandths the turn is built from, so a move this calls level is one
 * whose upright turn has a heading to read.
 */
export function crossesUp(from: Position, to: Position, axes: ViewAxes): boolean {
  const d = moveDirection(from, to, axes)
  return d !== null && Math.hypot(d.x, d.z) > LEVEL_EPS
}

/**
 * The two positions an avatar's heading comes from, at a point on the chain,
 * for its facing mode in the view `axes`.
 *
 * PATH is facingPair: the move that brought it to the link on show. UPRIGHT
 * keeps its heading on a move straight up or down (DECK-0003 §1.18), so it
 * walks back from that move to the latest one that went somewhere across the
 * view's up; with none before, the first such move after (as the spawn faces
 * the first move out). Null when no move does, and the upright avatar then
 * stands at rest, turned about up alone (uprightTurn of no move). Which moves
 * count depends on the view: turn the world so X is up and a move along X is
 * a move straight up.
 */
export function headingPair<T extends { position: Position }>(chain: T[], index: number | null, face: FaceMode, axes: ViewAxes): [T, T] | null {
  const pair = facingPair(chain, index)
  if (!pair || face !== 'upright') return pair
  // Asked on every store change for the avatar on show (scene/Avatar.tsx), and
  // the walk back can cover a whole chain of climbing: the last answer is kept
  // for the same chain array, link and view frame (viewAxes keeps one object per view).
  const last = headingMemo
  if (last && last.chain === chain && last.index === index && last.axes === axes) return last.pair as [T, T] | null
  const found = uprightPair(chain, index, pair, axes)
  headingMemo = { chain, index, axes, pair: found }
  return found
}

let headingMemo: { chain: unknown[]; index: number | null; axes: ViewAxes; pair: unknown } | null = null

function uprightPair<T extends { position: Position }>(chain: T[], index: number | null, pair: [T, T], axes: ViewAxes): [T, T] | null {
  if (crossesUp(pair[0].position, pair[1].position, axes)) return pair
  const n = chain.length
  const i = index === null ? n - 1 : Math.max(0, Math.min(n - 1, index))
  // The pair ends at link max(i, 1); look back from the move before it.
  for (let k = Math.max(i, 1) - 1; k >= 1; k--) {
    if (crossesUp(chain[k - 1].position, chain[k].position, axes)) return [chain[k - 1], chain[k]]
  }
  for (let k = Math.max(i, 1) + 1; k < n; k++) {
    if (crossesUp(chain[k - 1].position, chain[k].position, axes)) return [chain[k - 1], chain[k]]
  }
  return null
}

/**
 * The turn an UPRIGHT avatar's group carries in the view `axes`: the path
 * turn of `move` laid level, a yaw about render +Y (your view's up) alone, so
 * its nose points along the move's part across your up and its top stays up
 * on your screen whatever the compass has done to the world. With no move,
 * its rest pose (lying on cyberspace axes as built, turned with the view)
 * laid level the same way.
 */
export function uprightTurn(axes: ViewAxes, move: readonly [Position, Position] | null): Quaternion {
  return yawOnly(avatarTurn(axes, move), new Quaternion())
}

/** The turn an avatar's group carries for its facing mode: avatarTurn for PATH, uprightTurn for UPRIGHT. */
export function facingTurn(axes: ViewAxes, move: readonly [Position, Position] | null, face: FaceMode): Quaternion {
  return face === 'upright' ? uprightTurn(axes, move) : avatarTurn(axes, move)
}

/**
 * Someone else's heading, from the moves of theirs this client has seen
 * (arkinox, 2026-11-26: "other people's avatars always face the black sun
 * regardless of their movements"). Your own avatar faces its chain's last
 * move (scene/Avatar.tsx headingPair), and so does a spectated one and
 * every avatar on Cyberspace TV; everyone else in the field was drawn at
 * rest, model +Z toward the black sun, whatever they did. Now each of them
 * faces the way their own last move went, from where they stood to where
 * they stand, which is the heading their chain gives them and the one they
 * see of themselves out of WALK. No fetch: the moves are the positions the
 * presence feed and the target tracker already hand the scene.
 *
 * `last` is the newest move seen, for PATH. `level` is the newest that went
 * across the view's up when it was seen, for UPRIGHT, which keeps its
 * heading on a move straight up or down (DECK-0003 §1.18). Standing still
 * keeps both. Before any move both are null and the avatar stands at rest,
 * as it always has, and a respawn forgets them: a chain of one faces nothing.
 */
export interface SeenMoves {
  last: readonly [Position, Position] | null
  level: readonly [Position, Position] | null
}

export const NO_MOVES: SeenMoves = Object.freeze({ last: null, level: null })

/** The moves seen after one more, from `from` to `to`, in the view `axes`; the same object when nothing moved. */
export function seeMove(seen: SeenMoves, from: Position, to: Position, axes: ViewAxes): SeenMoves {
  if (from.x === to.x && from.y === to.y && from.z === to.z) return seen
  const move = [from, to] as const
  return { last: move, level: crossesUp(from, to, axes) ? move : seen.level }
}

/**
 * The turn an avatar's group carries for the moves seen of it, in the view
 * `axes`: PATH along its newest move; UPRIGHT along its newest move across
 * your up, while that one still goes across it (a compass turn can make it a
 * climb, and then it stands at rest, yawed about your up).
 */
export function seenTurn(seen: SeenMoves, axes: ViewAxes, face: FaceMode): Quaternion {
  if (face !== 'upright') return facingTurn(axes, seen.last, face)
  // The newest move first when it goes across your up now (a compass turn can
  // make an old climb level), else the newest that did when it was seen.
  const across = (m: readonly [Position, Position] | null): boolean => m !== null && crossesUp(m[0], m[1], axes)
  const kept = across(seen.last) ? seen.last : across(seen.level) ? seen.level : null
  return facingTurn(axes, kept, face)
}

/**
 * The moves seen of each person, by pubkey, kept across the avatar being
 * drawn and not drawn (a zoom out and in, a hop that takes them out of reach
 * and back, spectating), so someone standing still keeps their heading when
 * they are drawn again. Presentation only; the most recently seen are kept.
 */
const seenBy = new Map<string, SeenMoves>()
export const SEEN_KEPT = 500

/** The moves seen of `pubkey`, or none. */
export function seenOf(pubkey: string): SeenMoves {
  return seenBy.get(pubkey) ?? NO_MOVES
}

/** Keep the moves seen of `pubkey`; NO_MOVES forgets them (a respawn). */
export function keepSeen(pubkey: string, seen: SeenMoves): void {
  seenBy.delete(pubkey)
  if (seen === NO_MOVES) return
  seenBy.set(pubkey, seen)
  while (seenBy.size > SEEN_KEPT) seenBy.delete(seenBy.keys().next().value!)
}
