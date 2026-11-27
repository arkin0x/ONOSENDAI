/**
 * restLift.ts: how high a thing drawn at a place stands over the floor it
 * rests on, so nothing of it is cut by that floor (owner, 2026-11-27, of a
 * coin at its true size: "the B is cut off by the ground").
 *
 * The floor under a place is the level of the place itself. A shard's points
 * sit on the same lattice as places (WorldShards placeShard: its origin on
 * its place, a model unit per gibson at unit 0), so a floor built at a
 * height passes through the middle of a thing placed at that height. A
 * chest's base stands exactly there (lib/looks chest.json: its lowest point
 * is its origin), and a walker standing at a place can have a face under them
 * anywhere from just under a gibson below up to that level (store/walkStep
 * standing). A thing drawn about its place, as a coin, a letter and an
 * item's token are, reached half its size below that level, and the floor
 * hid that half.
 *
 * So each is drawn lifted: its lowest point, at any turn and at the bottom
 * of its bob, stands REST_HOVER over its place's level. Where it is placed
 * does not change: only where it is drawn.
 */

/** The gap under a resting thing at the bottom of its bob, for a thing one across: it hovers, never touching. */
export const REST_HOVER = 0.1

/**
 * How far above its place a thing is drawn, for a thing one across (scale by
 * its size): its farthest reach below its own middle at any turn, its bob's
 * reach, and REST_HOVER.
 */
export function restLift(reach: number, bob: number): number {
  return reach + bob + REST_HOVER
}
