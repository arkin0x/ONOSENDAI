/**
 * interest.ts - the sphere of interest: which landfalls the field shows once
 * the planet no longer fits the grid, and which one of them is nearest.
 *
 * The landfall shell draws at most a few thousand of the half million stops
 * on Earth, chosen by identity hash (sample.ts), so at any one zoom the
 * overwhelming majority of hyperjumps are simply not on screen. Zooming in
 * did not help: the field was culled to the grid's reach, and at 2^49 the
 * reach is still the whole hemisphere, so the same thin sample was drawn
 * bigger. arkinox's rule fixes both halves at once. A click on the globe
 * orbits the point clicked instead of the planet's centre, and from 2^49
 * down the field is cut to a SPHERE around that point, sized to the zoom,
 * so every press of [-] looks at a smaller patch of ground with the same
 * thousand-dot budget spent inside it.
 *
 * The sphere, in one place:
 *
 *   centre  the standing focus, when it is a point on Earth: a dataspace
 *           position within SURFACE_TOLERANCE_M of the WGS84 ellipsoid.
 *           That is every landfall (their coordinates lie on the ellipsoid
 *           to a nanometer), every point clicked on the globe (snapped to
 *           the surface by construction), and every place typed into the
 *           POSITION panel, which since the GO TO merge is how a latitude
 *           and longitude or a place by name is reached. A driven focus
 *           (the free VIEW, which brings the cursor along) counts: its
 *           position is a chosen point, and useCyberspace's rideView moves
 *           it only when the cursor walks past the field's reach, which
 *           makes it a new chosen point rather than a moving frame. Never
 *           the planet's centre (6371 km deep, the EARTH, CYBERSPACE and
 *           THE RIDE focuses) or a port (ideaspace). Absent otherwise.
 *   radius  2^(scaleExp + SPHERE_HEIGHT_OFFSET) gibsons, an aligned height
 *           like everything else in the space: h54 at 2^49, h53 at 2^48,
 *           down to h37 at 2^32. In meters (2^33 gibsons each) that is
 *           2^21 m, about 2097 km, at the top of the range and 2^4 = 16 m
 *           at the bottom. Thirty-two cells at every zoom, so the circle it
 *           cuts on the ground is always the same size on screen.
 *   active  at SPHERE_SCALE_MAX (2^49) and finer only. At 2^50 and coarser
 *           the globe is drawn whole and the field behaves exactly as it
 *           always has.
 *
 * Inside the sphere the field keeps the identity sample's two promises
 * (sample.ts): the same sphere lights the same dots in every session and
 * on every client, and shrinking it on zoom only drops dots that fell
 * outside and admits ones that were previously beyond the budget, never
 * re-dealing the ones that stayed. Both follow from making the candidate
 * set the GEOMETRIC cull and nothing else: drawnSet over it is a pure
 * function of the set, and for a smaller sphere the set is a subset, which
 * is exactly the nesting case sample.ts proves.
 *
 * On top of the sample, one guaranteed dot: the landfall nearest the
 * centre, by exact fixed-point distance, is always drawn and marked as the
 * nearest, whether or not its hash would have kept it. That is the point
 * of the sphere for arkinox: pick a place, zoom in, read the nearest block,
 * ride there. It is one extra point over the thousand, so it changes
 * nothing about the sample's determinism or nesting.
 *
 * All of the distance arithmetic here is bigint: a coordinate is 85 bits
 * and a radius at the top of the range is 2^54, so a Number would round a
 * point one gibson outside the sphere onto its boundary.
 */

import type { Plane } from 'cyberspace-core'
import type { Position } from '../space'
import { csMetresToLatLon, originCsMetres } from '../earthSurface'
import { drawnSet } from './sample'

/** The finest zoom at which the whole globe is still drawn is 2^50; the sphere takes over below it. */
/**
 * The zoom the planet is legible at: one cell is 2^52 gibsons, about 524 km,
 * so the whole Earth sits in a couple of dozen cells. What the EARTH button
 * and the EARTH key both frame it at.
 */
export const EARTH_SCALE_EXP = 52

export const SPHERE_SCALE_MAX = 49

