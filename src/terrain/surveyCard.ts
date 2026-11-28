/**
 * surveyCard.ts - which chunk's survey card is open, and what it says
 * (terrain/SurveyCard.tsx draws it; lib/terrain/assay.ts counts it).
 *
 * The owner, 2026-11-27: "Inside the already-surveyed region, the survey
 * button should change to Card and pressing it shows the card." Standing in
 * a chunk surveyed for you, SURVEY's slot is CARD: a tap opens the card at
 * once (TerrainView.tsx pressCard). A survey that completes opens its card by
 * itself, once (autoOpenSurveyCard).
 */

import { create } from 'zustand'
import { groundFor, groundRevisionFor, terrainSession, useTerrain } from '../store/useTerrain'
import { firstLayerAt } from '../store/terrainShare'
import { assayBlocks, chunkAssay, neighbourBlocks, surveyCard, type SurveyCardData } from '../lib/terrain/assay'
import type { GroundRevision } from '../lib/terrain/groundRevision'

interface SurveyCardState {
  /** The chunk whose card is open (its key), or null. */
  open: string | null
  /** It opened by itself, as a survey completed. */
  auto: boolean
}

export const useSurveyCard = create<SurveyCardState>(() => ({ open: null, auto: false }))

/** Chunks whose card has opened by itself this page: never twice. */
const autoShown = new Set<string>()

/** Open the card for the chunk `key`. */
export function openSurveyCard(key: string, auto = false): void {
  useSurveyCard.setState({ open: key, auto })
}

export function closeSurveyCard(): void {
  if (useSurveyCard.getState().open !== null) useSurveyCard.setState({ open: null, auto: false })
}

/** A survey of `key` completed: its card opens by itself, the first time only. True when it opened. */
export function autoOpenSurveyCard(key: string): boolean {
  if (autoShown.has(key)) return false
  autoShown.add(key)
  openSurveyCard(key, true)
  return true
}

/** For tests: forget which cards have opened by themselves, and close the card. */
export function resetSurveyCards(): void {
  autoShown.clear()
  useSurveyCard.setState({ open: null, auto: false })
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
 */
export async function cardFor(key: string): Promise<CardFor | null> {
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
  const card = surveyCard(assay, ground.facts, { ownsCompiler: !!useTerrain.getState().inventory.compiler })
  // When: your own survey's time where you surveyed it; else the oldest layer drawn there.
  const mine = s.surveyedKeys.has(key) ? s.revisions.get(key)?.surveyed : undefined
  return { card, at: mine ? mine * 1000 : firstLayerAt(key), revision: ground.revision }
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** A survey's date as the stamp prints it: 27 NOV 2026. */
export function stampDate(at: number | null): string {
  if (at === null || !Number.isFinite(at)) return 'DATE UNKNOWN'
  const d = new Date(at)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
