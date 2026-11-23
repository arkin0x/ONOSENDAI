/**
 * Point size and glow as the renderer reads them (DECK-0003 §1.15, §1.16;
 * lib/pointLook.ts): POINTS only, never an avatar, ticks to model units, 0
 * draws no points, opacity 0 draws nothing but the glow, and GLOW STRENGTH
 * is never multiplied by the object's opacity.
 */
import { describe, expect, it } from 'vitest'
import type { ShardModel } from 'sno-core/shards'
import { benchFaintDots, drawPlan, drawsAnything, gibsonsLabel, glowReachDoublings, haloFade, pointLookOf, ticksToGibsons, ticksToUnits, unseenObject } from '../pointLook'

function model(mode: ShardModel['mode'], extra?: Record<string, unknown>, opacity?: number): ShardModel {
  return {
    id: 'x', name: 'x', unit: 0, extent: 8, mode, up: false, spin: 0, updatedAt: 0,
    vertices: [{ p: [0, 0, 0], c: [1, 0.5, 0] }, { p: [1, 0, 0], c: [1, 0.5, 0] }],
    faces: [],
    ...(extra ? { extra } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
  } as unknown as ShardModel
}

describe('reading the fields per mode and for avatars', () => {
  const fields = { pointsize: 48, glow: ['fog', 240, 35] }
  it('POINTS reads both, in model units', () => {
    const l = pointLookOf(model('points', fields))
    expect(l.pointSize).toBeCloseTo(0.4)
    expect(l.glow).toEqual({ style: 'fog', radius: 240, strength: 35 })
    expect(l.glowRadius).toBe(2)
    expect(l.glowStrength).toBeCloseTo(0.35)
  })
  it('SOLID and LINES keep them and draw neither', () => {
    for (const mode of ['solid', 'lines'] as const) {
      const l = pointLookOf(model(mode, fields))
      expect(l.pointSize).toBeUndefined()
      expect(l.glow).toBeUndefined()
      expect(drawPlan(mode, l).halos).toBe(false)
    }
  })
  it('an avatar ignores both, and its opacity', () => {
    const l = pointLookOf(model('points', fields, 0), { avatar: true })
    expect(l.pointSize).toBeUndefined()
    expect(l.glow).toBeUndefined()
    expect(l.hidden).toBe(false)
  })
  it('malformed values are absent, never a refusal', () => {
    const l = pointLookOf(model('points', { pointsize: 1.5, glow: ['Light', 240, 35] }))
    expect(l.pointSize).toBeUndefined()
    expect(l.glow).toBeUndefined()
  })
})

describe('ticks to render units', () => {
  it('120 ticks to the unit, times 2^unit and every placement step in gibsons', () => {
    expect(ticksToUnits(120)).toBe(1)
    expect(ticksToUnits(48)).toBeCloseTo(0.4)
    expect(ticksToGibsons(120, 0)).toBe(1)
    expect(ticksToGibsons(120, 3)).toBe(8)
    expect(ticksToGibsons(60, 3, 2)).toBe(16)
  })
  it('labels gibsons plainly', () => {
    expect(gibsonsLabel(0.4)).toBe('0.4 GIBSONS')
    expect(gibsonsLabel(1)).toBe('1 GIBSON')
    expect(gibsonsLabel(16)).toBe('16 GIBSONS')
    expect(gibsonsLabel(0)).toBe('0 GIBSONS')
    expect(gibsonsLabel(2 ** 40)).toBe('2^40 GIBSONS')
  })
})

describe('what is drawn', () => {
  it('no POINT SIZE: the client disc, as before', () => {
    expect(drawPlan('points', pointLookOf(model('points'))).points).toBe('disc')
    expect(drawPlan('solid', pointLookOf(model('solid', { pointsize: 48 }))).points).toBe('disc')
  })
  it('a POINT SIZE: billboards; 0 draws no points at all', () => {
    expect(drawPlan('points', pointLookOf(model('points', { pointsize: 48 }))).points).toBe('billboard')
    expect(drawPlan('points', pointLookOf(model('points', { pointsize: 0 }))).points).toBe('none')
  })
  it('opacity 0 draws nothing of its own, and its glow still shows', () => {
    for (const mode of ['solid', 'lines', 'points'] as const) {
      const plan = drawPlan(mode, pointLookOf(model(mode, { pointsize: 48, glow: ['light', 240, 50] }, 0)))
      expect(plan.faces).toBe(false)
      expect(plan.lines).toBe(false)
      expect(plan.points).toBe('none')
      expect(plan.halos).toBe(mode === 'points')
    }
  })
  it('the Settings switch and a culled avatar draw no halos', () => {
    const look = pointLookOf(model('points', { glow: ['light', 240, 50] }))
    expect(drawPlan('points', look, { glowAllowed: false }).halos).toBe(false)
    expect(drawPlan('points', look, { cull: true }).halos).toBe(false)
    expect(drawPlan('points', look).halos).toBe(true)
  })
})

describe('GLOW STRENGTH is the glow\'s own', () => {
  it('the same strength at every opacity', () => {
    const glow = { glow: ['fog', 240, 35] }
    const at = [0, 10, 50, 99].map((o) => pointLookOf(model('points', glow, o)).glowStrength)
    expect(new Set(at)).toEqual(new Set([pointLookOf(model('points', glow)).glowStrength]))
  })
  it('multiplied only by the client fade (ghost, dim)', () => {
    expect(haloFade({})).toBe(1)
    expect(haloFade({ ghostShare: 0.45, dim: 0.5 })).toBeCloseTo(0.225)
  })
})

describe('drawsAnything', () => {
  it('is false only when nothing at all can show', () => {
    expect(drawsAnything(model('points'))).toBe(true)
    expect(drawsAnything(model('points', undefined, 0))).toBe(false)
    expect(drawsAnything(model('points', { glow: ['light', 120, 50] }, 0))).toBe(true)
    expect(drawsAnything(model('points', { pointsize: 0 }))).toBe(false)
    expect(drawsAnything(model('solid', { pointsize: 0 }))).toBe(true)
  })
})

describe('unseenObject and the glow cull', () => {
  it('no one can see opacity 0, or bare POINTS at point size 0 with no glow', () => {
    expect(unseenObject(model('solid', undefined, 0))).toBe(true)
    expect(unseenObject(model('points', { pointsize: 0 }))).toBe(true)
    expect(unseenObject(model('points', { pointsize: 0, glow: ['fog', 120, 20] }))).toBe(false)
    expect(unseenObject(model('solid', { pointsize: 0 }))).toBe(false)
    expect(unseenObject(model('points'))).toBe(false)
  })
  it('a glow widens the far cull by log2(1 + its radius in units)', () => {
    expect(glowReachDoublings(model('points'))).toBe(0)
    expect(glowReachDoublings(model('points', { glow: ['light', 7680, 50] }))).toBeCloseTo(Math.log2(65))
    expect(glowReachDoublings(model('solid', { glow: ['light', 7680, 50] }))).toBe(0)
    expect(glowReachDoublings(model('points', { glow: ['light', 491520, 50] }))).toBeCloseTo(Math.log2(4097))
  })
})

describe('the bench\'s faint dots for an object no one can see', () => {
  const hidden = model('points', { pointsize: 0 })
  const at = (o: Partial<{ onBench: boolean; moving: boolean; cull: boolean; world: boolean }>) => benchFaintDots(hidden, pointLookOf(hidden), { onBench: true, moving: true, world: false, ...o })
  it('show only on the bench, where its handles are hidden (an object drawn moving)', () => {
    expect(at({})).toBe(true)
    expect(at({ moving: false })).toBe(false)
    expect(at({ onBench: false })).toBe(false)
    expect(at({ cull: true })).toBe(false)
  })
  it('skip LOOK, which shows the world as it is (#778)', () => {
    expect(at({ world: true })).toBe(false)
  })
  it('only for an object no one can see', () => {
    const seen = model('points')
    expect(benchFaintDots(seen, pointLookOf(seen), { onBench: true, moving: true, world: false })).toBe(false)
    const zero = model('solid', undefined, 0)
    expect(benchFaintDots(zero, pointLookOf(zero), { onBench: true, moving: true, world: false })).toBe(true)
  })
})
