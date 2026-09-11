import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { EXPERIENCE_MAX, RATIO_MAX, RATIO_MIN, experienceRatio, ratioOf, recordJobExperience, useExperience } from './experience'
import { crossoverHeight } from './crossover'

const s = (estimated: number, actual: number) => ({ estimated, actual, height: 24, action: 'hop', at: 1 })

describe('the ratio', () => {
  it('is 1 with fewer than two samples', () => {
    expect(ratioOf([])).toBe(1)
    expect(ratioOf([s(100, 300)])).toBe(1)
  })

  it('is the median of actual over estimated', () => {
    expect(ratioOf([s(100, 120), s(100, 150), s(100, 900)])).toBeCloseTo(1.5)
    expect(ratioOf([s(100, 100), s(100, 200)])).toBeCloseTo(1.5)
  })

  it('never leaves its band', () => {
    expect(ratioOf([s(100, 1), s(100, 1)])).toBe(RATIO_MIN)
    expect(ratioOf([s(100, 10_000), s(100, 10_000)])).toBe(RATIO_MAX)
  })
})

describe('recording', () => {
  beforeEach(() => { useExperience.getState().clear() })

  it('keeps the newest samples and forgets the oldest', () => {
    for (let i = 0; i < EXPERIENCE_MAX + 5; i++) useExperience.getState().record({ estimated: 100, actual: 100 + i, height: 20, action: 'hop' })
    expect(useExperience.getState().samples).toHaveLength(EXPERIENCE_MAX)
    expect(useExperience.getState().samples[0].actual).toBe(105)
  })

  it('times a job from when it began computing, not from submit', () => {
    const now = Date.now()
    recordJobExperience({ estSeconds: 60, createdAt: now - 300_000, computingAt: now - 90_000, action: 'hop' }, 22)
    expect(useExperience.getState().samples[0].actual).toBeCloseTo(90, 0)
  })

  it('ignores a job with no estimate', () => {
    recordJobExperience({ createdAt: Date.now() - 1000, action: 'hop' }, 22)
    expect(useExperience.getState().samples).toHaveLength(0)
  })

  it('survives a reload', () => {
    useExperience.getState().record({ estimated: 100, actual: 150, height: 20, action: 'hop' })
    useExperience.getState().record({ estimated: 100, actual: 150, height: 20, action: 'hop' })
    expect(JSON.parse(localStorage.getItem('onosendai:hosakaExperience') ?? '[]')).toHaveLength(2)
    expect(experienceRatio()).toBeCloseTo(1.5)
  })
})

describe('TIME counts it', () => {
  const inputs = { hopCeiling: 17, sidestepCeiling: 24, cloudHop: 30, cantorMsByHeight: { 15: 200, 16: 500, 17: 1250 }, sha256PerSec: 1_000_000, ladder: [{ max_height: 22, est_seconds: 60 }, { max_height: 27, est_seconds: 600 }, { max_height: 30, est_seconds: 15000 }], signerKind: 'local' as const }

  it('a provider that runs slow than it says moves the crossover up, or away', () => {
    const trusted = crossoverHeight({ ...inputs, experience: 1 })
    const slow = crossoverHeight({ ...inputs, experience: 4 })
    expect(slow >= trusted).toBe(true)
  })
})
