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
 * shard being born (decoding in) or dissolving, whose animation is the point.
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
import { DOOR_DISSOLVE_MS } from '../lib/ceremony'
import { drawnByMark, isGuideAuthor, passesTaps } from '../tutorial/guideBags'

/** Under this many pixels of radius on screen, a shown shard is hidden. */
export const HIDE_BELOW_PX = 1
/** Over this many pixels of radius on screen, a hidden shard is shown again. */
export const SHOW_ABOVE_PX = 2
/** How many shards with placed objects have their drawn box measured in one frame, in turn. */
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
  /** performance.now() when it began to dissolve, if it is. */
  dissolve: number | undefined
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
  return { key, group: null, at: null, drawn: null, shard: null, scale: 1, ownUnits: 0, places: false, measuredUnits: 0, measured: false, moving: false, birth: undefined, dissolve: undefined, r: 1, g: 1, b: 1, hidden: false, dotted: false }
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

/** Whether a shown shard (`hidden` false) or a hidden one is hidden after a frame at `px` pixels of radius on screen. */
export function nextHidden(hidden: boolean, px: number): boolean {
  return hidden ? !(px > SHOW_ABOVE_PX) : px < HIDE_BELOW_PX
}

/** Pixels of radius a sphere of `radius` render units spans at `distance` from the eye, `projScale` pixels per unit at one unit of depth. */
export function screenRadiusPx(radius: number, distance: number, projScale: number): number {
  return (radius * projScale) / Math.max(distance, 1e-9)
}

/** Whether the shard is never hidden at `now`: moving in EDIT, the tutorial's, being born or dissolving. */
export function cullExempt(e: Pick<FarCullEntry, 'key' | 'container' | 'moving' | 'birth' | 'dissolve'>, now: number): boolean {
  if (e.moving) return true
  if (e.birth !== undefined && now - e.birth < SHARD_DECODE_MS) return true
  if (e.dissolve !== undefined && now - e.dissolve < DOOR_DISSOLVE_MS) return true
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
   */
  frame(eye: Eye, projScale: number, now: number): boolean {
    const list = this.entries
    this.measureSome()
    let changed = this.stale
    this.stale = false
    for (let i = 0; i < list.length; i++) {
      const e = list[i]
      const at = e.at
      if (!at || !e.group) continue
      let hide = false
      if (!(e.places && !e.measured) && !cullExempt(e, now)) {
        const p = at.position
        const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        const r = this.radius(e)
        // The eye inside its sphere: it is all around, never a speck.
        hide = d > r && nextHidden(e.hidden, screenRadiusPx(r, d, projScale))
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
   * The drawn box of up to MEASURE_PER_FRAME shards that place objects, in
   * turn: how far it reaches from the shard's centre, kept when it is the
   * furthest yet. Their placed objects arrive when they resolve, and they
   * still arrive while the shard is hidden (what is hidden is still built),
   * so a box measured again later sees them.
   */
  private measureSome(): void {
    const list = this.entries
    if (list.length === 0) return
    let done = 0
    for (let step = 0; step < list.length && done < MEASURE_PER_FRAME; step++) {
      this.turn = (this.turn + 1) % list.length
      const e = list[this.turn]
      if (!e.places || !e.drawn || !e.at) continue
      done++
      measureEntry(e)
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
