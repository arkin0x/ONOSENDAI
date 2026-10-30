/**
 * ceremony.test.ts: the OPEN ceremony's timeline and gates (arkinox,
 * 2026-10-30): the lid turns up and back over LID_MS and the open look
 * swaps in as it arrives; the calm path (reduced motion) turns nothing,
 * glints nothing, rains nothing, and still ends open; the sound and the buzz
 * each play at most once per 10 s across every chest; and what OPEN does
 * next: the card yields and the chest plays only the first time this
 * identity opens it, and only where the world draws it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CALM_FADE_MS, GLINT_MS, LID_MS, afterOpen, calmShare, ceremonyLength, glintLevel, lidTurn, rainCount, swapped } from '../ceremony'
import { CEREMONY_BUZZ, CEREMONY_GAP_MS, ceremonyFeedback, resetCeremonySound } from '../ceremonySound'
import { buzzGate, onceEvery } from '../buzz'

const ANGLE = -(100 * Math.PI) / 180

describe('the lid', () => {
  it('turns from shut to the open look’s angle over LID_MS, ease-out, and stays there', () => {
    expect(lidTurn(0, ANGLE)).toBeCloseTo(0, 12)
    const a = lidTurn(LID_MS * 0.25, ANGLE), b = lidTurn(LID_MS * 0.5, ANGLE)
    expect(Math.abs(a)).toBeGreaterThan(Math.abs(ANGLE) * 0.25)
    expect(Math.abs(b)).toBeGreaterThan(Math.abs(a))
    expect(lidTurn(LID_MS, ANGLE)).toBeCloseTo(ANGLE, 9)
    expect(lidTurn(LID_MS * 3, ANGLE)).toBeCloseTo(ANGLE, 9)
  })

  it('swaps to the open look as it arrives', () => {
    expect(swapped(LID_MS - 1)).toBe(false)
    expect(swapped(LID_MS)).toBe(true)
  })

  it('glints only once the lid is nearly up, and not after the glints have run', () => {
    expect(glintLevel(0)).toBe(0)
    expect(glintLevel(LID_MS * 0.5)).toBe(0)
    expect(glintLevel(LID_MS + 200)).toBeGreaterThan(0.5)
    expect(glintLevel(LID_MS + GLINT_MS + 1)).toBe(0)
  })

  it('rains half as many glyphs on a phone', () => {
    expect(rainCount(390)).toBe(12)
    expect(rainCount(1440)).toBe(24)
  })
})

describe('the calm path (reduced motion)', () => {
  it('turns nothing, glints nothing, and crossfades in CALM_FADE_MS', () => {
    for (const t of [0, 100, LID_MS, LID_MS + 300]) {
      expect(lidTurn(t, ANGLE, true)).toBeCloseTo(0, 12)
      expect(glintLevel(t, true)).toBe(0)
    }
    expect(calmShare(0)).toBe(0)
    expect(calmShare(CALM_FADE_MS / 2)).toBeCloseTo(0.5, 9)
    expect(calmShare(CALM_FADE_MS * 2)).toBe(1)
  })

  it('ends in the same state, open, and sooner', () => {
    expect(swapped(CALM_FADE_MS, true)).toBe(true)
    expect(ceremonyLength('chest', true)).toBe(CALM_FADE_MS)
    expect(ceremonyLength('chest', false)).toBe(LID_MS + GLINT_MS)
  })
})

describe('what OPEN does next', () => {
  it('the first time, where the world draws the chest: the card yields and the chest plays', () => {
    expect(afterOpen(true, true)).toEqual({ yieldCards: true, ceremony: true, feedback: true })
  })
  it('the first time, where it is not drawn: the card stays and lists it, with the sound alone', () => {
    expect(afterOpen(true, false)).toEqual({ yieldCards: false, ceremony: false, feedback: true })
  })
  it('a chest opened by hand before: nothing at all', () => {
    expect(afterOpen(false, true)).toEqual({ yieldCards: false, ceremony: false, feedback: false })
    expect(afterOpen(false, false)).toEqual({ yieldCards: false, ceremony: false, feedback: false })
  })
})

describe('sound and buzz, each at most once per 10 s', () => {
  afterEach(() => { resetCeremonySound(); vi.unstubAllGlobals() })

  it('once-every lets a key through once per gap', () => {
    const last = new Map<string, number>()
    expect(onceEvery(last, 'k', 1000, 10_000)).toBe(true)
    expect(onceEvery(last, 'k', 10_999, 10_000)).toBe(false)
    expect(onceEvery(last, 'other', 10_999, 10_000)).toBe(true)
    expect(onceEvery(last, 'k', 11_000, 10_000)).toBe(true)
  })

  it('a chest, then a door 3 s later: one sound and one buzz; 10 s on, again', () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { vibrate })
    vi.stubGlobal('document', { visibilityState: 'visible' })
    const t = 5_000_000
    expect(ceremonyFeedback('chest', t)).toEqual({ sound: true, buzz: true })
    expect(vibrate).toHaveBeenLastCalledWith(CEREMONY_BUZZ.chest)
    expect(ceremonyFeedback('door', t + 3000)).toEqual({ sound: false, buzz: false })
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(ceremonyFeedback('door', t + CEREMONY_GAP_MS)).toEqual({ sound: true, buzz: true })
    expect(vibrate).toHaveBeenCalledTimes(2)
  })

  it('never buzzes a hidden tab, and that counts as buzzed', () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { vibrate })
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    const t = 9_000_000
    expect(buzzGate(['hidden-tab'], t, CEREMONY_GAP_MS, 30)).toBe(false)
    vi.stubGlobal('document', { visibilityState: 'visible' })
    expect(buzzGate(['hidden-tab'], t + 1000, CEREMONY_GAP_MS, 30)).toBe(false)
    expect(vibrate).not.toHaveBeenCalled()
  })
})
