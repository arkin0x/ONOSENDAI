/**
 * itemModel.ts: the SNO an item wears in cyberspace, how it moves, and the
 * box drawn around it (arkinox, 2026-10-21: "I want to be able to pick a SNO
 * to represent the item in cyberspace, and an animation style:
 * bob-and-float, rotate around Y, rotate around X. These 3 animation styles
 * are not mutually exclusive and can be stacked").
 *
 * Both ride in the item itself (a kind 3340, lib/hidden.ts), so they travel
 * with it through bags, chests and copies, sealed like every other tag:
 *
 *   ["model", "33331:<pubkey>:<d>", "<relay hint>"]
 *   ["animate", "bob", "spin-y", "spin-x"]
 *
 * `model` names a public SNO object by its address (DECK-0003 §3.1), the
 * same `kind:pubkey:d` coordinate a placement's `a` reference names
 * (§1.10), so an edit its author publishes is what every item wearing it
 * shows next. The relay hint is optional. `animate` lists any of the three
 * motions, each at most once; a reader skips a name it does not know. An
 * item with neither tag is drawn exactly as before, as the note's cube, and
 * a client that knows neither tag reads the item as it always did.
 *
 * The box (arkinox: "the blue bounding rectangle should grow to encompass
 * it. If the shard fits within 2x1 gibsons, the box should be 2x1
 * gibsons"): whole gibsons on each axis, large enough to hold the model
 * through the whole of its motion, centred on the item's place, and cut at
 * the walls of the region its bag is sealed to, as a shard is. Nothing
 * else limits it.
 *
 * Pure: the drawing lives in scene/ItemModel.tsx and the fetch in
 * hooks/useItemModel.ts.
 */

import type { Box } from './clip'

/** The kind a model must be: a SNO object (DECK-0003 §3.1). */
export const MODEL_KIND = 33331
/** The tag that names an item's model. */
export const MODEL_TAG = 'model'
/** The tag that lists an item's motions. */
export const ANIMATE_TAG = 'animate'

/** One of the motions an item's model may have; they stack. */
export type ItemAnimation = 'bob' | 'spin-y' | 'spin-x'
/** Every motion, in the order a tag lists them and the composer shows them. */
export const ANIMATIONS: readonly ItemAnimation[] = ['bob', 'spin-y', 'spin-x']

/** A model an item wears: a SNO object's address, and where it was seen. */
export interface ItemModelRef {
  /** `33331:<pubkey>:<d>`. */
  address: string
  /** A relay that holds it (ws or wss), when known. */
  relay?: string
}

const HEX_64 = /^[0-9a-f]{64}$/
/** Longest `d` an address may carry: a UUID is 36, an event id 64. */
const MAX_D = 128

/** Whether `address` is a SNO object's: `33331:<64 hex>:<d>`, with a `d` of 1 to 128 printable characters. */
export function isModelAddress(address: string): boolean {
  const first = address.indexOf(':')
  const second = address.indexOf(':', first + 1)
  if (first < 0 || second < 0) return false
  if (address.slice(0, first) !== String(MODEL_KIND)) return false
  if (!HEX_64.test(address.slice(first + 1, second))) return false
  const d = address.slice(second + 1)
  return d.length > 0 && d.length <= MAX_D && /^[\x21-\x7e]+$/.test(d)
}

/** A relay hint this client will follow: a ws or wss URL, else nothing. */
function relayHint(s: string | undefined): string | undefined {
  return typeof s === 'string' && /^wss?:\/\/[^\s]+$/.test(s) && s.length <= 256 ? s : undefined
}

/** A tag that is an array of strings, or null: anything else is passed over, as hidden.ts does with every tag. */
function stringTag(t: unknown): string[] | null {
  return Array.isArray(t) && t.every((v) => typeof v === 'string') ? (t as string[]) : null
}

