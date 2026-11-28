/**
 * stayLock.ts - what STAY IN THIS CHUNK and the crossing line remember, with
 * nothing above it: store/useTerrain.ts reads it (the lock's wall joins the
 * blocks' walls; mining notes the chunk dug), and terrain/chunkStay.ts runs it.
 *
 * - The lock: the chunk each identity stays in (by owner, as the field names
 *   it: the pubkey, or 'local'), in memory only, so a reload never brings it
 *   back (the brief: "persist it per npub only for the session").
 * - The chunks dug: every chunk this page mined, blasted or smashed a block
 *   in, by owner, so leaving one says so (terrain/chunkStay.ts).
 */

import { create } from 'zustand'
import { parseChunkKey } from '../lib/terrain/coords'
import { stayWallItem } from '../lib/terrain/chunkWall'
import type { WallItem } from '../store/walkWalls'

interface StayLockState {
  /** The chunk each owner stays in (its key), while STAY IN THIS CHUNK is on. */
  locks: Readonly<Record<string, string>>
}

export const useStayLock = create<StayLockState>(() => ({ locks: {} }))

/** The chunk `owner` stays in, or null. */
export function lockedFor(owner: string): string | null {
  return useStayLock.getState().locks[owner] ?? null
}

/** Stay in the chunk `key` (null lets go), for `owner`. */
export function setLock(owner: string, key: string | null): void {
  const locks = useStayLock.getState().locks
  if ((locks[owner] ?? null) === key) return
  const next = { ...locks }
  if (key) next[owner] = key
  else delete next[owner]
  useStayLock.setState({ locks: next })
}

/** Let go of every lock. */
export function clearLocks(): void {
  if (Object.keys(useStayLock.getState().locks).length) useStayLock.setState({ locks: {} })
}

const dug = new Set<string>()

/** A block was taken in the chunk `key` (mined, blasted or smashed) by `owner`. */
export function noteDug(owner: string, key: string): void {
  dug.add(`${owner}|${key}`)
}

/** Whether `owner` took a block in the chunk `key` on this page. */
export function dugIn(owner: string, key: string): boolean {
  return dug.has(`${owner}|${key}`)
}

/** For tests: forget the chunks dug and every lock. */
export function resetStay(): void {
  dug.clear()
  clearLocks()
}

/** The wall last made, kept while the lock stays on the same chunk, so WALK's walls keep the same item. */
let made: { key: string; item: WallItem } | null = null

/** STAY IN THIS CHUNK's wall for `owner` in `plane` (lib/terrain/chunkWall.ts), or null while the lock is off. */
export function stayWallFor(owner: string, plane: number): WallItem | null {
  const key = lockedFor(owner)
  if (!key) return null
  const base = parseChunkKey(key)
  if (!base || base.plane !== plane) return null
  if (made?.key !== key) made = { key, item: stayWallItem(base, key) }
  return made.item
}
