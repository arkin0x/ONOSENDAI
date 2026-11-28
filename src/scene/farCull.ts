/**
 * farCull.ts: a world shard too small on screen to be anything is not drawn;
 * one dot is drawn in its place (owner, 2026-11-28: HOP at 2^14 near the Block
 * 101 town crawled, every shard in the town drawn in full while the whole
 * town was a few pixels across).
 *
 * Each frame, one pass over every world shard (WorldShards and WorldSeeds,
 * through PlacedShard) works out how many pixels its bounding sphere spans on
 * screen, from where the camera is now, and hides what it draws below
 * HIDE_BELOW_PX, showing it again only above SHOW_ABOVE_PX, so a shard right
 * at the line never flickers. The sphere is the shard's own reach (WorldShards
 * shardReach), widened by its glow's radius (a glow reaches past its points,
 * DECK-0003 §1.16), and for a shard that places objects, by the box its drawn
 * group measures (TapTarget's box), since a placed object can be far larger
 * than its parent.
 *
 * The far cull in WorldShards (drawableShards) is a bound that holds at any
 * camera distance, so it assumes the camera as near as anything is drawn, and
 * it never touches a shard with placed objects. This one asks the live camera.
 *
 * Never hidden: the shard EDIT is moving, the tutorial's own shards, and a
 * shard being born (decoding in), whose animation is the point.
 *
 * A hidden shard is drawn as one dot in its own colour (the mean of its
 * vertices'), all of them in one points draw (FarShardDots.tsx), rebuilt only
 * when the set of hidden shards changes. DECK-0003 §1.15 asks a reader to keep
 * every point visible; a dot for a shard under two pixels keeps it in sight.
 *
 * A frame allocates nothing: the entries are kept in an array, the box and
 * the dot list are reused.
 */

import { Box3, type Object3D } from 'three'
import type { ShardModel } from 'sno-core/shards'
import { SHARD_DECODE_MS } from '../lib/decode'
import { drawnByMark, isGuideAuthor, passesTaps } from '../tutorial/guideBags'

/** Under this many pixels of radius on screen, a shown shard is hidden. */
export const HIDE_BELOW_PX = 1
/** Over this many pixels of radius on screen, a hidden shard is shown again. */
export const SHOW_ABOVE_PX = 2
/** How many never-measured shards with placed objects have their drawn box measured in one frame (one measured one more, in turn). */
export const MEASURE_PER_FRAME = 2

/** One world shard as the pass sees it. PlacedShard keeps the fields current. */
export interface FarCullEntry {
  key: string
  /** Who put it there: the bag's signer (the tutorial's guide, for its shards). */
  container?: string
  /** What the pass hides and shows: the shard's drawing, under its positioned group. */
  group: Object3D | null
  /** The positioned group: where the shard is, and whether it is drawn at all (hidden past the reach, or drawn by a tutorial mark). */
  at: Object3D | null
  /** What the shard draws, measured for its placed objects. */
  drawn: Object3D | null
  shard: ShardModel | null
  /** Render units per model unit. */
  scale: number
  /** Its own reach plus its glow's radius, in model units (WorldShards farCullUnits). */
  ownUnits: number
  /** It places objects: measured from its drawn box, and never hidden until measured once. */
  places: boolean
  /** The furthest its drawn box has reached from its centre, in model units: only grows, until its model changes. */
  measuredUnits: number
  measured: boolean
  moving: boolean
  /** performance.now() when it was found (its decode), if it was. */
  birth: number | undefined
  /**
   * Its dot's width in steps of DOT_STEP_PX: its sphere's diameter on screen
   * at the last frame, from 2 px to 4 px. A whole number, so a frame that
   * writes it allocates nothing (a fraction in a field or handed back from a
   * call can be a fresh heap number each time).
   */
  dotSteps: number
  /** Its dot's colour, 0..1. */
  r: number
  g: number
  b: number
  /** Hidden by this pass. */
  hidden: boolean
  /** Drawn as a dot: hidden by this pass while its positioned group is drawn. */
  dotted: boolean
}

/** A fresh entry, with nothing attached yet. */
export function farCullEntry(key: string): FarCullEntry {
  return { key, container: undefined, group: null, at: null, drawn: null, shard: null, scale: 1, ownUnits: 0, places: false, measuredUnits: 0, measured: false, moving: false, birth: undefined, dotSteps: DOT_STEPS_MIN, r: 1, g: 1, b: 1, hidden: false, dotted: false }
}

/** A shard's mean vertex colour, kept for as long as the model is; the fallback for one with no vertices of its own. */
const colours = new WeakMap<ShardModel, [number, number, number]>()
const NO_VERTICES: [number, number, number] = [0, 0.9, 1]
export function shardColour(shard: ShardModel): [number, number, number] {
  let c = colours.get(shard)
  if (c) return c
  const n = shard.vertices.length
  if (n === 0) c = NO_VERTICES
  else {
    let r = 0, g = 0, b = 0
    for (const v of shard.vertices) { r += v.c[0]; g += v.c[1]; b += v.c[2] }
    c = [r / n, g / n, b / n]
  }
  colours.set(shard, c)
  return c
}

