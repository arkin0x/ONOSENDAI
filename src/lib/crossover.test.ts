import { describe, expect, it } from 'vitest'
import { EVENT_SECONDS, PAYMENT_SECONDS, cloudSeconds, crossoverHeight, parseEstTime, walkSeconds, type CrossoverInputs } from './crossover'

/** HOSAKA's real published ladder, as the live provider gives it. */
const LADDER = [
  { max_height: 18, sats: 9, est_seconds: 97 },
  { max_height: 20, sats: 10, est_seconds: 103 },
  { max_height: 22, sats: 13, est_seconds: 136 },
  { max_height: 24, sats: 41, est_seconds: 277 },
  { max_height: 25, sats: 79, est_seconds: 474 },
  { max_height: 27, sats: 609, est_seconds: 1730 },
]

/** A phone: hops to 2^17, hashes 559k a second, so it sidesteps to 2^24. */
const phone = (signerKind: CrossoverInputs['signerKind'] = 'local'): CrossoverInputs => ({
  hopCeiling: 17,
  sidestepCeiling: 24,
  cloudHop: 27,
  cantorMsByHeight: { 14: 300, 15: 700, 16: 1600, 17: 3800 },
  sha256PerSec: 559_000,
  ladder: LADDER,
  signerKind,
})

describe('reading the provider', () => {
  it('takes the seconds it publishes, by band', () => {
    expect(cloudSeconds(18, LADDER)).toBe(97)
    expect(cloudSeconds(21, LADDER)).toBe(136)
    expect(cloudSeconds(27, LADDER)).toBe(1730)
  })

  it('falls back to the words when the seconds are missing', () => {
    expect(parseEstTime('about 5 min')).toBe(300)
    expect(parseEstTime('under 10 sec')).toBe(10)
    expect(parseEstTime('about 1.5 hr')).toBe(5400)
    expect(parseEstTime('rejected, use a sidestep')).toBeNull()
    expect(cloudSeconds(24, [{ max_height: 24, est_time: 'about 5 min' }])).toBe(300)
  })

  it('says nothing when the height is past the ladder', () => {
    expect(cloudSeconds(40, LADDER)).toBeNull()
  })
})

describe('the walk', () => {
  it('grows by the step count, not by the sidestep', () => {
    const p = phone()
    const low = walkSeconds(18, p)
    const high = walkSeconds(24, p)
    // Four steps against 256: two orders of magnitude, not one crossing's worth.
    expect(high / low).toBeGreaterThan(50)
  })

  it('counts the signature on every event', () => {
    const withKey = walkSeconds(22, phone('local'))
    const withBunker = walkSeconds(22, phone('nip46'))
    expect(withBunker).toBeGreaterThan(withKey)
    expect(EVENT_SECONDS.nip46).toBeGreaterThan(EVENT_SECONDS.local)
  })

  it('is out of the question above this machine’s sidestep ceiling', () => {
    expect(walkSeconds(26, phone())).toBe(Infinity)
  })
})

describe('the crossover', () => {
  it('leaves the small crossings to this machine', () => {
    const h = crossoverHeight(phone())
    expect(h).toBeGreaterThan(17)
    // A 2^18 crossing is four steps and a few seconds: never worth 9 sats.
    expect(walkSeconds(18, phone())).toBeLessThan(cloudSeconds(18, LADDER)! + PAYMENT_SECONDS)
    expect(h).toBeGreaterThan(18)
  })

  it('hands over once the walk is longer than the hop', () => {
    const p = phone()
    const h = crossoverHeight(p)
    expect(Number.isFinite(h)).toBe(true)
    expect(walkSeconds(h, p)).toBeGreaterThan(cloudSeconds(h, LADDER)! + PAYMENT_SECONDS)
    expect(walkSeconds(h - 1, p)).toBeLessThanOrEqual(cloudSeconds(h - 1, LADDER)! + PAYMENT_SECONDS)
  })

  it('hands over sooner when every event costs a bunker round trip', () => {
    expect(crossoverHeight(phone('nip46'))).toBeLessThanOrEqual(crossoverHeight(phone('local')))
  })

  it('never hands over when the provider says nothing about its times', () => {
    expect(crossoverHeight({ ...phone(), ladder: null })).toBe(Infinity)
    expect(crossoverHeight({ ...phone(), ladder: [{ max_height: 27 }] })).toBe(Infinity)
  })

  it('never hands over when the cloud reaches no further than this machine', () => {
    expect(crossoverHeight({ ...phone(), cloudHop: 17 })).toBe(Infinity)
  })
})
