/**
 * holdRing.test.tsx - a hold's progress at the cross (owner, 2026-11-27: "on
 * the buttons you have to hold, we should show the progress somewhere else
 * because my thumb covers the bar"). The mapping from time to ring and
 * seconds; the ring going on letting go and on the hold completing (the
 * swing's start, before the impact flash); and every hold in TERRAIN showing
 * the one shared ring, in its own colour, with its own name.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

// The held Compiler is a WebGL canvas of its own; this test is about the ring.
vi.mock('../HeldCompiler', () => ({ HeldCompiler: () => null }))

;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { addEventListener?: unknown }).addEventListener ??= () => {}
;(globalThis as { removeEventListener?: unknown }).removeEventListener ??= () => {}
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
    key: () => null,
    get length() { return mem.size },
  }
}

import { createElement } from 'react'
import { mount, settled, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { HOLD_ACTIONS, RING_C, holdFraction, holdSecondsLeft, ringOffset } from '../holdProgress'
import { HOLDS, HoldRing } from '../HoldRing'
import { cancelSmashHold, startSmashHold, useSmashHold } from '../smashHold'
import { SURVEY_HOLD_MS, cancelSurveyHold, startSurveyHold } from '../surveyHold'
import { TerrainView } from '../TerrainView'
import { useTerrain } from '../../store/useTerrain'
import { useCyberspace } from '../../store/useCyberspace'
import { emptyInventory, withCompiler } from '../../lib/terrain/terrainDb'
import { BARE_HOLD_MS, COMPILER_HOLD_MS } from '../../lib/blueprint/smash'

const CELL = [0, 0, 0] as const
const ring = (m: Mounted): Host | undefined => m.all().find((h) => h.props.className === 'hold-ring')
const fill = (m: Mounted): Record<string, string | number> => (m.all().find((h) => h.props.className === 'hold-ring__fill')!.props.style as Record<string, string | number>)
const colour = (h: Host): string => (h.props.style as Record<string, string>)['--hold-colour']

afterEach(() => {
  cancelSmashHold()
  cancelSurveyHold()
  useTerrain.setState({ active: false, inventory: emptyInventory() })
  useCyberspace.setState({ walking: false })
})

describe('the progress mapping', () => {
  it('the share of the hold done: 0 to 1 across it, 0 when nothing is held', () => {
    expect(holdFraction(null, 4000, 1234)).toBe(0)
    expect(holdFraction(1000, 4000, 1000)).toBe(0)
    expect(holdFraction(1000, 4000, 2000)).toBe(0.25)
    expect(holdFraction(1000, 4000, 5000)).toBe(1)
    expect(holdFraction(1000, 4000, 9000)).toBe(1)
    expect(holdFraction(1000, 4000, 500)).toBe(0)
    expect(holdFraction(1000, 0, 2000)).toBe(0)
  })

  it('the seconds left: the whole hold at the start, 1 in the last second, 0 at the end', () => {
    expect(holdSecondsLeft(0, COMPILER_HOLD_MS, 0)).toBe(4)
    expect(holdSecondsLeft(0, BARE_HOLD_MS, 0)).toBe(7)
    expect(holdSecondsLeft(0, SURVEY_HOLD_MS, 0)).toBe(5)
    expect(holdSecondsLeft(0, 4000, 1)).toBe(4)
    expect(holdSecondsLeft(0, 4000, 1000)).toBe(3)
    expect(holdSecondsLeft(0, 4000, 3500)).toBe(1)
    expect(holdSecondsLeft(0, 4000, 4000)).toBe(0)
    expect(holdSecondsLeft(0, 4000, 6000)).toBe(0)
    expect(holdSecondsLeft(null, 4000, 0)).toBe(0)
  })

  it('the ring still to fill: the whole circle at the start, none at the end, clamped', () => {
    expect(ringOffset(0)).toBeCloseTo(RING_C)
    expect(ringOffset(0.5)).toBeCloseTo(RING_C / 2)
    expect(ringOffset(1)).toBe(0)
    expect(ringOffset(-1)).toBeCloseTo(RING_C)
    expect(ringOffset(2)).toBe(0)
  })
})

describe('the ring at the cross', () => {
  it('shows a hold from where it is: the circle part filled, the sweep on from there, the seconds left', async () => {
    const m = await mount(createElement(HoldRing))
    try {
      expect(ring(m)).toBeUndefined()
      startSmashHold(CELL, COMPILER_HOLD_MS, false, () => {}, performance.now() - 2500)
      await settled()
      const r = ring(m)!
      expect(r.props['data-hold']).toBe('smash')
      expect(colour(r)).toBe(HOLD_ACTIONS.smash.colour)
      expect(textOf(r)).toBe('SMASH2s')
      const f = fill(m)
      expect(f['--hold-ms']).toBe(`${COMPILER_HOLD_MS}ms`)
      expect(f.strokeDasharray).toBe(RING_C)
      // About 2.5 of the 4 seconds in: about five eighths of the circle filled, the sweep starting there.
      expect(Number(f.strokeDashoffset)).toBeLessThan(RING_C * 0.4)
      expect(Number(f.strokeDashoffset)).toBeGreaterThan(RING_C * 0.3)
      expect(parseInt(String(f.animationDelay), 10)).toBeLessThanOrEqual(-2500)
    } finally {
      await m.unmount()
    }
  })

  it('let go: the ring goes at once', async () => {
    const m = await mount(createElement(HoldRing))
    try {
      startSurveyHold(() => {})
      await settled()
      expect(ring(m)?.props['data-hold']).toBe('survey')
      cancelSurveyHold()
      await settled()
      expect(ring(m)).toBeUndefined()
    } finally {
      await m.unmount()
    }
  })

  it('held to the end: the ring goes as the swing begins, before the impact', async () => {
    const m = await mount(createElement(HoldRing))
    try {
      const done = vi.fn()
      startSmashHold(CELL, 30, false, done)
      await settled()
      expect(ring(m)).toBeDefined()
      await new Promise((r) => setTimeout(r, 60))
      await settled()
      expect(done).toHaveBeenCalledTimes(1)
      expect(useSmashHold.getState().swingAt).not.toBeNull()
      expect(ring(m)).toBeUndefined()
    } finally {
      await m.unmount()
    }
  })
})

describe('every hold uses the one ring', () => {
  it('each hold action has its store in the ring\'s list', () => {
    expect(HOLDS.map((h) => h.action.id).sort()).toEqual(Object.keys(HOLD_ACTIONS).sort())
  })

  it('in TERRAIN, SMASH and SURVEY each show the ring at the cross in their colour, and the message slot gives way', async () => {
    useCyberspace.setState({ walking: true })
    const inv = withCompiler(emptyInventory(), 'granted')
    useTerrain.setState({ active: true, loading: false, sheet: false, inventory: { ...inv, slot: 0 } })
    const m = await mount(createElement(TerrainView))
    const message = (): Host => m.all().find((h) => String(h.props.className ?? '').startsWith('terrain-message'))!
    try {
      expect(ring(m)).toBeUndefined()
      expect(message().props.className).toBe('terrain-message')
      const cases: Array<[keyof typeof HOLD_ACTIONS, () => void, () => void, number]> = [
        ['smash', () => startSmashHold(CELL, COMPILER_HOLD_MS, false, () => {}), cancelSmashHold, COMPILER_HOLD_MS],
        ['smash', () => startSmashHold(CELL, BARE_HOLD_MS, true, () => {}), cancelSmashHold, BARE_HOLD_MS],
        ['survey', () => startSurveyHold(() => {}), cancelSurveyHold, SURVEY_HOLD_MS],
      ]
      for (const [id, start, cancel, ms] of cases) {
        start()
        await settled()
        const r = ring(m)!
        expect(r.props['data-hold']).toBe(id)
        expect(colour(r)).toBe(HOLD_ACTIONS[id].colour)
        expect(textOf(r)).toBe(`${HOLD_ACTIONS[id].label}${ms / 1000}s`)
        expect(fill(m)['--hold-ms']).toBe(`${ms}ms`)
        expect(message().props.className).toBe('terrain-message is-under-hold')
        cancel()
        await settled()
        expect(ring(m)).toBeUndefined()
        expect(message().props.className).toBe('terrain-message')
      }
      expect(HOLD_ACTIONS.smash.colour).toBe('#ff9a3c')
      expect(HOLD_ACTIONS.survey.colour).toBe('#7cffc4')
    } finally {
      await m.unmount()
    }
  })
})
