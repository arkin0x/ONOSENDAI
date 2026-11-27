/**
 * hiddenLook.test.ts: the one rulebook every hidden thing shares (owner
 * ruling, 2026-11-27: option A "One Rulebook" of the hidden-item cohesion
 * page). Its numbers are the page's table, and its states map the same way
 * for a letter, an item's token and a sound.
 */
import { describe, expect, it } from 'vitest'
import {
  BOB, BOB_S, GLOW, HIDDEN_FACE, LABEL_COLOUR, LABEL_GAP, LABEL_PX, LEVEL_LINES, LEVEL_LINE_W, LINE_RING_RADIUS, OUTLINE_HOVER, OUTLINE_HOVER_PX, OUTLINE_PX,
  OUTLINE_READ, OUTLINE_UNREAD, PULSE_S, RING_COLOUR, RING_OPACITY, RING_RADIUS, RING_REACH, RING_TURN_S, SLICES, SLICES_LOW, SLICE_MAX_R, TURN_S, WAVE_S,
  bobAt, hiddenLook, hiddenState, labelShape, levelLength, notchCode, pulseAt, ringTurnAt, sliceEnvelope, sliceRadius, sliceY, turnAt, waveAt, wavePhaseAt,
} from '../hiddenLook'
import { ACCENT, FG } from '../palette'
import { RING_TURN_S as GLYPH_RING_TURN_S } from '../glyphRing'
import { LABEL_GAP_PX } from '../markerSize'

const TAU = Math.PI * 2

describe('the rulebook’s numbers (option A’s token table)', () => {
  it('one palette, from the ONOSENDAI tokens', () => {
    expect(HIDDEN_FACE).toBe('#0b1824')
    expect(OUTLINE_UNREAD).toBe(FG)
    expect(OUTLINE_READ).toBe('#5b7d8f')
    expect(OUTLINE_HOVER).toBe('#ffffff')
    expect(RING_COLOUR).toBe(ACCENT)
    expect(RING_OPACITY).toEqual({ unread: 0.9, new: 0.9, read: 0.42, playing: 1 })
  })

  it('one outline: 1.5 px at any distance, 2.4 px under a pointer; lines and rings glow, faces never', () => {
    expect(OUTLINE_PX).toBe(1.5)
    expect(OUTLINE_HOVER_PX).toBe(2.4)
    expect(GLOW).toEqual({ lines: true, faces: false })
  })

  it('one motion: a 24 s turn, an 18 s ring turn, a bob of 0.035 gibson over 5 s, a 6 s idle wave, a pulse every 2.4 s', () => {
    expect([TURN_S, RING_TURN_S, BOB, BOB_S, WAVE_S, PULSE_S]).toEqual([24, 18, 0.035, 5, 6, 2.4])
    // The glyph ring turns at the same speed, from here.
    expect(GLYPH_RING_TURN_S).toBe(RING_TURN_S)
  })

  it('one ring: radius 0.74 gibson, marks to 0.98; 32 level lines 0.045 wide; the thin ring just outside', () => {
    expect(RING_RADIUS).toBe(0.74)
    expect(RING_REACH).toBe(0.98)
    expect(LEVEL_LINES).toBe(32)
    expect(LEVEL_LINE_W).toBe(0.045)
    expect(LINE_RING_RADIUS).toBeCloseTo(0.78, 12)
  })

  it('one label: 11 px white, 4 px over the ring, every name at the ring’s reach', () => {
    expect(LABEL_PX).toBe(11)
    expect(LABEL_COLOUR).toBe('#ffffff')
    expect(LABEL_GAP).toBe(LABEL_GAP_PX)
    expect(labelShape(0.5, 0.4)).toEqual({ flat: RING_REACH, radius: 0.5, height: 0.4 })
    expect(labelShape(0.5, 0.4, 2)).toEqual({ flat: RING_REACH * 2, radius: 1, height: 0.8 })
  })
})

describe('state', () => {
  it('your own are read; one opened is read; one found and not opened is new; anything else unread', () => {
    expect(hiddenState({ mine: true, read: false, fresh: true })).toBe('read')
    expect(hiddenState({ mine: false, read: true, fresh: true })).toBe('read')
    expect(hiddenState({ mine: false, read: false, fresh: true })).toBe('new')
    expect(hiddenState({ mine: false, read: false, fresh: false })).toBe('unread')
  })

  it('each state’s look: bright and pulsing new, bright unread, steel and dim read; playing or a pointer lifts the ring to full', () => {
    expect(hiddenLook('new')).toEqual({ outline: OUTLINE_UNREAD, outlinePx: 1.5, ringOpacity: 0.9, pulse: true })
    expect(hiddenLook('unread')).toEqual({ outline: OUTLINE_UNREAD, outlinePx: 1.5, ringOpacity: 0.9, pulse: false })
    expect(hiddenLook('read')).toEqual({ outline: OUTLINE_READ, outlinePx: 1.5, ringOpacity: 0.42, pulse: false })
    expect(hiddenLook('read', { playing: true }).ringOpacity).toBe(1)
    expect(hiddenLook('read', { playing: true }).outline).toBe(OUTLINE_READ)
    expect(hiddenLook('unread', { hover: true })).toEqual({ outline: OUTLINE_HOVER, outlinePx: 2.4, ringOpacity: 1, pulse: false })
  })
})

