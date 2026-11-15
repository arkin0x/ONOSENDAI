/**
 * glowBudget.ts - how many glow halos a canvas draws, all told (DECK-0003
 * §1.16 lets a reader draw fewer glows, or none).
 *
 * A halo costs fill, not draw calls: every pixel it covers is read and
 * blended, so one object of 10,000 points with a wide fog can blend dozens of
 * layers over the whole screen. The limits that protect a phone are the
 * screen area all halos cover together and the size of the largest one; a
 * count limit keeps the vertex work and the stranger's share in hand.
 *
 * Spent as scene/meshBudget.ts spends placed objects: your own and followed
 * authors' objects first, then strangers', nearest first within each, with
 * hysteresis so two objects at about the same distance do not trade halos on
 * every step. A stranger's object draws at most GlowLimits.strangerObject
 * halos, and strangers together at most strangerShare of the count. What an
 * object cannot draw is a share of its halos left out evenly (each halo has
 * a fixed place in a low-discrepancy order, so a half is every other one,
 * never one side), faded at the edge of the share so nothing pops.
 *
 * Each canvas has its own pool (the world, the bench, a picture, a game): one
 * allocation per frame, run by the first halo drawn in it (spendGlow). The
 * pure part (allocateGlow) is what the tests read.
 *
 * Numbers: GLOW_LIMITS, one table, phone and desktop. See the PR that added
 * them for the measurements behind them.
 */

import { Matrix4, Vector3, type Camera, type Object3D } from 'three'

/** One profile's limits. Halo sizes are radii. */
export interface GlowLimits {
  /** Halos drawn per frame in one canvas, all objects together. */
  halos: number
  /** The most of `halos` strangers' objects draw together. */
  strangerShare: number
  /** The most halos any one stranger's object draws. */
  strangerObject: number
  /** Total halo area on screen, in screens covered (sum of each halo's disc over the canvas area). */
  screens: number
  /** The largest halo radius on screen, as a share of the canvas height: a larger one is drawn at this size. */
  largestHalo: number
  /** A halo under this radius on screen, CSS px, is not drawn (faded out over half as much again). */
  smallestHaloPx: number
  /** The smallest point drawn at a POINT SIZE, CSS px across: a far point stays dust (§1.15 SHOULD keep every point visible). */
  pointMinPx: number
  /** The largest point drawn at a POINT SIZE, CSS px across. */
  pointMaxPx: number
}

/**
 * The defaults. Measured in headless Chromium (software GL, so absolute
 * frame times are slow and only the ratios carry over) and set against the
 * research's device numbers: a mid-range Android phone carries about 300 to
 * 400 halos about 50 px across, a recent iPhone 1,000 to 1,500, and the cost
 * follows the area covered, not the count.
 */
export const GLOW_LIMITS: Record<GlowProfile, GlowLimits> = {
  phone: { halos: 4_000, strangerShare: 1 / 3, strangerObject: 500, screens: 3, largestHalo: 0.25, smallestHaloPx: 2, pointMinPx: 1.5, pointMaxPx: 64 },
  desktop: { halos: 30_000, strangerShare: 1 / 3, strangerObject: 2_000, screens: 10, largestHalo: 0.4, smallestHaloPx: 2, pointMinPx: 1.5, pointMaxPx: 128 },
}

export type GlowProfile = 'phone' | 'desktop'

/** Phone unless the main pointer is a mouse on a screen at least 900 px wide. */
export function glowProfile(): GlowProfile {
  try {
    if (typeof window === 'undefined' || !window.matchMedia) return 'desktop'
    const fine = window.matchMedia('(pointer: fine)').matches
    const wide = Math.max(window.screen?.width ?? 0, window.innerWidth ?? 0) >= 900
    return fine && wide ? 'desktop' : 'phone'
  } catch {
    return 'phone'
  }
}

let profileNow: GlowProfile | null = null
/** The limits for this device, chosen once. */
export function glowLimits(): GlowLimits {
  profileNow ??= glowProfile()
  return GLOW_LIMITS[profileNow]
}

/** How much nearer, in doublings of distance, an object already drawing halos counts: a fifth, as meshBudget's. */
export const GLOW_HYSTERESIS_DOUBLINGS = Math.log2(1 / (1 - 0.2))

/** What one object asks of the pool this frame. */
export interface GlowDemand {
  key: number
  trusted: boolean
  /** Its halos. */
  count: number
  /** How far its centre is from the camera, in doublings: log2(1 + render units). */
  distance: number
  /** The screen area one of its halos covers, in screens (after the largest-halo cap); 0 when too small to draw. */
  area: number
}

