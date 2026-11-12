/**
 * coordRoute.ts: onosendai.tech/C/<coord256 or a prefix of one> (arkinox,
 * 2026-10-13).
 *
 * A full coordinate, 64 hex characters, is a place: the app opens looking at
 * it, and the scan that follows every move runs there, so what is hidden
 * nearby decrypts as it does after a hop. A shorter run of hex is a region:
 * the coordinate interleaves the axes from the top bit down (x84 y84 z84 x83
 * ... z0, then the plane bit), so the first n hex characters fix the top 4n
 * bits, which is the top few bits of every axis, and the places sharing
 * them fill an aligned box. The app draws that box in yellow and frames it.
 *
 * The plane is the coordinate's lowest bit, so only all 64 characters fix
 * it. A region is drawn in the plane you are in.
 *
 * A Bitcoin block's merkle root as an explorer shows it is a coordinate
 * already (DECK-0001 §1: big-endian, display order): when its low bit is 1
 * the block is a port and its stop sits exactly there, in ideaspace. A root
 * with the low bit 0 is a landfall on Earth, placed by the block hash, so the
 * root itself is not where that stop is; the route looks the root up among
 * the loaded anchors and lands on the stop (store/useCoordRoute.ts).
 *
 * Pure: nothing here reads the store or the window.
 */

import { coordToXyz, xyzToCoord, type Plane } from 'cyberspace-core'
import type { Position } from './space'

/** Bits per axis, and the coordinate's width. */
const AXIS_BITS = 85
const COORD_BITS = 256

export type CoordRoute =
  | { kind: 'full'; hex: string }
  | { kind: 'prefix'; hex: string }
  | { kind: 'invalid'; raw: string }

/** The region a prefix fixes: an aligned box, each axis at its own height. */
export interface PrefixRegion {
  /** The box's low corner. */
  base: Position
  /** Each axis's free low bits: the box is 2^h gibsons along that axis. */
  heights: { x: number; y: number; z: number }
  /** The gibson nearest the box's middle. */
  center: Position
  maxHeight: number
}

/**
 * The route in a path, or null when the path is not one. `/C/` and `/c/`
 * both count; a 0x and surrounding slashes are dropped; case does not matter.
 */
export function parseCoordRoute(pathname: string): CoordRoute | null {
  const m = /^\/c\/(.*)$/i.exec(pathname)
  if (!m) return null
  let raw: string
  try { raw = decodeURIComponent(m[1]) } catch { raw = m[1] }
  const clean = raw.trim().replace(/\/+$/, '').replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{1,64}$/.test(clean)) return { kind: 'invalid', raw }
  return clean.length === 64 ? { kind: 'full', hex: clean } : { kind: 'prefix', hex: clean }
}

/**
 * A /C/ link typed into the View panel's box (arkinox, 2026-11-12): the hex
 * alone, `C/<hex>`, `/C/<hex>`, or a whole http(s) link to one. Read by
 * parseCoordRoute, so the box takes exactly what a link takes. Hex alone
 * counts only with a digit in it, so a place name spelled in hex letters
 * ("cafe", "dead") is still looked up by name. Null for anything else,
 * including a link that is not valid hex.
 */
export function typedCoordRoute(text: string): Exclude<CoordRoute, { kind: 'invalid' }> | null {
  const t = text.trim()
  let path: string
  if (/^https?:\/\//i.test(t)) {
    try { path = new URL(t).pathname } catch { return null }
  } else if (/^\/?c\//i.test(t)) {
    path = t.startsWith('/') ? t : `/${t}`
  } else {
    if (!/\d/.test(t)) return null
    path = `/C/${t}`
  }
  const route = parseCoordRoute(path)
  return route && route.kind !== 'invalid' ? route : null
}

/** A full coordinate as a place and a plane. */
export function coordPlace(hex: string): { position: Position; plane: Plane } {
  const c = coordToXyz(BigInt('0x' + hex))
  return { position: { x: c.x, y: c.y, z: c.z }, plane: c.plane }
}

/**
 * The aligned box a prefix of 1 to 63 hex characters fixes. Coordinate bit b
 * (b >= 1) is axis bit floor((b - 1) / 3) of z, y or x for (b - 1) mod 3 =
 * 0, 1, 2; the prefix fixes bits 255 down to 256 - 4n, and every lower bit
 * is free, so an axis's height is how many of its bits sit below the prefix.
 */
