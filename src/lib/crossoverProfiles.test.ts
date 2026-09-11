import { describe, expect, it } from 'vitest'
import { crossoverFor } from './crossover'

const inputs = { hopCeiling: 17, sidestepCeiling: 24, cloudHop: 30, cantorMsByHeight: null, sha256PerSec: null, ladder: null, signerKind: 'local' as const }

describe('where each strategy hands a wall to HOSAKA', () => {
  it('LOOT: one above this machine\'s hop ceiling, so every wall is bought', () => {
    expect(crossoverFor('loot', inputs)).toBe(18)
  })

  it('COST: never', () => {
    expect(crossoverFor('cost', inputs)).toBe(Infinity)
  })

  it('TIME: measured, and with nothing measured it does not pretend to know', () => {
    const h = crossoverFor('time', inputs)
    expect(h === Infinity || (Number.isFinite(h) && h > 17)).toBe(true)
  })
})