/** Points the entry at a model (and a measured box no longer, when the model is new). */
export function setShard(e: FarCullEntry, shard: ShardModel, ownUnits: number): void {
  if (e.shard !== shard) {
    e.shard = shard
    e.measuredUnits = 0
    e.measured = false
    const [r, g, b] = shardColour(shard)
    e.r = r; e.g = g; e.b = b
  }
  e.ownUnits = ownUnits
  e.places = (shard.parts?.length ?? 0) > 0
}

/** A dot's width is kept to steps of this many CSS px, so a camera easing to rest sends the dots' widths again only a few times. */
export const DOT_STEP_PX = 0.25
/** The narrowest dot, in steps: as wide as a shard is where it is hidden (a radius of HIDE_BELOW_PX). */
export const DOT_STEPS_MIN = (2 * HIDE_BELOW_PX) / DOT_STEP_PX
/** The widest dot, in steps: as wide as a shard is where it is shown again (a radius of SHOW_ABOVE_PX). */
export const DOT_STEPS_MAX = (2 * SHOW_ABOVE_PX) / DOT_STEP_PX

/**
 * A hidden shard's dot width, in steps of DOT_STEP_PX, for a sphere `px`
 * pixels in radius on screen: its diameter, from DOT_STEPS_MIN to
 * DOT_STEPS_MAX. As the camera comes in, the dot grows to the size the shard
 * is shown at, so the shard taking its place does not pop.
 */
export function dotSteps(px: number): number {
  const steps = Math.round((2 * px) / DOT_STEP_PX)
  return steps < DOT_STEPS_MIN ? DOT_STEPS_MIN : steps > DOT_STEPS_MAX ? DOT_STEPS_MAX : steps
}

/** Whether a shown shard (`hidden` false) or a hidden one is hidden after a frame at `px` pixels of radius on screen. */
export function nextHidden(hidden: boolean, px: number): boolean {
  return hidden ? !(px > SHOW_ABOVE_PX) : px < HIDE_BELOW_PX
}

/** Pixels of radius a sphere of `radius` render units spans at `distance` from the eye, `projScale` pixels per unit at one unit of depth. */
export function screenRadiusPx(radius: number, distance: number, projScale: number): number {
  return (radius * projScale) / Math.max(distance, 1e-9)
}

/** Whether the shard is never hidden at `now`: moving in EDIT, the tutorial's, or being born. */
export function cullExempt(e: Pick<FarCullEntry, 'key' | 'container' | 'moving' | 'birth'>, now: number): boolean {
  return e.moving || (e.birth !== undefined && now - e.birth < SHARD_DECODE_MS) || tutorialShard(e)
}

/** One of the tutorial's shards: one it lets taps through, one its marks draw, or one its guide placed. */
export function tutorialShard(e: Pick<FarCullEntry, 'key' | 'container'>): boolean {
  return drawnByMark(e.key) || passesTaps(e.key) || isGuideAuthor(e.container)
}

/** The camera as the pass reads it: where it is. */
export interface Eye { x: number; y: number; z: number }

const box = new Box3()

/**
 * The world shards, and the one pass that hides and shows them. Scene-wide
 * through `farCull`; a test makes its own.
 */
export class FarCull {
  readonly entries: FarCullEntry[] = []
  /**
   * The shards drawn as dots, in the order their dots are written: the first
   * `dotCount`. Never cut shorter (V8 lets an emptied array's storage go, and
   * it would be made again at the next change); the slots past the count are
   * cleared, so nothing taken down is held.
   */
  readonly dots: Array<FarCullEntry | null> = []
  dotCount = 0
  private turn = 0
  private unmeasuredTurn = 0
  private stale = false

  add(e: FarCullEntry): void {
    if (this.entries.includes(e)) return
    this.entries.push(e)
  }

  remove(e: FarCullEntry): void {
    const i = this.entries.indexOf(e)
    if (i < 0) return
    const last = this.entries.pop()!
    if (i < this.entries.length) this.entries[i] = last
    if (e.dotted) this.stale = true
    e.dotted = false
    if (e.hidden && e.group) e.group.visible = true
    e.hidden = false
  }

  /** Every shard shown again, and no dots: the pass is going away. */
  restore(): void {
    for (const e of this.entries) {
      if (e.hidden && e.group) e.group.visible = true
      e.hidden = false
      e.dotted = false
    }
    this.dots.fill(null)
    this.dotCount = 0
  }

  /** How far the shard reaches from its centre now, in render units. */
  radius(e: FarCullEntry): number {
    return Math.max(e.ownUnits, e.measuredUnits) * e.scale
  }

