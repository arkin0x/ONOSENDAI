/**
 * chunkStay.ts - knowing when you leave the chunk you were digging (owner,
 * 2026-11-28: "Often I am excavating a specific chunk to find a specific
 * resource it has, and if I accidentally walk into the next chunk over it's
 * annoying"). Three parts work together in TERRAIN:
 *
 * - The glow wall (scene/ChunkWall.tsx; lib/terrain/chunkWall.ts the
 *   numbers): within a few steps of the chunk's edge, the nearest faces glow
 *   in TERRAIN's mint with the gibson grid, so you can see where the line is.
 *   It shows for a chunk surveyed for you, where there is something to dig,
 *   and for the chunk you stay in.
 * - The crossing line: leave a chunk you took a block from on this page and
 *   the message slot under the cross says so, and says when the chunk you
 *   walked into is not surveyed. Nothing is said for any other crossing, so
 *   walking about stays quiet.
 * - STAY IN THIS CHUNK: a switch on the survey card. While it is on, the
 *   chunk's faces are walls to WALK (store/useTerrain.ts publishWalls), so a
 *   step that would cross is not taken, and the glow wall shows solid with a
 *   lock. A chip by CARD shows it is on; a tap on the chip lets go. It is
 *   this device's alone (no protocol, nothing published), remembered per
 *   identity for the page only, and it lets go by itself on anything that
 *   takes you away: leaving TERRAIN (a HOP included: TERRAIN is WALK), a
 *   hyperjump's ride, a respawn, or anything else that puts you outside the
 *   chunk. Never during the tutorial's tour.
 *
 * And a guard for SURVEY: a press that began before you crossed into a chunk,
 * within the last CARRIED_MS, never turns into a survey of it (TerrainView.tsx
 * pressCard). Surveying still always takes its full 5 second hold.
 */

import { create } from 'zustand'
import { chunkKey, chunkOf } from '../lib/terrain/coords'
import { headNow, offsetOf, terrainSession, useTerrain } from '../store/useTerrain'
import { surveyedForYou } from '../store/terrainShare'
import { useCyberspace } from '../store/useCyberspace'
import { useTutorial } from '../store/useTutorial'
import { clearLocks, dugIn, lockedFor, setLock, useStayLock } from './stayLock'

/** A press carried across into a chunk this long ago or less never starts a survey there. */
export const CARRIED_MS = 3000
/** The same crossing (from one chunk to another) is said again only after this long, so pacing along an edge stays quiet. */
export const CROSSING_QUIET_MS = 10_000

/** The line under the cross when you leave a chunk you dug in, by what the chunk you walked into is. */
export const LEFT_DUG = 'Left the chunk you were digging'
export const LEFT_DUG_UNSURVEYED = 'Left the chunk you were digging: now in an unsurveyed chunk'

/** Whose field this is, as the field names its owner (store/useTerrain.ts syncOnce). */
export function ownerNow(): string {
  return useCyberspace.getState().identity.pubkey || 'local'
}

/** The chunk you stand in (its key), from your place in the walk: computed, loaded or not. */
export function chunkHere(): string {
  const at = headNow()
  return chunkKey(chunkOf(at.x, at.y, at.z, useCyberspace.getState().plane))
}

/**
 * Whether the chunk you stand in is surveyed for you: true or false, or null
 * while it is not loaded (nothing then is said about it).
 */
function hereSurveyed(): boolean | null {
  const s = terrainSession
  if (!s) return null
  const w = offsetOf(s, headNow())
  const slot = s.world.slotAtCs(w[0], w[1], w[2])
  if (!slot || !slot.inSpace) return null
  return s.surveyedKeys.has(slot.key) || surveyedForYou(slot.key)
}

/** What the line under the cross says on leaving `from` (null to say nothing): only when you dug there. */
export function crossingWords(dug: boolean, surveyed: boolean | null): string | null {
  if (!dug) return null
  return surveyed === false ? LEFT_DUG_UNSURVEYED : LEFT_DUG
}

