/**
 * viewAt.ts - a place to look at, typed in.
 *
 * The free view (arkinox, 2026-09-07): move the view anywhere in cyberspace
 * without the chain line and the grid coming along, which is what focusing
 * does. This reads what a person types into the POSITION panel: three
 * decimal axis values separated by commas or spaces, a 64-hex coordinate as
 * the c and C tags carry it, or a latitude and longitude, which names a
 * point on Earth through the canonical GPS mapping (landfall.ts
 * gpsToDataspaceXyz) and arrives at 2^38, thirty-two metres a cell. A place
 * by name is not parsed here: it needs a lookup, and that is the panel's to
 * do; what comes back is a latitude and longitude, which this reads.
 */

import { AXIS_MAX, coordToXyz, type Plane } from 'cyberspace-core'
import type { Position } from './space'
import { parseLatLon } from './geocode'
import { gpsToDataspaceXyz } from './hyperspace/landfall'

export interface ViewTarget {
  position: Position
  plane: Plane
  label: string
  /** The zoom to arrive at, when the place implies one; a coordinate keeps the zoom you had. */
  scaleExp?: number
}

/** Where a typed place on Earth lands: 2^38, thirty-two metres a cell, a few streets across the grid. */
export const PLACE_SCALE = 38

/** The place a typed string names, or null when it names nothing. */
export function parseViewAt(text: string, plane: Plane): ViewTarget | null {
  const t = text.trim()
  if (/^[0-9a-f]{64}$/i.test(t)) {
    const c = coordToXyz(BigInt('0x' + t))
    return { position: { x: c.x, y: c.y, z: c.z }, plane: c.plane, label: `${t.slice(0, 8)}…${t.slice(-4)}` }
  }
  // Two numbers are a latitude and a longitude, a point on the planet. Three
  // are axis values, so the two shapes never meet.
  const geo = parseLatLon(t)
  if (geo) {
    const { x, y, z } = gpsToDataspaceXyz(geo.lat, geo.lon)
    return { position: { x, y, z }, plane: 0, label: `${geo.lat}, ${geo.lon}`, scaleExp: PLACE_SCALE }
  }
  const parts = t.split(/[\s,]+/).filter(Boolean)
  if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p))) return null
  const [x, y, z] = parts.map((p) => BigInt(p))
  if ([x, y, z].some((v) => v > AXIS_MAX)) return null
  return { position: { x, y, z }, plane, label: parts.map(short).join(', ') }
}

/** "19342813102987152433021963" reads as "19342…21963". */
function short(n: string): string {
  return n.length > 12 ? `${n.slice(0, 5)}…${n.slice(-5)}` : n
}

/** An axis value, shortened the same way. */
export function shortAxis(n: bigint): string {
  return short(n.toString())
}

/** A remembered place: what was typed, canonically, and how it is shown. */
export interface RecentView { input: string; label: string; plane: Plane }

/** The same place typed two ways is one entry: decimals become "x, y, z", a coordinate its lowercase hex. */
export function canonicalViewAt(text: string): string {
  const t = text.trim()
  if (/^[0-9a-f]{64}$/i.test(t)) return t.toLowerCase()
  return t.split(/[\s,]+/).filter(Boolean).join(', ')
}

/** The list with `entry` at the front, its earlier copy gone, three at most. */
export function rememberView(list: RecentView[], entry: RecentView): RecentView[] {
  return [entry, ...list.filter((r) => r.input !== entry.input || r.plane !== entry.plane)].slice(0, 3)
}

/**
 * A place dropped from the recent list, by the same identity rememberView uses
 * to replace one: the text typed and the plane it was read on. Nothing else in
 * the entry is part of what makes it that place, and matching on the label
 * would drop two different coordinates that happen to share a name.
 */
export function forgetView(list: RecentView[], entry: Pick<RecentView, 'input' | 'plane'>): RecentView[] {
  return list.filter((r) => r.input !== entry.input || r.plane !== entry.plane)
}
