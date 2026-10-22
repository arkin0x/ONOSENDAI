import { describe, expect, it } from 'vitest'
import { cloudKeyQuote, deployCeiling, deployRoute, localKeyCeiling, localKeySeconds, needsAsk, regionKeyLadder, regionKeyQuote, waitLabel } from '../deployPlan'
import type { HosakaProvider } from '../hosaka'
import { useCalibration } from '../calibration'

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

describe('this machine\'s limit', () => {
  it('is the calibrated hop ceiling, the number the movement panel shows', () => {
    useCalibration.setState({ hopHeight: 17 })
    expect(localKeyCeiling()).toBe(17)
  })

  it('never passes the protocol\'s cap of 20', () => {
    useCalibration.setState({ hopHeight: 20 })
    expect(localKeyCeiling()).toBe(20)
  })
})

// GET /api/v1/provider's pricing as hosaka-api#30 shapes it: a hop ladder and,
// beside it, a region key ladder on the same rungs that is cheaper than the hop
// at the low rungs and dearer at the top ones. The numbers are this fixture's;
// the test reads whatever ladder it is handed and assumes no cap.
const hop = [
  { max_height: 25, sats: 120, est_time: 'about 4 min', est_seconds: 240 },
  { max_height: 27, sats: 300, est_time: 'about 9 min', est_seconds: 540 },
  { max_height: 28, sats: 700, est_time: 'about 20 min', est_seconds: 1200 },
  { max_height: 30, sats: 9000, est_time: 'about 1.5 hr', est_seconds: 5400 },
]
const regionKey = [
  { max_height: 25, sats: 90, est_time: 'about 5 min', est_seconds: 300 },
  { max_height: 27, sats: 250, est_time: 'about 11 min', est_seconds: 660 },
  { max_height: 28, sats: 1500, est_time: 'about 30 min', est_seconds: 1800 },
  { max_height: 30, sats: 20000, est_time: 'about 2.5 hr', est_seconds: 9000 },
]
const withRegionKey: Pick<HosakaProvider, 'pricing'> = { pricing: { reference: true, hop, region_key: regionKey } }
const hopOnly: Pick<HosakaProvider, 'pricing'> = { pricing: { reference: true, hop } }

describe('the region key price', () => {
  it('comes from the region key ladder when the provider publishes one', () => {
    expect(regionKeyLadder(withRegionKey)).toBe(regionKey)
    // Cheaper than the hop's rung below the top, dearer at the top: never the hop's number.
    expect(regionKeyQuote(26, withRegionKey)).toEqual({ sats: 250, seconds: 660 })
    expect(regionKeyQuote(28, withRegionKey)).toEqual({ sats: 1500, seconds: 1800 })
    expect(regionKeyQuote(30, withRegionKey)).toEqual({ sats: 20000, seconds: 9000 })
    for (const h of [21, 26, 28, 29, 30]) {
      expect(regionKeyQuote(h, withRegionKey)?.sats).not.toBe(cloudKeyQuote(h, hop)?.sats)
    }
  })

  it('falls back to the hop ladder on a provider that predates it, as before', () => {
    expect(regionKeyLadder(hopOnly)).toBe(hop)
    expect(regionKeyQuote(26, hopOnly)).toEqual({ sats: 300, seconds: 540 })
    expect(regionKeyQuote(30, hopOnly)).toEqual({ sats: 9000, seconds: 5400 })
    // An empty region key ladder is no ladder: the hop ladder stands.
    expect(regionKeyQuote(26, { pricing: { hop, region_key: [] } })).toEqual({ sats: 300, seconds: 540 })
  })

  it('is unknown past the top of the region key ladder, rather than read from the hop ladder', () => {
    const shortKey = { pricing: { hop, region_key: regionKey.slice(0, 2) } }
    expect(regionKeyQuote(28, shortKey)).toBeNull()
    expect(regionKeyQuote(31, withRegionKey)).toBeNull()
    expect(regionKeyQuote(31, hopOnly)).toBeNull()
  })

  it('is unknown with no provider or no pricing, and an unknown price asks', () => {
    expect(regionKeyLadder(null)).toBeNull()
    expect(regionKeyLadder({})).toBeNull()
    expect(regionKeyQuote(26, undefined)).toBeNull()
    expect(needsAsk('auto', regionKeyQuote(26, {})?.sats ?? null, 1_000_000)).toBe(true)
  })

  it('carries the experience correction like any cloud quote', () => {
    expect(regionKeyQuote(26, withRegionKey, 2)).toEqual({ sats: 250, seconds: 1320 })
  })
})