/** The model an item's tags name, or null: the first `model` tag whose address is a SNO object's. */
export function modelOf(tags: readonly unknown[]): ItemModelRef | null {
  for (const raw of tags) {
    const t = stringTag(raw)
    if (!t || t[0] !== MODEL_TAG || !isModelAddress(t[1] ?? '')) continue
    const relay = relayHint(t[2])
    return relay ? { address: t[1], relay } : { address: t[1] }
  }
  return null
}

/**
 * The motions an item's tags list, in ANIMATIONS order, each once. Every
 * `animate` tag counts, so a writer that split them across two is read the
 * same; a name this client does not know is skipped.
 */
export function animationOf(tags: readonly unknown[]): ItemAnimation[] {
  const on = new Set<string>()
  for (const raw of tags) {
    const t = stringTag(raw)
    if (t && t[0] === ANIMATE_TAG) for (const v of t.slice(1)) on.add(v)
  }
  return ANIMATIONS.filter((a) => on.has(a))
}

/**
 * The tags that carry a model and its motions, or none: no model, no tags,
 * because motions without a model have nothing to move. The motions go out
 * in ANIMATIONS order, each once, and only when there is at least one.
 */
export function modelTags(model: ItemModelRef | undefined, animation: readonly ItemAnimation[] | undefined): string[][] {
  if (!model || !isModelAddress(model.address)) return []
  const relay = relayHint(model.relay)
  const tags: string[][] = [relay ? [MODEL_TAG, model.address, relay] : [MODEL_TAG, model.address]]
  const moves = ANIMATIONS.filter((a) => animation?.includes(a))
  if (moves.length > 0) tags.push([ANIMATE_TAG, ...moves])
  return tags
}

// ---- motion -------------------------------------------------------------

/** One turn per this many seconds, about either axis turning alone (as the avatar card's spin, ShardSpin). */
export const SPIN_RAD_PER_S = 0.5
/**
 * Both turning: X at SPIN_RAD_PER_S and Y slower by the golden ratio, the
 * most irrational of ratios, so the two never fall into step and the tumble
 * does not visibly repeat (arkinox: "the Y rotate should be the slower one").
 */
export const GOLDEN = (1 + Math.sqrt(5)) / 2
/** Seconds per bob, up and back. */
export const BOB_PERIOD_S = 4.2
/** How far a bob carries the model each way, as a share of the box's largest side before the bob. */
export const BOB_FRACTION = 0.1

/** How fast each axis turns, radians a second, for these motions. */
export function spinRates(animation: readonly ItemAnimation[]): { y: number; x: number } {
  const y = animation.includes('spin-y')
  const x = animation.includes('spin-x')
  return {
    y: y ? (x ? SPIN_RAD_PER_S / GOLDEN : SPIN_RAD_PER_S) : 0,
    x: x ? SPIN_RAD_PER_S : 0,
  }
}

/** Where the motion stands at a moment: the lift on Y (model units) and the two turns (radians). */
export interface MotionPose { lift: number; turnY: number; turnX: number }

/**
 * The motion at `seconds`, written into `out` so a frame allocates nothing.
 * `phase` (0 to 1) staggers items so a field of them does not bob in step;
 * `amplitude` is the bob's reach each way. With `still` (the viewer asked
 * for reduced motion) the model rests where it starts: level, unturned.
 */
export function motionAt(seconds: number, animation: readonly ItemAnimation[], phase: number, amplitude: number, still: boolean, out: MotionPose): MotionPose {
  if (still || animation.length === 0) { out.lift = 0; out.turnY = 0; out.turnX = 0; return out }
  // spinRates' rule, worked in place: this runs per item per frame, and an object a call is garbage a call.
  const y = animation.includes('spin-y')
  const x = animation.includes('spin-x')
  const t = seconds + phase * BOB_PERIOD_S
  out.lift = animation.includes('bob') ? amplitude * Math.sin((2 * Math.PI * t) / BOB_PERIOD_S) : 0
  out.turnY = y ? (x ? SPIN_RAD_PER_S / GOLDEN : SPIN_RAD_PER_S) * t : 0
  out.turnX = x ? SPIN_RAD_PER_S * t : 0
  return out
}

