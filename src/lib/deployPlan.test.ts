import { describe, expect, it } from 'vitest'
import { cloudKeyQuote, deployCeiling, deployRoute, localKeySeconds, needsAsk, waitLabel } from './deployPlan'

const ladder = [{ max_height: 24, sats: 60, est_time: 'about 3 min' }, { max_height: 27, sats: 200, est_time: 'about 9 min' }]

describe('where a hide is computed', () => {
  it('stays on this machine up to its ceiling, and goes to HOSAKA above it', () => {
    const i = { localMax: 20, cloudMode: 'auto' as const, cloudCap: 27 }
    expect(deployRoute(20, i)).toBe('local')
    expect(deployRoute(21, i)).toBe('cloud')
  })

  it('the bar offers HOSAKA\'s cap when cloud compute is on, and only the machine\'s when off', () => {
    expect(deployCeiling({ localMax: 20, cloudMode: 'ask', cloudCap: 27 })).toBe(27)
    expect(deployCeiling({ localMax: 20, cloudMode: 'off', cloudCap: 27 })).toBe(20)
    expect(deployCeiling({ localMax: 20, cloudMode: 'auto', cloudCap: null })).toBe(20)
  })
})

describe('the ask', () => {
  it('ASK always asks', () => { expect(needsAsk('ask', 60, 1000)).toBe(true) })
  it('AUTO goes without asking up to its cap, and asks above it', () => {
    expect(needsAsk('auto', 60, 100)).toBe(false)
    expect(needsAsk('auto', 200, 100)).toBe(true)
  })
  it('an AUTO cap of zero asks every time', () => { expect(needsAsk('auto', 1, 0)).toBe(true) })
  it('an unknown price asks', () => { expect(needsAsk('auto', null, 1000)).toBe(true) })
})

describe('the estimates', () => {
  it('local time is three axes at the calibration\'s rate, and unknown before the benchmark', () => {
    expect(localKeySeconds(18, { 16: 1000, 17: 2500, 18: 6250 })).toBeCloseTo(18.75)
    expect(localKeySeconds(18, undefined)).toBeNull()
    expect(localKeySeconds(0, { 16: 1000 })).toBe(0)
  })

  it('HOSAKA\'s quote comes from the band the height falls in', () => {
    expect(cloudKeyQuote(22, ladder)).toEqual({ sats: 60, seconds: 180 })
    expect(cloudKeyQuote(27, ladder)).toEqual({ sats: 200, seconds: 540 })
    expect(cloudKeyQuote(30, ladder)).toBeNull()
  })

  it('says a wait in words', () => {
    expect(waitLabel(12)).toBe('about 12 s')
    expect(waitLabel(540)).toBe('about 9 min')
    expect(waitLabel(5400)).toBe('about 1.5 h')
  })
})