/** The sphere's height is the zoom's exponent plus this: 32 cells of radius at every zoom. */
export const SPHERE_HEIGHT_OFFSET = 5

/**
 * How far from the WGS84 ellipsoid a focus may sit and still count as a
 * point on Earth. Landfalls and globe clicks are on it to a nanometer; a
 * meter admits all of them and excludes everything that is not the ground.
 */
export const SURFACE_TOLERANCE_M = 1

export interface InterestSphere {
  /** The focus the sphere is centred on, on the surface. */
  centre: Position
  /** 2^height gibsons. */
  radius: bigint
  /** The aligned height the radius is: scaleExp + SPHERE_HEIGHT_OFFSET. */
  height: number
}

/** The part of the store's focus the sphere reads. */
export interface FocusLike {
  position: Position
  plane: Plane
  drive?: boolean
}

/** The sphere's height at a zoom: h54 at 2^49, h37 at 2^32. */
/**
 * The ring's radius in cells, at every zoom: the sphere is
 * 2^(scaleExp + 5) gibsons and a cell is 2^scaleExp, so the ratio is
 * 2^5 = 32 whatever the zoom. That is why the circle is the same size on
 * screen all the way down.
 */
export const SPHERE_RADIUS_CELLS = 2 ** SPHERE_HEIGHT_OFFSET

/** The zoom at which a dot inside the sphere is drawn at its full size. */
export const DOT_FULL_SCALE_EXP = 46
/** What fraction of full size a dot is drawn at where the sphere first appears (2^49). */
export const DOT_TOP_FRACTION = 0.5

/**
 * How large a dot inside the sphere is drawn, as a fraction of its full size.
 *
 * The sphere replaces the attenuated crust at 2^49, and the crust's dots
 * there are small: a fixed five pixels a step later read as a different
 * kind of thing, and with thousands inside the sphere, as a sheet. So the
 * dots come in at half size where the sphere begins and grow linearly to
 * full size by 2^46, where a sphere holds a few hundred stops and each one
 * is worth its full mark. Below that nothing changes. arkinox's ladder of
 * 2026-09-24: 2^50 fine, 2^49 unreadable, 2^48 too crowded, 2^47 and 2^46
 * acceptable; this and the budget make 50 to 45 one slope.
 */
export function sphereDotScale(scaleExp: number): number {
  if (scaleExp <= DOT_FULL_SCALE_EXP) return 1
  const span = SPHERE_SCALE_MAX - DOT_FULL_SCALE_EXP
  const t = Math.min(1, (scaleExp - DOT_FULL_SCALE_EXP) / span)
  return 1 - t * (1 - DOT_TOP_FRACTION)
}

/**
 * How far the camera must sit from the centre for the whole ring to be in
 * shot, in cells.
 *
 * A perspective camera at distance d shows d * tan(fov / 2) cells either
 * side of what it looks at, so a ring 32 cells out needs 32 / tan(fov / 2),
 * which at the scene's 55 degrees is 61.5 cells, plus a margin so the circle
 * does not sit exactly on the frame edge. The scene's own starting distance
 * is 26 cells, which frames 13.5: the ring was always outside the shot, which
 * is why the boundary could not be seen even when it was drawn.
 */
export function sphereFrameDistance(fovDeg: number, margin = 1.12): number {
  return (SPHERE_RADIUS_CELLS / Math.tan((fovDeg * Math.PI) / 360)) * margin
}

/**
 * What the ring says about how crowded it is: "1,000 of 24,318 hyperjumps
 * highlighted", or "133 of 133" when everything inside is drawn.
 *
 * Both numbers are exact. Inside a sphere the stop field switches its
 * identity prefilter off (StopField.ADMIT_ALL) and decodes every row in the
 * ball cover, so the count of stops inside is counted rather than projected;
 * `drawn` is what survived the thousand-point budget. Nothing here is ever
 * an estimate, so nothing here says "about".
 */
export function densityLabel(drawn: number, inside: number): string {
  const n = (v: number): string => v.toLocaleString('en-US')
  return `${n(drawn)} of ${n(inside)} hyperjump${inside === 1 ? '' : 's'} highlighted`
}

