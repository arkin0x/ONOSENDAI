/**
 * orientation.ts - how a bloom stands (DECK-0008 §5.7, arkin0x/cyberspace#98;
 * owner ruling 2026-11-10: "user decides; default is Y+. Planted in
 * dataspace, the option to align to earth should be toggleable. User should
 * be able to rotate the seed just like shards").
 *
 * A seed carries `["turn", x, y, z]`, `["up"]` and `["spin", n]`. A reader
 * draws the bloom's payload as ever, turns its points by quarter turns about
 * X, then Y, then Z in the payload's frame, and stands it on Earth at its `C`
 * with its spin when it carries `up` and stands in dataspace. The words are a
 * shard's (TURN, SNAP TO EARTH, FINE ROTATION; DECK-0003 §1.7 `up` and
 * `spin`), and so are the controls and the store's deploy fields.
 *
 * Frames: the spec turns and stands a bloom in Cyberspace's axes, after the
 * payload's Z is negated as DECK-0003 §2 places every object. That is this
 * client's model frame (sno-core fromPayload's flipZ), where lib/turn.ts
 * turns every shard and pose.ts stands it, so the tag's turns are the deploy
 * bar's TURN as it is, and the front is model +Z, which SPIN's bearing
 * measures. A test holds the reader to the spec's maps on a real bloom.
 */

import type { Plane } from 'cyberspace-core'
import type { ShardModel } from 'sno-core/shards'
import { turnDirection, turnShard, type Turns } from '../turn'
import { applyPose, type Pose, type V3 } from '../pose'
import { type SeedStand } from './seedItem'

export { standOf, UPRIGHT, type SeedStand } from './seedItem'

/** The tags a seed is written with: none for an upright seed; `up` only in dataspace, and `spin` only with it. */
export function standTags(stand: SeedStand, plane: Plane): string[][] {
  const out: string[][] = []
  if (stand.turn.some((n) => n % 4 !== 0)) out.push(['turn', ...stand.turn.map((n) => String(((n % 4) + 4) % 4))])
  if (stand.up && plane === 0) {
    out.push(['up'])
    if (stand.spin !== 0) out.push(['spin', String(stand.spin)])
  }
  return out
}

/**
 * Whether SEED offers SNAP TO EARTH: in dataspace, at any height. A shard's
 * snap waits for height 27 (pose.ts SNAP_MIN_HEIGHT, sized for AR), but a seed
 * hides at 3 to 12 so it can be found (owner ruling 2026-11-10), and the owner
 * asked for the toggle wherever a seed is planted in dataspace.
 */
export function seedSnapOffered(plane: Plane): boolean {
  return plane === 0
}

/** Whether a seed stands on Earth where it is: `up`, in dataspace. Ideaspace has no Earth (§5.7). */
export function standsOnEarth(stand: SeedStand, plane: Plane): boolean {
  return stand.up && plane === 0
}

/** Turned and stood blooms by their unturned shard: a bloom changes once a block, its stand never. */
const stood = new WeakMap<ShardModel, Map<string, ShardModel>>()

/**
 * The bloom's shard as it stands: turned (§5.7 step 2), and marked to stand
 * on Earth with its spin (step 3), which the scene's pose applies (WorldShards
 * placeShard). The same object for an upright seed.
 */
export function standBloom(shard: ShardModel, stand: SeedStand, plane: Plane): ShardModel {
  const up = standsOnEarth(stand, plane)
  const turns: Turns = [stand.turn[0], stand.turn[1], stand.turn[2]]
  if (!up && turns.every((n) => n === 0)) return shard
  const key = `${turns.join('.')}|${up ? stand.spin : '-'}`
  let byKey = stood.get(shard)
  if (!byKey) stood.set(shard, (byKey = new Map()))
  const hit = byKey.get(key)
  if (hit) return hit
  const out: ShardModel = { ...turnShard(shard, turns), id: `${shard.id}:${key}`, up, spin: up ? stand.spin : 0 }
  byKey.set(key, out)
  return out
}

/**
 * The bloom's up (+Y) and front (+Z) as the scene draws them: turned by the
 * deploy bar's TURN, through the pose the bloom will stand in
 * (pose.ts placedPose), then into render axes as every shard's points go
 * (sno-core toRender: Z negated). Unit length.
 */
export function standArrows(turns: Turns, pose: Pose): { up: V3; front: V3 } {
  const render = (d: V3): V3 => {
    const p = applyPose(pose, turnDirection(d, turns))
    return [p[0], p[1], 0 - p[2]]
  }
  return { up: render([0, 1, 0]), front: render([0, 0, 1]) }
}
