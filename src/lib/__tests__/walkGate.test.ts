import { describe, expect, it } from 'vitest'
import { GATE_FULL, GATE_HIDE, boxDistance, nearGate } from '../walkGate'

describe('nearGate (arkinox, 2026-10-13: nothing at the proven head shows at the eye)', () => {
  it('hides anything closer than GATE_HIDE, the eye itself included', () => {
    expect(nearGate(0)).toBe(0)
    expect(nearGate(0.3)).toBe(0)
    expect(nearGate(GATE_HIDE)).toBe(0)
    expect(nearGate(Number.NaN)).toBe(0)
  })

  it('eases in between the two and is full from GATE_FULL out', () => {
    const mid = nearGate((GATE_HIDE + GATE_FULL) / 2)
    expect(mid).toBeGreaterThan(0.4)
    expect(mid).toBeLessThan(0.6)
    expect(nearGate(0.7)).toBeLessThan(nearGate(0.9))
    expect(nearGate(GATE_FULL)).toBe(1)
    expect(nearGate(5)).toBe(1)
  })

  it('a step behind the eye is drawn: one whole cell is past the gate', () => {
    expect(nearGate(1)).toBe(1)
  })
})

describe('boxDistance', () => {
  it('is 0 anywhere inside the box', () => {
    expect(boxDistance([0, 0, 0], [0, 0, 0], [2, 2, 2])).toBe(0)
    expect(boxDistance([0.9, -0.9, 0.5], [0, 0, 0], [2, 2, 2])).toBe(0)
  })

  it('measures to the nearest face, edge or corner outside it', () => {
    expect(boxDistance([3, 0, 0], [0, 0, 0], [2, 2, 2])).toBeCloseTo(2)
    expect(boxDistance([2, 2, 0], [0, 0, 0], [2, 2, 2])).toBeCloseTo(Math.SQRT2)
    expect(boxDistance([0, 0, -1.5], [0, 0, -1], [1, 1, 1])).toBeCloseTo(0)
  })
})