  /**
   * One frame: every shard hidden or shown for the camera at `eye`, and true
   * when the set drawn as dots changed (the dot list is then rebuilt). Each
   * shard's centre is its positioned group's position, in the same frame as
   * the camera (the scene's root group, which has no transform).
   *
   * The rules of cullExempt, screenRadiusPx, nextHidden and dotSteps are
   * worked here in place, not called: a fraction handed to a function the
   * compiler does not inline is a fresh heap number, one per shard per frame
   * (measured: up to 200 bytes a frame at 200 shards). The tests hold the
   * pass to the same answers.
   */
  frame(eye: Eye, projScale: number, now: number): boolean {
    const list = this.entries
    this.measureSome()
    let changed = this.stale
    this.stale = false
    for (let i = 0; i < list.length; i++) {
      const e = list[i]
      const at = e.at
      // Its groups gone (taken down, the refs let go before the entry is): no dot for it.
      if (!at || !e.group) {
        if (e.dotted) { e.dotted = false; changed = true }
        continue
      }
      let hide = false
      const born = e.birth !== undefined && now - e.birth < SHARD_DECODE_MS
      if (!(e.places && !e.measured) && !e.moving && !born && !tutorialShard(e)) {
        const p = at.position
        const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        const r = (e.ownUnits > e.measuredUnits ? e.ownUnits : e.measuredUnits) * e.scale
        const px = (r * projScale) / (d > 1e-9 ? d : 1e-9)
        // The eye inside its sphere: it is all around, never a speck.
        hide = d > r && (e.hidden ? !(px > SHOW_ABOVE_PX) : px < HIDE_BELOW_PX)
        if (hide) {
          const steps = Math.round((2 * px) / DOT_STEP_PX)
          e.dotSteps = steps < DOT_STEPS_MIN ? DOT_STEPS_MIN : steps > DOT_STEPS_MAX ? DOT_STEPS_MAX : steps
        }
      }
      if (hide !== e.hidden) {
        e.hidden = hide
        e.group.visible = !hide
      }
      const dotted = hide && at.visible !== false
      if (dotted !== e.dotted) { e.dotted = dotted; changed = true }
    }
    if (changed) {
      const dots = this.dots
      let n = 0
      for (let i = 0; i < list.length; i++) {
        if (!list[i].dotted) continue
        if (n < dots.length) dots[n] = list[i]
        else dots.push(list[i])
        n++
      }
      for (let i = n; i < this.dotCount; i++) dots[i] = null
      this.dotCount = n
    }
    return changed
  }

  /**
   * The drawn box of shards that place objects: how far it reaches from the
   * shard's centre, kept when it is the furthest yet. First, up to
   * MEASURE_PER_FRAME never measured (new, a new model, or nothing drawn yet
   * when last asked), so a shard whose placed objects have just arrived is
   * sized within a frame or two and not after a whole round; then one more
   * in turn, so every measured one is looked at again in time. Their placed
   * objects arrive when they resolve, and they still arrive while the shard
   * is hidden (what is hidden is still built), so a box measured again later
   * sees them.
   */
  private measureSome(): void {
    const list = this.entries
    const n = list.length
    if (n === 0) return
    let first = 0
    for (let step = 0; step < n && first < MEASURE_PER_FRAME; step++) {
      this.unmeasuredTurn = (this.unmeasuredTurn + 1) % n
      const e = list[this.unmeasuredTurn]
      if (!e.places || e.measured || !e.drawn || !e.at) continue
      first++
      measureEntry(e)
    }
    for (let step = 0; step < n; step++) {
      this.turn = (this.turn + 1) % n
      const e = list[this.turn]
      if (!e.places || !e.measured || !e.drawn || !e.at) continue
      measureEntry(e)
      return
    }
  }
}

/** One shard's drawn box, from the geometry as last drawn, against its centre as last drawn. */
export function measureEntry(e: FarCullEntry): void {
  if (!e.drawn || !e.at || !(e.scale > 0)) return
  box.setFromObject(e.drawn)
  if (box.isEmpty()) return
  // The box is in world space as of the last render: so is this.
  const m = e.at.matrixWorld.elements
  const dx = Math.max(Math.abs(box.min.x - m[12]), Math.abs(box.max.x - m[12]))
  const dy = Math.max(Math.abs(box.min.y - m[13]), Math.abs(box.max.y - m[13]))
  const dz = Math.max(Math.abs(box.min.z - m[14]), Math.abs(box.max.z - m[14]))
  const units = Math.sqrt(dx * dx + dy * dy + dz * dz) / e.scale
  if (Number.isFinite(units) && units > e.measuredUnits) e.measuredUnits = units
  e.measured = true
}

/** The scene's pass: PlacedShard registers its world shards here, FarShardDots runs it. */
export const farCull = new FarCull()