// ---- the box ------------------------------------------------------------

/** A model's extent about its own centre, in its model units, in the frame renderers draw in (sno-core toRender). */
export interface ModelExtent {
  /** The middle of its bounds: what it turns about, and what sits on the item's place. */
  centre: [number, number, number]
  /** Half its bounds on each axis. */
  half: [number, number, number]
  /** Farthest any point lies from the centre, around Y (in X and Z), around X (in Y and Z), and in all three. */
  aroundY: number
  aroundX: number
  radius: number
}

/**
 * A model's extent from its points (model units, render frame, three to a
 * point) and, for an object that places others, its whole bounds with its
 * parts (sno-core placedBounds). A part is taken as its bounds' corners, the
 * most it can reach, so a turn is never undersized for one. Null when there
 * is nothing at all.
 */
export function extentOf(points: ArrayLike<number>, bounds: { min: number[]; max: number[] } | null): ModelExtent | null {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const n = Math.floor(points.length / 3)
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = points[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v }
  if (bounds) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], bounds.min[k]); max[k] = Math.max(max[k], bounds.max[k]) }
  if (!(min[0] <= max[0])) return null
  const centre = [0, 1, 2].map((k) => (min[k] + max[k]) / 2) as [number, number, number]
  const half = [0, 1, 2].map((k) => (max[k] - min[k]) / 2) as [number, number, number]
  let aroundY = 0, aroundX = 0, radius = 0
  const take = (x: number, y: number, z: number): void => {
    const dx = x - centre[0], dy = y - centre[1], dz = z - centre[2]
    aroundY = Math.max(aroundY, Math.hypot(dx, dz))
    aroundX = Math.max(aroundX, Math.hypot(dy, dz))
    radius = Math.max(radius, Math.hypot(dx, dy, dz))
  }
  for (let i = 0; i < n; i++) take(points[i * 3], points[i * 3 + 1], points[i * 3 + 2])
  if (bounds) for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) take(x, y, z)
  return { centre, half, aroundY, aroundX, radius }
}

/**
 * How far the model reaches from its centre on each axis through the whole
 * of its motion, before the bob, in model units.
 *
 * Turning about Y sweeps X and Z out to the farthest point from the Y axis;
 * about X, Y and Z out to the farthest from the X axis. Both: the model is
 * turned about X inside a turn about Y (scene/ItemModel.tsx), so Y reaches
 * the farthest from the X axis (a turn about Y never changes a height), and
 * X and Z reach the farthest from the centre (the inner turn brings every
 * point round to where the outer one carries it at full length).
 */
export function sweptHalf(e: ModelExtent, animation: readonly ItemAnimation[]): [number, number, number] {
  const y = animation.includes('spin-y')
  const x = animation.includes('spin-x')
  if (y && x) return [e.radius, e.aroundX, e.radius]
  if (y) return [e.aroundY, e.half[1], e.aroundY]
  if (x) return [e.half[0], e.aroundX, e.aroundX]
  return [e.half[0], e.half[1], e.half[2]]
}

/** The bob's reach each way, model units: BOB_FRACTION of the box's largest side before it. Zero without a bob. */
export function bobAmplitude(swept: readonly number[], animation: readonly ItemAnimation[]): number {
  return animation.includes('bob') ? BOB_FRACTION * 2 * Math.max(swept[0], swept[1], swept[2]) : 0
}

/** Slack for float noise: a model exactly two gibsons long is a two-gibson box, not three. */
const ROUNDING_SLACK = 1e-6

/**
 * Whole gibsons a side for something `extent` gibsons long: at least one,
 * else rounded up (arkinox: "If the shard fits within 2x1 gibsons, the box
 * should be 2x1 gibsons").
 */
export function wholeGibsons(extent: number): number {
  if (!(extent > ROUNDING_SLACK)) return 1
  return Math.max(1, Math.ceil(extent - ROUNDING_SLACK))
}

