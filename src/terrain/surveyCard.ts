/**
 * surveyCard.ts - which chunk's survey card is open, and what it says
 * (terrain/SurveyCard.tsx draws it; lib/terrain/assay.ts counts it).
 *
 * The owner, 2026-11-27: "Inside the already-surveyed region, the survey
 * button should change to Card and pressing it shows the card." In a chunk
 * surveyed for you, SURVEY's slot is CARD: a tap opens the card at
 * once (TerrainView.tsx pressCard). A survey that completes opens its card by
 * itself, once (autoOpenSurveyCard).
 *
 * The owner, 2026-11-28: "can we make the card live update how many of the
 * blocks in the chunk you've mined and how many are left total?" While it is
 * open the card is counted again whenever the chunk changes (watchCard): your
 * mining, blasting or placing, or someone else's layer arriving, here or in
 * any of the 26 chunks round it (they decide which blocks are visible).
 */

import { create } from 'zustand'
import { groundFor, groundRevisionFor, terrainSession, useTerrain, type TerrainSession } from '../store/useTerrain'
import { explicitCells, othersRevision } from '../store/terrainShare'
import { firstSurveyedAt } from '../store/terrainShare'
import { useTutorial } from '../store/useTutorial'
import { chunkAssay, chunkMined, surveyCard, type SurveyCardData } from '../lib/terrain/assay'
import type { ChunkSlot } from '../lib/terrain/world'
import type { GroundRevision } from '../lib/terrain/groundRevision'
import { aroundIndex } from '../lib/terrain/light'
import { chunkInSpace, chunkKey, type ChunkBase } from '../lib/terrain/coords'

interface SurveyCardState {
  /** The chunk whose card is open (its key), or null. */
  open: string | null
}

export const useSurveyCard = create<SurveyCardState>(() => ({ open: null }))

/** Chunks whose card has opened by itself this page: never twice. */
const autoShown = new Set<string>()

/** Open the card for the chunk `key`. */
export function openSurveyCard(key: string): void {
  useSurveyCard.setState({ open: key })
}

export function closeSurveyCard(): void {
  if (useSurveyCard.getState().open !== null) useSurveyCard.setState({ open: null })
}

/**
 * A survey of `key` completed: its card opens by itself, the first time only,
 * and never while the tutorial's tour runs (coordinator, 2026-11-28: it would
 * cover the tour's next step). True when it opened.
 */
export function autoOpenSurveyCard(key: string): boolean {
  if (autoShown.has(key) || useTutorial.getState().active) return false
  autoShown.add(key)
  openSurveyCard(key)
  return true
}

/** For tests: forget which cards have opened by themselves, and close the card. */
export function resetSurveyCards(): void {
  autoShown.clear()
  useSurveyCard.setState({ open: null })
}

/**
 * The chunks round `slot` (of its 26) that are surveyed but not loaded, as
 * when a card opens for the chunk ahead of you and the far side of it is
 * past the 3 by 3 by 3 TERRAIN keeps: each one's place (light.ts aroundIndex),
 * key and the ground revision you see it at. Their ground still walls in the
 * card's edge, so it is generated for the count (neighbourGround): the ground
 * alone, as the layers over it are read only once it is loaded. A chunk
 * nobody surveyed is open space, as the scene draws it and as you can move
 * through it, so it is left out.
 */
function unloadedAround(s: TerrainSession, slot: ChunkSlot): Array<{ i: number; base: ChunkBase; key: string; revision: GroundRevision }> {
  const out: Array<{ i: number; base: ChunkBase; key: string; revision: GroundRevision }> = []
  const o = s.world.origin
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = slot.off[0] + dx, cy = slot.off[1] + dy, cz = slot.off[2] + dz
    if ((dx === 0 && dy === 0 && dz === 0) || s.world.slotAt(cx, cy, cz)) continue
    const base = { x: o.x + BigInt(32 * cx), y: o.y + BigInt(32 * cy), z: o.z + BigInt(32 * cz), plane: o.plane }
    if (!chunkInSpace(base)) continue
    const key = chunkKey(base)
    if (!s.surveyedKeys.has(key) && othersRevision(key) === null) continue
    out.push({ i: aroundIndex(dx, dy, dz), base, key, revision: groundRevisionFor(key, s) })
  }
  return out
}

/** Generated ground of chunks surveyed but not loaded, by key and revision: the ground never changes, so it is made once. The last 64 kept. */
const grounds = new Map<string, Promise<Uint8Array | null>>()

/** A surveyed chunk's generated ground at `revision` (the blocks worker), kept per key and revision; null when it could not be made. */
function neighbourGround(base: ChunkBase, key: string, revision: GroundRevision): Promise<Uint8Array | null> {
  const k = `${key}|${revision}`
  let g = grounds.get(k)
  if (!g) {
    g = groundFor(base).then((r) => (r.revision === revision ? r.blocks : null), () => null)
    grounds.set(k, g)
    while (grounds.size > 64) grounds.delete(grounds.keys().next().value as string)
  }
  return g
}