export function prefixRegion(hex: string): PrefixRegion {
  if (!/^[0-9a-f]{1,63}$/.test(hex)) throw new Error('A region prefix is 1 to 63 lowercase hex characters')
  const freeBits = COORD_BITS - hex.length * 4
  const low = coordToXyz(BigInt('0x' + hex) << BigInt(freeBits))
  const height = (offset: number): number => {
    let h = 0
    for (let i = 0; i < AXIS_BITS; i++) if (offset + 3 * i < freeBits) h++
    return h
  }
  const heights = { x: height(3), y: height(2), z: height(1) }
  const base: Position = { x: low.x, y: low.y, z: low.z }
  const mid = (v: bigint, h: number): bigint => (h === 0 ? v : v + (1n << BigInt(h - 1)))
  return {
    base,
    heights,
    center: { x: mid(base.x, heights.x), y: mid(base.y, heights.y), z: mid(base.z, heights.z) },
    maxHeight: Math.max(heights.x, heights.y, heights.z),
  }
}

/** The 64 hex of a place, the form a link carries. */
export function placeHex(position: Position, plane: Plane): string {
  return xyzToCoord(position.x, position.y, position.z, plane).toString(16).padStart(64, '0')
}

/** A shareable link to a place, on whatever origin is serving the app. */
export function coordLink(origin: string, hex: string): string {
  return `${origin.replace(/\/+$/, '')}/C/${hex}`
}

/**
 * The scale that frames a box of height h: about 8 cells across. At 16 the
 * near face of a cube filled more than the phone's width from the camera's
 * standing distance, so the box's edges left the screen.
 */
export function frameScale(maxHeight: number, maxScale: number): number {
  return Math.max(0, Math.min(maxScale, maxHeight - 3))
}

/**
 * The cell of zoom `scaleExp` that holds `p`: its low and high gibson corners
 * (both inclusive). A region selected at a zoom must hold whole cells, not
 * the cursor's one gibson, so the covering prefix is grown from both corners.
 */
export function cellCorners(p: Position, scaleExp: number): [Position, Position] {
  const s = BigInt(Math.max(0, scaleExp))
  const lo = (v: bigint): bigint => (v >> s) << s
  const span = (1n << s) - 1n
  const l: Position = { x: lo(p.x), y: lo(p.y), z: lo(p.z) }
  return [l, { x: l.x + span, y: l.y + span, z: l.z + span }]
}

/** How many leading characters two strings share. */
function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return i
}

/**
 * The smallest /C/ prefix whose region holds every one of `points`, with the
 * box it fixes, or null when none does (the points span the whole space, so
 * the only box holding them is all of cyberspace, which is not a region).
 *
 * The prefix is the points' longest shared run of the interleaved coordinate
 * hex, clamped to 63 characters: a region of 1 to 63 hex never reaches the
 * plane bit (the coordinate's lowest), so `plane` only has to be the same for
 * every point, never right. The box comes back from prefixRegion, so a
 * selection matches the relay's shared region vectors exactly
 * (regionPrefixVectors.test.ts).
 */
export function coveringPrefix(points: readonly Position[], plane: Plane): { prefix: string; region: PrefixRegion } | null {
  if (points.length === 0) return null
  const hexes = points.map((p) => placeHex(p, plane))
  let n = hexes[0].length
  for (let i = 1; i < hexes.length; i++) n = Math.min(n, commonPrefixLen(hexes[0], hexes[i]))
  // A prefix of 64 fixes the plane and is a place, not a region: the finest
  // region is 63 hex, a 2x2x2 box of gibsons.
  n = Math.min(n, 63)
  if (n < 1) return null
  const prefix = hexes[0].slice(0, n)
  return { prefix, region: prefixRegion(prefix) }
}

/**
 * The region that covers the cells of `positions` at zoom `scaleExp`: the
 * smallest valid /C/ prefix, or null when there is none. Each position
 * contributes its whole cell (both corners), so the region grows to hold the
 * cells, not just the points. Used by region mode to grow the selection to
 * the entry cell and the cursor cell, and to collapse it to one cell.
 */
export function coveringRegion(positions: readonly Position[], scaleExp: number, plane: Plane): { prefix: string; region: PrefixRegion } | null {
  const corners: Position[] = []
  for (const p of positions) corners.push(...cellCorners(p, scaleExp))
  return coveringPrefix(corners, plane)
}