/** What the box is, in gibsons a side, and the bob's reach in model units. */
export interface ItemBoxSize {
  /** Whole gibsons on each axis of the render frame, before the region's walls. */
  gibsons: [number, number, number]
  amplitude: number
}

/**
 * The box around a model in motion: its swept reach on each axis, the bob
 * added on Y, in gibsons (a model unit is 2^unit gibsons), rounded up to
 * whole gibsons.
 */
export function itemBoxSize(e: ModelExtent, unit: number, animation: readonly ItemAnimation[]): ItemBoxSize {
  const swept = sweptHalf(e, animation)
  const amplitude = bobAmplitude(swept, animation)
  const perUnit = 2 ** unit
  const reach = [swept[0], swept[1] + amplitude, swept[2]]
  return { gibsons: reach.map((h) => wholeGibsons(2 * h * perUnit)) as [number, number, number], amplitude }
}

/**
 * A box of `gibsons` a side centred on the item's place, cut at the walls
 * of `region` (lib/clip.ts regionBox, in gibsons about the same place), in
 * model units (2^unit gibsons each). `clipped` is whether a wall cut it,
 * which is when the model itself must be cut at the walls too.
 */
export function boxInRegion(gibsons: readonly number[], region: Box, unit: number): { box: Box; clipped: boolean } {
  const perUnit = 2 ** unit
  const min: [number, number, number] = [0, 0, 0]
  const max: [number, number, number] = [0, 0, 0]
  let clipped = false
  for (let k = 0; k < 3; k++) {
    const h = gibsons[k] / 2
    const lo = Math.max(-h, region.min[k]), hi = Math.min(h, region.max[k])
    if (lo > -h || hi < h) clipped = true
    min[k] = lo / perUnit
    max[k] = hi / perUnit
  }
  return { box: { min, max }, clipped }
}

/** A box's centre and side lengths, for drawing a unit cube's edges as it. */
export function boxShape(b: Box): { centre: [number, number, number]; size: [number, number, number] } {
  return {
    centre: [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2) as [number, number, number],
    size: [0, 1, 2].map((k) => Math.max(0, b.max[k] - b.min[k])) as [number, number, number],
  }
}

/**
 * A box carried through a turn that only swaps axes and flips them (a view
 * frame, lib/pose.ts viewPose as renderPose gives it): `m` is the turn's
 * matrix, column major (three's Matrix4 elements). The corners go through
 * and the box is the smallest that holds them, which for such a turn is
 * exactly the turned box.
 */
export function turnBox(b: Box, m: ArrayLike<number>): Box {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) {
    for (let r = 0; r < 3; r++) {
      const v = m[r] * x + m[4 + r] * y + m[8 + r] * z
      if (v < min[r]) min[r] = v
      if (v > max[r]) max[r] = v
    }
  }
  return { min, max }
}

/** Render units per model unit at a model's true size: 2^(unit - scaleExp), in fixed point as WorldShards works it. */
export function trueScale(unit: number, scaleExp: number): number {
  const exp = unit - scaleExp
  return exp >= 0 ? Number(1n << BigInt(exp)) : 1 / Number(1n << BigInt(-exp))
}

/**
 * Render units per model unit: the model's true size (trueScale), unless
 * that would draw the box's longest side under `minPx` on screen, which is
 * the note's cube's size; then the whole thing is drawn that large instead,
 * so an item is never smaller than it was as a cube (lib/markerSize.ts, the
 * rule a stop's cube follows). `perPx` is the render units one CSS pixel
 * spans at the item's depth. Called every frame, so it allocates nothing.
 */
export function modelScale(atTrueSize: number, longestSide: number, minPx: number, perPx: number): number {
  if (!(longestSide > 0)) return atTrueSize
  return Math.max(atTrueSize, (minPx * perPx) / longestSide)
}

/** A 0 to 1 phase from an item's id, so items bob out of step with each other. */
export function phaseOf(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return (h >>> 0) / 2 ** 32
}