describe('motion', () => {
  it('bobs 0.035 each way over 5 s, from its own phase; none with reduced motion', () => {
    expect(bobAt(BOB_S / 4, 0, false)).toBeCloseTo(BOB, 12)
    expect(bobAt((3 * BOB_S) / 4, 0, false)).toBeCloseTo(-BOB, 12)
    expect(bobAt(1.3, 0.7, false)).toBeCloseTo(bobAt(1.3 + BOB_S, 0.7, false), 12)
    expect(bobAt(1.3, 0.7, true)).toBe(0)
  })

  it('turns once in 24 s from its own phase; square on with reduced motion', () => {
    expect(turnAt(TURN_S, 0.4, false) - turnAt(0, 0.4, false)).toBeCloseTo(TAU, 12)
    expect(turnAt(9, 0.4, true)).toBe(0)
  })

  it('rings turn once in 18 s and the wave goes round once in 6 s; both still with reduced motion', () => {
    expect(ringTurnAt(RING_TURN_S / 2, false)).toBeCloseTo(Math.PI, 12)
    expect(wavePhaseAt(WAVE_S / 4, false)).toBeCloseTo(TAU / 4, 12)
    expect(ringTurnAt(5, true)).toBe(0)
    expect(wavePhaseAt(5, true)).toBe(0)
  })

  it('the wave has two crests round the ring, 0 to 1', () => {
    const at = Array.from({ length: 360 }, (_, i) => waveAt((i / 360) * TAU, 0))
    expect(Math.min(...at)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...at)).toBeLessThanOrEqual(1)
    const crests = at.filter((v, i) => v > at[(i + 359) % 360] && v >= at[(i + 1) % 360]).length
    expect(crests).toBe(2)
  })

  it('a new thing’s pulse leaves the ring every 2.4 s, grows past it and fades; a faint still ring with reduced motion', () => {
    const start = pulseAt(0, 0, false)
    expect(start.scale).toBeCloseTo(0.8, 12)
    expect(start.opacity).toBeCloseTo(0.9, 12)
    const out = pulseAt(1.6, 0, false)
    expect(out.scale).toBeCloseTo(1.12, 12)
    expect(out.opacity).toBeCloseTo(0, 12)
    expect(pulseAt(0.5 + PULSE_S, 0, false)).toEqual(pulseAt(0.5, 0, false))
    expect(pulseAt(3, 1, true)).toEqual({ scale: 1, opacity: 0.35 })
  })
})

describe('a sound', () => {
  it('its level lines stay inside the ring’s reach, ride the wave quiet and dance playing', () => {
    for (let i = 0; i < LEVEL_LINES; i++) {
      for (const t of [0, 0.3, 1.7, 9]) {
        const len = levelLength(i, t, true, false, 0.5)
        expect(len).toBeGreaterThan(0)
        expect(RING_RADIUS + len).toBeLessThanOrEqual(RING_REACH + 1e-9)
      }
    }
    expect(levelLength(3, 0, false, false, 0)).toBeCloseTo(0.05, 12)
    expect(levelLength(3, 0, false, false, 1)).toBeCloseTo(0.11, 12)
    expect(levelLength(3, 5, true, true, 0.2)).toBe(0.15)
    // Playing, they move.
    expect(new Set([0, 0.1, 0.2, 0.3].map((t) => levelLength(3, t, true, false, 0.5).toFixed(4))).size).toBeGreaterThan(2)
  })

  it('its slices are thin at the ends and full in the middle, stacked about its middle', () => {
    expect(SLICES).toBe(7)
    expect(sliceEnvelope(3)).toBeCloseTo(1, 12)
    expect(sliceEnvelope(0)).toBeLessThan(sliceEnvelope(1))
    expect(sliceY(0)).toBeCloseTo(-sliceY(SLICES - 1), 12)
    expect(SLICES_LOW).toBeGreaterThan(-sliceY(0))
  })

  it('its slices swell with the sound playing, breathe quiet, and hold still with reduced motion, inside the ring', () => {
    const quiet = [0, 1, 2, 3].map((t) => sliceRadius(3, t, false, false))
    const loud = [0, 0.1, 0.2, 0.3, 0.4].map((t) => sliceRadius(3, t, true, false))
    for (const r of [...quiet, ...loud]) { expect(r).toBeGreaterThan(0); expect(r).toBeLessThanOrEqual(SLICE_MAX_R); expect(r).toBeLessThan(RING_RADIUS) }
    expect(Math.max(...loud) - Math.min(...loud)).toBeGreaterThan(Math.max(...quiet) - Math.min(...quiet))
    expect(sliceRadius(3, 0, false, true)).toBe(sliceRadius(3, 7, false, true))
    expect(sliceRadius(3, 0, true, true)).toBeGreaterThan(sliceRadius(3, 0, false, true))
  })
})

describe('an item’s notch code', () => {
  it('is five depths of 1 to 3, the same for the same item, and unlike its neighbours’', () => {
    const a = notchCode('gate-key')
    expect(a).toHaveLength(5)
    for (const d of a) expect([1, 2, 3]).toContain(d)
    expect(notchCode('gate-key')).toEqual(a)
    const codes = new Set(Array.from({ length: 40 }, (_, i) => notchCode(`item-${i}`).join('')))
    expect(codes.size).toBeGreaterThan(30)
  })
})
