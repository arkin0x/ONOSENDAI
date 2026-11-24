/**
 * surveyHold.ts - SURVEY is a hold, so it is never pressed by accident
 * (owner, 2026-11-24: "Hold for 5 seconds to survey - a bar fills up under
 * the button and it says 'surveying'"). The button and the G key start the
 * hold; letting go, a finger sliding off, or G coming up before the end
 * cancels it, and nothing is surveyed. When the hold completes, `done` runs
 * once.
 */

import { create } from 'zustand'

/** How long SURVEY is held, in milliseconds. */
export const SURVEY_HOLD_MS = 5000

interface SurveyHoldState {
  /** When the hold began (performance.now), or null when nothing is held. */
  since: number | null
}

export const useSurveyHold = create<SurveyHoldState>(() => ({ since: null }))

let timer: ReturnType<typeof setTimeout> | null = null

/** Start holding; a hold already under way goes on. `done` runs when it completes. */
export function startSurveyHold(done: () => void, now: number = performance.now()): void {
  if (useSurveyHold.getState().since !== null) return
  useSurveyHold.setState({ since: now })
  timer = setTimeout(() => {
    timer = null
    useSurveyHold.setState({ since: null })
    done()
  }, SURVEY_HOLD_MS)
}

/** Let go before the end: the bar empties and nothing is surveyed. */
export function cancelSurveyHold(): void {
  if (timer !== null) { clearTimeout(timer); timer = null }
  if (useSurveyHold.getState().since !== null) useSurveyHold.setState({ since: null })
}
