/**
 * hosakaAd.test.ts: the spots are versioned and taken in turn, and each runs
 * its scenes back to back, the banner first and the end card last.
 */
import { describe, expect, it } from 'vitest'
import { ADS, AD_EVERY_MS, adById, adLength, nextAd } from '../hosakaAd'

describe('TV commercials', () => {
  it('are versioned, each id unique', () => {
    for (const ad of ADS) expect(ad.id).toMatch(/^[a-z]+-\d+-[a-z0-9-]+$/)
    expect(new Set(ADS.map((a) => a.id)).size).toBe(ADS.length)
  })

  it('run their scenes back to back, the banner first and the end card last', () => {
    for (const ad of ADS) {
      ad.scenes.forEach((sc, i) => {
        expect(sc.to).toBeGreaterThan(sc.from)
        if (i > 0) expect(sc.from).toBe(ad.scenes[i - 1].to)
      })
      expect(ad.scenes[0]).toMatchObject({ from: 0, kind: 'banner' })
      expect(ad.scenes[ad.scenes.length - 1].kind).toBe('end')
      // Brief: well under a minute.
      expect(adLength(ad)).toBeLessThan(30)
    }
  })

  it('take turns, and an id from an older release still plays a spot', () => {
    expect(nextAd(null)).toBe(ADS[0])
    expect(nextAd(ADS[ADS.length - 1].id)).toBe(ADS[0])
    expect(adById('hosaka-0-gone')).toBe(ADS[0])
    expect(AD_EVERY_MS).toBe(600_000)
  })
})
