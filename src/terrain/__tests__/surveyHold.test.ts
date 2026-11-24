/**
 * surveyHold.test.ts - SURVEY is a 5 second hold (owner, 2026-11-24): let go
 * early and nothing is surveyed and the bar empties; hold to the end and it
 * surveys once; the G key holds the same way, its repeats ignored.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SURVEY_HOLD_MS, cancelSurveyHold, startSurveyHold, useSurveyHold } from '../surveyHold'
import { terrainKeys } from '../TerrainView'
import { useTerrain } from '../../store/useTerrain'

function key(on: EventTarget, type: 'keydown' | 'keyup', repeat = false): void {
  const e = new Event(type, { cancelable: true })
  Object.assign(e, { code: 'KeyG', repeat, metaKey: false, ctrlKey: false, altKey: false })
  on.dispatchEvent(e)
}

beforeEach(() => { vi.useFakeTimers(); cancelSurveyHold() })
afterEach(() => { cancelSurveyHold(); vi.useRealTimers() })

describe('holding SURVEY', () => {
  it('let go early: no survey, and the bar empties', () => {
    const done = vi.fn()
    startSurveyHold(done)
    expect(useSurveyHold.getState().since).not.toBeNull()
    vi.advanceTimersByTime(SURVEY_HOLD_MS - 1)
    cancelSurveyHold()
    expect(useSurveyHold.getState().since).toBeNull()
    vi.advanceTimersByTime(SURVEY_HOLD_MS)
    expect(done).not.toHaveBeenCalled()
  })

  it('held to the end: surveys once, and the bar is done', () => {
    const done = vi.fn()
    startSurveyHold(done)
    // A second press while held (a key repeat, a second finger) does not start another.
    startSurveyHold(done)
    vi.advanceTimersByTime(SURVEY_HOLD_MS)
    expect(done).toHaveBeenCalledTimes(1)
    expect(useSurveyHold.getState().since).toBeNull()
    vi.advanceTimersByTime(SURVEY_HOLD_MS * 2)
    expect(done).toHaveBeenCalledTimes(1)
  })
})

describe('holding G', () => {
  it('up before the end: no survey; held to the end, its repeats ignored: one survey', () => {
    const say = vi.fn()
    const real = useTerrain.getState().say
    useTerrain.setState({ say, sheet: false })
    const on = new EventTarget()
    const stop = terrainKeys(on)
    try {
      // With nothing to survey here, a completed hold says so: that is the survey running.
      key(on, 'keydown')
      vi.advanceTimersByTime(2000)
      key(on, 'keyup')
      vi.advanceTimersByTime(SURVEY_HOLD_MS)
      expect(say).not.toHaveBeenCalled()
      key(on, 'keydown')
      for (let t = 0; t < 10; t++) { vi.advanceTimersByTime(400); key(on, 'keydown', true) }
      vi.advanceTimersByTime(SURVEY_HOLD_MS - 4000)
      expect(say).toHaveBeenCalledTimes(1)
      expect(say).toHaveBeenCalledWith('Everything here is surveyed.')
      key(on, 'keyup')
    } finally {
      stop()
      useTerrain.setState({ say: real })
    }
  })
})
