/**
 * nearby.ts — what has been decrypted where you stand.
 *
 * A hidden thing lives in one aligned cube, the region its key opens: side
 * 2^height around the point it was placed at, base per axis the point with
 * its low `height` bits cleared. It is nearby when the cube holds the anchor
 * on every axis and the planes match. A key you hold is a region too, a box
 * with a height per axis, and anything filed under that key's lookup id is
 * nearby whenever that box holds the anchor. Nearest first, by the largest
 * axis distance from the anchor.
 */

import type { Plane } from 'cyberspace-core'
import type { Position } from './space'

export interface NearbyRegion {
  base: { x: bigint | string; y: bigint | string; z: bigint | string }
  heights: { x: number; y: number; z: number }
}

export interface NearbyCandidate {
  key: string
  at: Position
  plane: Plane
  height: number
  lookupId?: string
}

export interface NearbyKey {
  lookupId: string
  plane: Plane
  height: number
  heights?: { x: number; y: number; z: number }
  base: { x: string; y: string; z: string }
}

function aligned(v: bigint, h: number): bigint {
  const s = BigInt(h)
  return (v >> s) << s
}

/** Whether a box (a base and a height per axis) holds a point. */
export function regionContains(region: NearbyRegion, p: Position): boolean {
  for (const a of ['x', 'y', 'z'] as const) {
    if (aligned(p[a], region.heights[a]) !== BigInt(region.base[a])) return false
  }
  return true
}

/** The cube of side 2^height around an item's point holds the anchor. */
export function itemNearby(item: { at: Position; height: number; plane: Plane }, anchor: Position, plane: Plane): boolean {
  if (item.plane !== plane) return false
  const h = { x: item.height, y: item.height, z: item.height }
  const base = { x: aligned(item.at.x, item.height), y: aligned(item.at.y, item.height), z: aligned(item.at.z, item.height) }
  return regionContains({ base, heights: h }, anchor)
}

/** The largest axis distance from the anchor, in gibsons. */
export function axisDistance(at: Position, anchor: Position): bigint {
  let far = 0n
  for (const a of ['x', 'y', 'z'] as const) {
    const d = at[a] > anchor[a] ? at[a] - anchor[a] : anchor[a] - at[a]
    if (d > far) far = d
  }
  return far
}

/**
 * The items decrypted in the region the anchor stands in: those whose own
 * cube holds the anchor, plus those filed under a held key whose region
 * holds the anchor. Nearest first.
 */
export function nearbyItems<T extends NearbyCandidate>(items: T[], keys: NearbyKey[], anchor: Position, plane: Plane): Array<T & { distance: bigint }> {
  const openHere = new Set<string>()
  for (const k of keys) {
    if (k.plane !== plane) continue
    const heights = k.heights ?? { x: k.height, y: k.height, z: k.height }
    if (regionContains({ base: k.base, heights }, anchor)) openHere.add(k.lookupId)
  }
  return items
    .filter((it) => itemNearby(it, anchor, plane) || (it.lookupId !== undefined && it.plane === plane && openHere.has(it.lookupId)))
    .map((it) => ({ ...it, distance: axisDistance(it.at, anchor) }))
    .sort((a, b) => (a.distance < b.distance ? -1 : a.distance > b.distance ? 1 : 0))
}

/** The toast's line: how many were found here. */
export function foundLabel(count: number): string {
  return `${count} FOUND HERE`
}
