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
import { terrainSession, useTerrain } from '../store/useTerrain'
import { firstLayerAt } from '../store/terrainShare'
import { chunkAssay, surveyCard, type SurveyCardData } from '../lib/terrain/assay'

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

/** The card for a loaded chunk, and when it was surveyed (ms, or null when not known); null when the chunk has no blocks. */
export function cardFor(key: string): { card: SurveyCardData; at: number | null } | null {
  const s = terrainSession
  const slot = s?.world.slotByKey(key)
  if (!s || !slot) return null
  const assay = chunkAssay(s.world, slot)
  if (!assay) return null
  const card = surveyCard(assay, slot.ground, { ownsCompiler: !!useTerrain.getState().inventory.compiler })
  return { card, at: s.surveyedAt?.get(key) ?? firstLayerAt(key) }
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** A survey's date as the stamp prints it: 27 NOV 2026. */
export function stampDate(at: number | null): string {
  if (at === null || !Number.isFinite(at)) return 'DATE UNKNOWN'
  const d = new Date(at)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