interface ChunkStayState {
  /** The chunk you stand in, by key, while TERRAIN is on (null otherwise). */
  here: string | null
}

/** Where you stand, for the glow wall and the chip (the scene reads it each frame; it changes only on a crossing). */
export const useChunkStay = create<ChunkStayState>(() => ({ here: null }))

/** When you last crossed into another chunk (performance.now), or -Infinity. */
let crossedAt = -Infinity
/** When each crossing (from>to) was last said. */
const said = new Map<string, number>()

/** For tests: forget the crossings. */
export function resetCrossings(): void {
  crossedAt = -Infinity
  said.clear()
  useChunkStay.setState({ here: null })
}

/**
 * Whether a press that began at `since` was carried across into the chunk you
 * stand in: you crossed after it began, CARRIED_MS ago or less. Such a press
 * never starts a survey (the brief: "if you crossed in during the last 3
 * seconds while holding the button, don't start a survey from that held press").
 */
export function carriedAcross(since: number, now: number = performance.now()): boolean {
  return crossedAt >= since && now - crossedAt <= CARRIED_MS
}

/** The chunk you stay in now, or null. */
export function stayKey(): string | null {
  return lockedFor(ownerNow())
}

/** The chunk you stay in, or null, as React state. */
export function useStayKey(): string | null {
  const owner = useCyberspace((c) => c.identity.pubkey || 'local')
  return useStayLock((s) => s.locks[owner] ?? null)
}

/** Whether STAY IN THIS CHUNK can be switched on now: in TERRAIN, out of the tour. */
export function canStay(): boolean {
  return useTerrain.getState().active && !useTutorial.getState().active
}

/** Stay in the chunk `key`, the one you stand in; or nothing, when that is not where you stand or it cannot be on now. True when it is on. */
export function stayIn(key: string): boolean {
  if (!canStay() || key !== chunkHere()) return false
  setLock(ownerNow(), key)
  return true
}

/** Let go of STAY IN THIS CHUNK. */
export function leaveStay(): void {
  setLock(ownerNow(), null)
}

/** A step, or anything that moved you: a crossing is noted, said when it should be, and a lock you are no longer in lets go. */
function moved(now: number = performance.now()): void {
  if (!useTerrain.getState().active) return
  const key = chunkHere()
  const from = useChunkStay.getState().here
  if (key === from) return
  useChunkStay.setState({ here: key })
  if (from === null) return
  crossedAt = now
  const owner = ownerNow()
  // The lock holds every step, so being outside it means something else moved you (a ride, a respawn): it lets go.
  const lock = lockedFor(owner)
  if (lock && lock !== key) setLock(owner, null)
  const words = crossingWords(dugIn(owner, from), hereSurveyed())
  if (!words) return
  const pair = `${from}>${key}`
  if (now - (said.get(pair) ?? -Infinity) < CROSSING_QUIET_MS) return
  said.set(pair, now)
  useTerrain.getState().say(words)
}

useCyberspace.subscribe((c, prev) => {
  // A hyperjump's ride, or a respawn (a new chain), lets go of every lock.
  if ((c.transit !== null && prev.transit === null) || (prev.events.length > 0 && c.genesisId !== prev.genesisId)) clearLocks()
  if (c.cursor !== prev.cursor || c.position !== prev.position || c.walking !== prev.walking || c.plane !== prev.plane || c.identity.pubkey !== prev.identity.pubkey) moved()
})

useTerrain.subscribe((t, prev) => {
  if (t.active === prev.active) return
  // In: where you stand is where you start, never a crossing. Out (a HOP, T, Esc, WALK ending): the lock lets go.
  if (t.active) useChunkStay.setState({ here: chunkHere() })
  else { useChunkStay.setState({ here: null }); clearLocks() }
})

// The tour never runs with the lock on.
useTutorial.subscribe((t, prev) => { if (t.active && !prev.active) clearLocks() })
