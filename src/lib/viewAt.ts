/**
 * viewAt.ts - a place to look at, typed in.
 *
 * The free view (arkinox, 2026-09-07): move the view anywhere in cyberspace
 * without the chain line and the grid coming along, which is what focusing
 * does. This reads what a person types into the POSITION panel: three
 * decimal axis values separated by commas or spaces, or a 64-hex coordinate
 * as the c and C tags carry it.
 */

import { AXIS_MAX, coordToXyz, type Plane } from 'cyberspace-core'
import type { Position } from './space'

export interface ViewTarget { position: Position; plane: Plane; label: string }

/** The place a typed string names, or null when it names nothing. */
export function parseViewAt(text: string, plane: Plane): ViewTarget | null {
  const t = text.trim()
  if (/^[0-9a-f]{64}$/i.test(t)) {
    const c = coordToXyz(BigInt('0x' + t))
    return { position: { x: c.x, y: c.y, z: c.z }, plane: c.plane, label: `${t.slice(0, 8)}…${t.slice(-4)}` }
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

/** A remembered place: what was typed, canonically, and how it is shown. */
export interface RecentView { input: string; label: string }

/** The same place typed two ways is one entry: decimals become "x, y, z", a coordinate its lowercase hex. */
export function canonicalViewAt(text: string): string {
  const t = text.trim()
  if (/^[0-9a-f]{64}$/i.test(t)) return t.toLowerCase()
  return t.split(/[\s,]+/).filter(Boolean).join(', ')
}

/** The list with `entry` at the front, its earlier copy gone, three at most. */
export function rememberView(list: RecentView[], entry: RecentView): RecentView[] {
  return [entry, ...list.filter((r) => r.input !== entry.input)].slice(0, 3)
}
