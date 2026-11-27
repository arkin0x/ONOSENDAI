/**
 * surveyHold.ts - SURVEY is a hold, so it is never pressed by accident
 * (owner, 2026-11-24: "Hold for 5 seconds to survey - a bar fills up under
 * the button and it says 'surveying'"). The button and the G key start the
 * hold; letting go, a finger sliding off, or G coming up before the end
 * cancels it, and nothing is surveyed. When the hold completes, `done` runs
 * once, with the hold's chunk.
 *
 * The chunk is chosen as the hold starts (TerrainView.tsx holdSurvey asks
 * store/useTerrain.ts surveyTarget) and kept here as `key`, so the chunk lit
 * while it is held (scene/SurveyGlow.tsx; owner, 2026-11-27: "light up the
 * chunk region being surveyed somehow while the survey button is being held
 * so we know what one is being acted upon") is the very one surveyed: both
 * read this `key`, and nothing chooses again in between. Once the survey has
 * taken the chunk (TerrainView.tsx holdSurvey, flashSurvey), `flash` names it
 * and when, for the glow's brief flash; a chunk the survey turns down never flashes.
 */

import { create } from 'zustand'

/** How long SURVEY is held, in milliseconds. */
export const SURVEY_HOLD_MS = 5000

interface SurveyHoldState {
  /** When the hold began (performance.now), or null when nothing is held. */
  since: number | null
  /** The chunk the hold will survey (its key), chosen as it began; null with none to survey or nothing held. */
  key: string | null
  /** The chunk the last survey took and when, for the glow's flash; null before any. */
  flash: { key: string; at: number } | null
}

export const useSurveyHold = create<SurveyHoldState>(() => ({ since: null, key: null, flash: null }))

let timer: ReturnType<typeof setTimeout> | null = null

/**
 * Start holding the chunk `key` (null when there is none to survey: the hold
 * still runs, and `done` says so); a hold already under way goes on. `done`
 * runs with that same key when it completes.
 */
export function startSurveyHold(done: (key: string | null) => void, now: number = performance.now(), key: string | null = null): void {
  if (useSurveyHold.getState().since !== null) return
  useSurveyHold.setState({ since: now, key })
  timer = setTimeout(() => {
    timer = null
    useSurveyHold.setState({ since: null, key: null })
    done(key)
  }, SURVEY_HOLD_MS)
}

/** The survey took the chunk `key`: the glow flashes there once (scene/SurveyGlow.tsx). */
export function flashSurvey(key: string, at: number = performance.now()): void {
  useSurveyHold.setState({ flash: { key, at } })
}

/** Let go before the end: the bar empties and nothing is surveyed. */
export function cancelSurveyHold(): void {
  if (timer !== null) { clearTimeout(timer); timer = null }
  if (useSurveyHold.getState().since !== null) useSurveyHold.setState({ since: null, key: null })
}
