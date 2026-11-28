/**
 * surveyCard.ts - which chunk's survey card is open, and what it says
 * (terrain/SurveyCard.tsx draws it; lib/terrain/assay.ts counts it).
 *
 * The owner, 2026-11-27: "Inside the already-surveyed region, the survey
 * button should change to Card and pressing it shows the card." Standing in
 * a chunk surveyed for you, SURVEY's slot is CARD: a tap opens the card at
 * once (TerrainView.tsx pressCard). A survey that completes opens its card by
 * itself, once (autoOpenSurveyCard).
 *
 * The owner, 2026-11-28: "can we make the card live update how many of the
 * blocks in the chunk you've mined and how many are left total?" While it is
 * open the card is counted again whenever the chunk changes (watchCard): your
 * mining, blasting or placing, or someone else's layer arriving.
 */

import { create } from 'zustand'
import { groundFor, groundRevisionFor, terrainSession, useTerrain } from '../store/useTerrain'
import { explicitCells } from '../store/terrainShare'
import { firstSurveyedAt } from '../store/terrainShare'
import { useTutorial } from '../store/useTutorial'
import { assayBlocks, chunkAssay, chunkMined, neighbourBlocks, surveyCard, type SurveyCardData } from '../lib/terrain/assay'
import { NEIGHBOURS } from '../lib/terrain/world'
import type { GroundRevision } from '../lib/terrain/groundRevision'

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

/** A survey card, with when the chunk was surveyed (ms, or null when not known) and the ground revision it counts. */
export interface CardFor { card: SurveyCardData; at: number | null; revision: GroundRevision }

/**
 * The card for a loaded chunk, at the ground revision you see it at
 * (store/useTerrain.ts groundRevisionFor), its ground and that ground's type
 * and K read through groundFor, so the card never counts a revision the chunk
 * is not. What it counts is what stands: the chunk's blocks with every layer
 * merged over them (kept per version: lib/terrain/assay.ts chunkAssay) when
 * they are drawn over that same revision, as they are once built; in the
 * moment before a chunk is built again at another revision, that revision's
 * ground itself. Null when the chunk is not loaded or has no blocks.
 *
 * What you mined is your own blocks against that same ground at that same
 * revision (lib/terrain/assay.ts chunkMined), so it is what mining there gave
 * you (#958). `keep` names kinds to list even at 0 (the rows the open card has
 * shown already).
 */
export async function cardFor(key: string, keep?: Iterable<number>): Promise<CardFor | null> {
  const s = terrainSession
  const slot = s?.world.slotByKey(key)
  if (!s || !slot?.blocks) return null
  const revision = groundRevisionFor(key, s)
  const ground = await groundFor(key)
  if (terrainSession !== s || !slot.blocks) return null
  const assay = (slot.revision ?? 2) === revision && ground.revision === revision
    ? chunkAssay(s.world, slot)
    : assayBlocks(ground.blocks, neighbourBlocks(s.world, slot))
  if (!assay) return null
  // Your explicit cells matter only where your blocks stand on another revision's ground than the one shown.
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
 * there, and its six neighbours' versions (their edges decide visible or
 * buried). Null when the chunk is not loaded.
 */
function cardStamp(key: string): { field: object; slot: object; stamp: string } | null {
  const s = terrainSession
  const slot = s?.world.slotByKey(key)
  if (!s || !slot) return null
  const around = NEIGHBOURS.map(([dx, dy, dz]) => {
    const n = s.world.slotAt(slot.off[0] + dx, slot.off[1] + dy, slot.off[2] + dz)
    return n?.blocks ? n.version : '-'
  })
  return { field: s, slot, stamp: `${slot.version}|${slot.revision ?? 2}|${groundRevisionFor(key, s)}|${slot.own ? 1 : 0}|${around.join(',')}` }
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