export function sphereHeight(scaleExp: number): number {
  return scaleExp + SPHERE_HEIGHT_OFFSET
}

/** Whether a dataspace position lies on Earth's surface, to the tolerance above. */
export function onEarthSurface(position: Position): boolean {
  const { altM } = csMetresToLatLon(originCsMetres(position))
  return Math.abs(altM) <= SURFACE_TOLERANCE_M
}

/**
 * The sphere of interest for a focus at a zoom, or null when there is none:
 * above 2^49, without a focus, or with a focus that is not a point on
 * Earth's surface in dataspace. Whether the cursor came along (`drive`) does
 * not matter: what is looked at is a point either way.
 */
export function interestSphere(focus: FocusLike | null, scaleExp: number): InterestSphere | null {
  if (scaleExp > SPHERE_SCALE_MAX) return null
  if (focus === null || focus.plane !== 0) return null
  if (!onEarthSurface(focus.position)) return null
  const height = sphereHeight(scaleExp)
  return {
    centre: { x: focus.position.x, y: focus.position.y, z: focus.position.z },
    radius: 1n << BigInt(height),
    height,
  }
}

/** Squared distance from the sphere's centre to a point, in gibsons squared, exact. */
export function sphereDistance2(sphere: InterestSphere, x: bigint, y: bigint, z: bigint): bigint {
  const dx = x - sphere.centre.x
  const dy = y - sphere.centre.y
  const dz = z - sphere.centre.z
  return dx * dx + dy * dy + dz * dz
}

/** Whether a point is inside the sphere, boundary included, decided in fixed point. */
export function insideSphere(sphere: InterestSphere, x: bigint, y: bigint, z: bigint): boolean {
  return sphereDistance2(sphere, x, y, z) <= sphere.radius * sphere.radius
}

/** Floor of the square root of a non-negative bigint, by Newton's method. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('isqrt of a negative')
  if (n < 2n) return n
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1)
  for (;;) {
    const y = (x + n / x) >> 1n
    if (y >= x) return x
    x = y
  }
}

/**
 * A candidate closer to the centre than this is the centre's own stop. A
 * landfall focus puts the sphere on the stop's exact decimal coordinate,
 * and the index holds that same stop at its float shortcut, a few gibsons
 * away; naming it as the nearest, at a distance of under a nanometer,
 * would tell the user nothing. The nearest is measured among the OTHER
 * stops, so that clicking a block and zooming in names its neighbour.
 * One meter: no two landfalls are that close, and no click is.
 */
export const SELF_GIBSONS = 1n << 33n

/**
 * The candidate nearest the centre, given heights and their squared
 * distances (parallel arrays), ties to the lower height so the answer is
 * total. A candidate within SELF_GIBSONS of the centre is the centre
 * itself and is passed over. Null when no other candidate exists.
 */
export function nearestOf(heights: ArrayLike<number>, d2: ArrayLike<bigint>): { height: number; d2: bigint } | null {
  const self = SELF_GIBSONS * SELF_GIBSONS
  let best: { height: number; d2: bigint } | null = null
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i]
    const d = d2[i]
    if (d < self) continue
    if (best === null || d < best.d2 || (d === best.d2 && h < best.height)) best = { height: h, d2: d }
  }
  return best
}

export interface SphereSelection {
  /** Every height to draw: the identity sample, plus the nearest if it was not already in it. */
  drawn: Set<number>
  /** The nearest candidate, with its exact squared distance from the centre, or null when there were none. */
  nearest: { height: number; d2: bigint } | null
}

/**
 * What the field draws inside the sphere: drawnSet over the candidates at
 * the budget, which is deterministic and nested in the candidate set, and
 * the nearest candidate on top. The nearest is added to the set rather
 * than drawn twice when the sample already had it.
 */
export function sphereSelection(
  heights: ArrayLike<number>,
  d2: ArrayLike<bigint>,
  budget: number,
): SphereSelection {
  const drawn = drawnSet(heights, budget)
  const nearest = nearestOf(heights, d2)
  if (nearest !== null) drawn.add(nearest.height)
  return { drawn, nearest }
}