/** A survey card, with when the chunk was surveyed (ms, or null when not known) and the ground revision it counts. */
export interface CardFor { card: SurveyCardData; at: number | null; revision: GroundRevision }

/**
 * The card for a loaded chunk, at the ground revision you see it at
 * (store/useTerrain.ts groundRevisionFor), its ground and that ground's type
 * and K read through groundFor, so the card never counts a revision the chunk
 * is not. LEFT is what is there now, the view the scene draws: the chunk's
 * blocks with every layer merged over them, your own at its revision too
 * (kept per version: lib/terrain/assay.ts chunkAssay), even where your blocks
 * sit on another revision's ground than the one shown (a home whose owner
 * surveyed at the other revision), so it drops as you mine there. Null when
 * the chunk is not loaded or has no blocks.
 *
 * What you mined is your own blocks against the ground shown at its revision
 * (lib/terrain/assay.ts chunkMined), so it is what mining there gave you
 * (#958), and LEFT and MINED agree with the screen. `keep` names kinds to list
 * even at 0 (the rows the open card has shown already).
 */
export async function cardFor(key: string, keep?: Iterable<number>): Promise<CardFor | null> {
  const s = terrainSession
  const slot = s?.world.slotByKey(key)
  if (!s || !slot?.blocks) return null
  const ground = await groundFor(key)
  // The chunks round it that are surveyed but not loaded: their generated ground, so the edge they wall in counts as buried.
  const around: Array<Uint8Array | null> = new Array(27).fill(null)
  for (const n of unloadedAround(s, slot)) around[n.i] = await neighbourGround(n.base, n.key, n.revision)
  if (terrainSession !== s || !slot.blocks) return null
  const assay = chunkAssay(s.world, slot, around)
  if (!assay) return null
  // Your explicit cells matter only where your blocks sit on another revision's ground than the one shown.
  const explicit = (slot.revision ?? 2) !== ground.revision ? explicitCells(key) : null
  const mined = chunkMined(slot, ground.blocks, ground.revision, explicit)
  const card = surveyCard(assay, ground.facts, { ownsCompiler: !!useTerrain.getState().inventory.compiler, mined, keep })
  // When: your own first survey's date where you surveyed it (0, as older rows can carry, is unknown); else the
  // earliest first-survey date of the surveying layers drawn there.
  const mine = s.surveyedKeys.has(key) ? s.revisions.get(key)?.surveyed ?? 0 : 0
  return { card, at: mine > 0 ? mine * 1000 : firstSurveyedAt(key), revision: ground.revision }
}

/** How often an open card looks at its chunk's version: at most four counts a second, and never per frame. */
export const CARD_WATCH_MS = 250

/**
 * What a card's count depends on, as a string: the field, the chunk's slot and
 * version, the revision it is shown at, whether you hold blocks of your own
 * there, and its 26 neighbours' versions, or for one surveyed but not loaded
 * the revision its ground is generated at (they decide which blocks are
 * visible and which buried). Null when the chunk is not loaded.
 */
function cardStamp(key: string): { field: object; slot: object; stamp: string } | null {
  const s = terrainSession
  const slot = s?.world.slotByKey(key)
  if (!s || !slot) return null
  const around: string[] = []
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dy === 0 && dz === 0) continue
    const n = s.world.slotAt(slot.off[0] + dx, slot.off[1] + dy, slot.off[2] + dz)
    around.push(n?.blocks ? `${n.version}` : '-')
  }
  const unloaded = unloadedAround(s, slot).map((n) => `${n.i}:${n.revision}`).join(',')
  return { field: s, slot, stamp: `${slot.version}|${slot.revision ?? 2}|${groundRevisionFor(key, s)}|${slot.own ? 1 : 0}|${around.join(',')}|${unloaded}` }
}

/**
 * Watch an open card's chunk: `changed` is called after the chunk (or the
 * field, or a neighbour's edge) changes, at most once every CARD_WATCH_MS,
 * however many blocks change in between (a blast is hundreds at once). One
 * cheap look at the version each time, no count: the count is the caller's,
 * and it is kept per version (lib/terrain/assay.ts). Returns the stop.
 */
export function watchCard(key: string, changed: () => void, every = CARD_WATCH_MS): () => void {
  let last = cardStamp(key)
  const id = setInterval(() => {
    const now = cardStamp(key)
    const same = now === null ? last === null : last !== null && now.field === last.field && now.slot === last.slot && now.stamp === last.stamp
    last = now
    if (!same) changed()
  }, every)
  return () => clearInterval(id)
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** A survey's date as the stamp prints it: 27 NOV 2026. */
export function stampDate(at: number | null): string {
  if (at === null || !Number.isFinite(at)) return 'DATE UNKNOWN'
  const d = new Date(at)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