/**
 * How many halos each object draws: trusted first, then nearest, each taking
 * what is left of the count, the area and (a stranger) its own and the
 * strangers' share. `held`, what each drew at the last allocation, gives the
 * hysteresis.
 */
export function allocateGlow(demands: readonly GlowDemand[], limits: GlowLimits, held: ReadonlyMap<number, number> = new Map()): Map<number, number> {
  const out = new Map<number, number>()
  const near = (d: GlowDemand): number => d.distance - ((held.get(d.key) ?? 0) > 0 ? GLOW_HYSTERESIS_DOUBLINGS : 0)
  const order = [...demands].sort((a, b) => (a.trusted === b.trusted ? near(a) - near(b) : a.trusted ? -1 : 1))
  let halos = limits.halos
  let strangers = Math.floor(limits.halos * limits.strangerShare)
  let area = limits.screens
  for (const d of order) {
    let give = Math.min(d.count, halos)
    if (!d.trusted) give = Math.min(give, limits.strangerObject, strangers)
    if (d.area > 0) give = Math.min(give, Math.floor(area / d.area))
    give = Math.max(0, give)
    out.set(d.key, give)
    halos -= give
    if (!d.trusted) strangers -= give
    area -= give * d.area
  }
  return out
}

/** One object's halos in a canvas's pool. */
export interface HaloEntry {
  readonly key: number
  trusted: boolean
  count: number
  /** Halo radius in model units. */
  radius: number
  /** The middle of its points and how far they reach from it, model units. */
  centre: Vector3
  reach: number
  /** What draws them: its world matrix places them. */
  object: Object3D
  /** How many it may draw, from the last allocation. */
  kept: number
}

interface Pool { entries: Set<HaloEntry>; frame: number; held: Map<number, number> }
const pools = new WeakMap<object, Pool>()
let nextKey = 1

/** A key for a new entry. */
export function haloKey(): number {
  return nextKey++
}

/** Join `canvas`'s pool (the renderer is the key); returns the leave. */
export function joinGlow(canvas: object, entry: HaloEntry): () => void {
  let pool = pools.get(canvas)
  if (!pool) pools.set(canvas, (pool = { entries: new Set(), frame: -1, held: new Map() }))
  pool.entries.add(entry)
  const p = pool
  return () => { p.entries.delete(entry); p.held.delete(entry.key) }
}

const at = new Vector3()
const eye = new Vector3()
const view = new Vector3()
const inverse = new Matrix4()

/**
 * Spend `canvas`'s pool for this frame, once however many halos ask:
 * `frame` is the canvas's own frame number. `height` and `width` are the
 * canvas's CSS size.
 */
export function spendGlow(canvas: object, frame: number, camera: Camera, width: number, height: number, limits: GlowLimits = glowLimits()): void {
  const pool = pools.get(canvas)
  if (!pool || pool.frame === frame) return
  pool.frame = frame
  const proj = camera.projectionMatrix.elements[5]
  const cap = limits.largestHalo * height
  const screen = Math.max(1, width * height)
  camera.getWorldPosition(eye)
  inverse.copy(camera.matrixWorld).invert()
  const demands: GlowDemand[] = []
  for (const e of pool.entries) {
    const m = e.object.matrixWorld.elements
    const k = Math.hypot(m[0], m[1], m[2]) || 1
    at.copy(e.centre).applyMatrix4(e.object.matrixWorld)
    const dist = at.distanceTo(eye)
    const depth = -view.copy(at).applyMatrix4(inverse).z
    const behind = depth < -e.reach * k
    const px = (e.radius * k * height * proj * 0.5) / Math.max(depth, 1e-4)
    const shown = Math.min(px, cap)
    const area = behind || px < limits.smallestHaloPx ? 0 : (Math.PI * shown * shown) / screen
    demands.push({ key: e.key, trusted: e.trusted, count: e.count, distance: Math.log2(1 + dist), area })
  }
  const next = allocateGlow(demands, limits, pool.held)
  pool.held = next
  for (const e of pool.entries) e.kept = next.get(e.key) ?? 0
}

/** Forget every pool: tests. */
export function clearGlowPools(canvas: object): void {
  pools.delete(canvas)
}

// DEV window handle, the house pattern (__store, __shards): the frame-time bench lifts the limits to measure past them.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __glowLimits?: unknown }).__glowLimits = GLOW_LIMITS
}
