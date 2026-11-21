/**
 * viewAt.ts - a place to look at, typed in.
 *
 * The free view (arkinox, 2026-09-07): move the view anywhere in cyberspace
 * without the chain line and the grid coming along, which is what focusing
 * does. This reads what a person types into the View panel: three
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

/**
 * A remembered place: what was typed, canonically, and how it is shown.
 * `pinned` keeps it in the list until it is removed by hand: the End of
 * Chain a respawn leaves is pinned, so three later lookups cannot push the
 * way back to a frozen chain out of the list.
 */
export interface RecentView { input: string; label: string; plane: Plane; pinned?: boolean }

/** How many places the list keeps, pinned ones aside. */
export const RECENT_VIEWS_KEPT = 3

/** The same place typed two ways is one entry: decimals become "x, y, z", a coordinate its lowercase hex. */
export function canonicalViewAt(text: string): string {
  const t = text.trim()
  if (/^[0-9a-f]{64}$/i.test(t)) return t.toLowerCase()
  return t.split(/[\s,]+/).filter(Boolean).join(', ')
}

/**
 * The list with `entry` at the front and its earlier copy gone: every pinned
 * place, and three unpinned ones at most. A place already pinned stays
 * pinned when it is looked at again.
 */
export function rememberView(list: RecentView[], entry: RecentView): RecentView[] {
  const same = (r: RecentView): boolean => r.input === entry.input && r.plane === entry.plane
  const front = list.find(same)?.pinned ? { ...entry, pinned: true } : entry
  let unpinned = 0
  return [front, ...list.filter((r) => !same(r))].filter((r) => r.pinned === true || ++unpinned <= RECENT_VIEWS_KEPT)
}

/** Entries as this app can use them, from whatever was stored. */
export function cleanRecentViews(raw: unknown): RecentView[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((r): r is RecentView => typeof r?.input === 'string' && typeof r?.label === 'string' && (r?.plane === 0 || r?.plane === 1))
}

/**
 * The recent places of the identity signed in (store/recentViewsList.ts keeps
 * them per identity in IndexedDB; owner ruling, 2026-11-19), held here so
 * the View panel and addRecentView read them at once.
 */
let recent: RecentView[] = []
let persist: ((list: RecentView[]) => void) | null = null

/** The list as the View panel shows it: every pinned place and three others at most. */
export function readRecentViews(): RecentView[] {
  let unpinned = 0
  return recent.filter((r) => r.pinned === true || ++unpinned <= RECENT_VIEWS_KEPT)
}

/** Keep the list as changed by the View panel, for the identity signed in. */
export function saveRecentViews(list: RecentView[]): void {
  recent = list
  persist?.(list)
}

/** Show another identity's list (or this one's, read back): the panel reloads it without opening. */
export function showRecentViews(list: RecentView[]): void {
  recent = list
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(RECENT_VIEWS_SHOWN))
}

/** Where changes go to be kept (store/recentViewsList.ts). */
export function setRecentViewsPersister(fn: ((list: RecentView[]) => void) | null): void {
  persist = fn
}

/** The device-wide list builds before 2026-11-19 kept in localStorage, for adoption; undefined when there is none. */
export function legacyRecentViews(): unknown {
  try {
    const raw = localStorage.getItem(RECENT_VIEWS_KEY)
    return raw === null ? undefined : JSON.parse(raw) as unknown
  } catch { return undefined }
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

/** Where builds before 2026-11-19 kept the recent places, once per device; now only read, to adopt (legacyRecentViews). */
export const RECENT_VIEWS_KEY = 'onosendai:view-recent'

/** Sent on window when a place is added to the recent list from outside the View panel, which reloads it. */
export const RECENT_VIEWS_EVENT = 'onosendai:view-recent'

/** Sent on window when the list shown is another identity's, or was read back: the panel reloads it and stays as it was. */
export const RECENT_VIEWS_SHOWN = 'onosendai:view-recent:shown'

/**
 * Put a place at the front of the View panel's recent list from
 * anywhere: the list of the identity signed in, through rememberView like a
 * typed place, and an event so a panel already on screen shows it. The
 * respawn from a broken chain leaves its End of Chain entry here (arkinox,
 * 2026-10-07, Q3), so the place the old chain froze at is one tap away.
 */
export function addRecentView(entry: RecentView): RecentView[] {
  const next = rememberView(recent, entry)
  saveRecentViews(next)
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(RECENT_VIEWS_EVENT))
  return next
}
