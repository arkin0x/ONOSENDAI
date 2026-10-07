/**
 * starred.ts - Starred Places: coordinates you marked to come back to.
 *
 * arkinox, 2026-10-07: whenever the cursor or the view is off your own
 * avatar, an empty star stands where the CHAT chip sits; pressing it adds
 * that spot to your Starred Places, listed under RECENT in the POSITION
 * panel, and tapping one there goes back to it the way a recent place does.
 *
 * Which spot is starred is whatever sits at the center of the screen. When
 * the cursor can be driven (at your head, or in a free view that brought it
 * along), the camera follows the cursor, so the spot is the cursor and the
 * plane it is lined up in. When it cannot (spectating, exploring your own
 * history, flying to a shard or a region, riding hyperspace), the cursor is
 * not what you are looking at, so the spot is the view's focus: the focused
 * place when there is one, otherwise the anchor the scene is drawn around.
 * When that spot is your avatar's own coordinate, plane included, there is
 * nothing to star and the CHAT chip stays.
 *
 * The list is per device, not per identity: a place is a coordinate, and a
 * coordinate means the same thing whoever is signed in, so switching keys
 * keeps the places you starred.
 */

import type { Plane } from 'cyberspace-core'
import type { Position } from './space'
import { shortAxis, type RecentView } from './viewAt'

/**
 * A starred place: a recent place's shape (the canonical "x, y, z" text, how
 * it is shown, the plane it is read on) plus when it was starred and the zoom
 * it was starred at, so going back shows it as it was seen.
 */
export interface StarredPlace extends RecentView {
  /** Milliseconds since the epoch, when the star was pressed. */
  at: number
  /** The zoom when it was starred; going back restores it. */
  scaleExp?: number
}

/** The spot the star chip would star: a coordinate, its plane, and how to show it. */
export interface StarSpot {
  position: Position
  plane: Plane
  label: string
  /** The canonical text the place is kept under: decimal axes, "x, y, z". */
  input: string
}

/** Where the list lives on this device. Shared by every identity signed in here. */
export const STARRED_KEY = 'onosendai:starred-places'

/** The most places kept. Starring past this drops the oldest. */
export const MAX_STARRED = 100

/** The parts of the scene's state the star reads. */
export interface StarSource {
  position: Position
  headPlane: Plane
  cursor: Position
  plane: Plane
  anchor: Position
  anchorPlane: Plane
  focus: { position: Position; plane: Plane; label: string } | null
  atHead: () => boolean
  canDrive: () => boolean
}

function same(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

/** "x, y, z" in full decimals: the same text the POSITION panel reads back. */
export function placeInput(p: Position): string {
  return `${p.x}, ${p.y}, ${p.z}`
}

/**
 * The spot at the center of the screen when it is not your avatar, or null
 * when it is (see the header for the rule). The label is the focus's own
 * name when the spot is the focused place (a place on Earth typed by name, an
 * avatar you are viewing, a shard), and otherwise the three axes shortened the
 * way RECENT shows typed axes.
 */
export function starSpot(s: StarSource): StarSpot | null {
  const drive = s.canDrive()
  const position = drive ? s.cursor : (s.focus?.position ?? s.anchor)
  const plane: Plane = drive ? (s.atHead() ? s.plane : s.anchorPlane) : (s.focus?.plane ?? s.anchorPlane)
  if (same(position, s.position) && plane === s.headPlane) return null
  const named = s.focus && same(s.focus.position, position) && s.focus.plane === plane && s.focus.label.trim() !== ''
  const label = named ? s.focus!.label : [position.x, position.y, position.z].map(shortAxis).join(', ')
  return { position: { ...position }, plane, label, input: placeInput(position) }
}

/**
 * Which chip stands at the bottom center while the chat is folded: the star
 * when the spot on screen is somewhere other than your avatar, CHAT when it
 * is your avatar. An unfolded chat is left alone either way.
 */
export function bottomChip(s: StarSource): 'star' | 'chat' {
  return starSpot(s) ? 'star' : 'chat'
}

/** Whether `entry` (by its text and plane, as RECENT matches) is in the list. */
export function isStarred(list: StarredPlace[], entry: Pick<RecentView, 'input' | 'plane'>): boolean {
  return list.some((p) => p.input === entry.input && p.plane === entry.plane)
}

/** The list with `place` at the front, any earlier copy of it gone, MAX_STARRED at most. */
export function addPlace(list: StarredPlace[], place: StarredPlace): StarredPlace[] {
  return [place, ...removePlace(list, place)].slice(0, MAX_STARRED)
}

/** The list without `entry`, matched on its text and plane only (a label is not an identity). */
export function removePlace(list: StarredPlace[], entry: Pick<RecentView, 'input' | 'plane'>): StarredPlace[] {
  return list.filter((p) => p.input !== entry.input || p.plane !== entry.plane)
}

/** When a place was starred, read at a glance: "just now", "5m ago", "3h ago", "2d ago", then the date. */
export function starredWhen(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(at).toLocaleDateString()
}

function valid(p: unknown): p is StarredPlace {
  const r = p as Partial<StarredPlace> | null
  return (
    typeof r?.input === 'string' &&
    typeof r.label === 'string' &&
    (r.plane === 0 || r.plane === 1) &&
    typeof r.at === 'number' &&
    (r.scaleExp === undefined || typeof r.scaleExp === 'number')
  )
}

/** The list as stored on this device; empty when nothing is stored or storage cannot be read. */
export function loadPlaces(): StarredPlace[] {
  try {
    const v = JSON.parse(localStorage.getItem(STARRED_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter(valid).slice(0, MAX_STARRED) : []
  } catch {
    return []
  }
}

/** Keep the list on this device. A storage that refuses (private mode, full) keeps it for this visit only. */
export function savePlaces(list: StarredPlace[]): void {
  try {
    localStorage.setItem(STARRED_KEY, JSON.stringify(list))
  } catch { /* private mode or full: the list still holds for this visit */ }
}
