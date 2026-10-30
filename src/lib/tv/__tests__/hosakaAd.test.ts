/**
 * hosakaAd.test.ts: the spots are versioned and taken in turn, and each runs
 * its scenes back to back, ending on its call: an end card under a sponsor's
 * mark, or, with no mark, a card held long and steady. Not every spot has a
 * banner: HOSAKA's does (its logo animation); a spot with no sponsor's mark
 * (CTV_ADVERTISE_1) goes straight to its cards, and ends on its address.
 */
import { describe, expect, it } from 'vitest'
import { ADS, AD_EVERY_MS, AD_IN_MS, BROADCAST_AD_EVERY_MS, CTV_ADVERTISE_1, HOSAKA_1, adById, adEveryMs, adFor, adLength, broadcastCut, nextAd } from '../hosakaAd'
import { CUT_MS } from '../../../hud/TvSegments'

describe('TV commercials', () => {
  it('are versioned, each id unique', () => {
    for (const ad of ADS) expect(ad.id).toMatch(/^[a-z]+-\d+-[a-z0-9-]+$/)
    expect(new Set(ADS.map((a) => a.id)).size).toBe(ADS.length)
  })

  it('run their scenes back to back, ending on the call: an end card under a mark, a card where there is none', () => {
    for (const ad of ADS) {
      ad.scenes.forEach((sc, i) => {
        expect(sc.to).toBeGreaterThan(sc.from)
        if (i > 0) expect(sc.from).toBe(ad.scenes[i - 1].to)
        else expect(sc.from).toBe(0)
      })
      const last = ad.scenes[ad.scenes.length - 1]
      expect(last.kind).toBe(ad.scenes.some((sc) => sc.mark) ? 'end' : 'card')
      // Brief: well under a minute.
      expect(adLength(ad)).toBeLessThan(30)
    }
  })

  it('HOSAKA\'s spot leads with its banner; the house spot has none to show', () => {
    expect(HOSAKA_1.scenes[0]).toMatchObject({ kind: 'banner' })
    expect(CTV_ADVERTISE_1.scenes.some((sc) => sc.kind === 'banner')).toBe(false)
    expect(CTV_ADVERTISE_1.scenes.some((sc) => sc.mark)).toBe(false)
  })

  it('take turns, and an id from an older release still plays a spot', () => {
    expect(nextAd(null)).toBe(ADS[0])
    expect(nextAd(HOSAKA_1.id)).toBe(CTV_ADVERTISE_1)
    expect(nextAd(ADS[ADS.length - 1].id)).toBe(ADS[0])
    expect(adById('hosaka-0-gone')).toBe(ADS[0])
    expect(AD_EVERY_MS).toBe(300_000)
  })

  it('starts a spot\'s clock after the cut into it, which is TV\'s own cut', () => {
    expect(AD_IN_MS).toBe(CUT_MS)
  })
})

describe('the spot on the 24/7 stream (arkinox, 2026-10-21)', () => {
  it('plays every 15 minutes there, every 5 on the site', () => {
    expect(AD_EVERY_MS).toBe(5 * 60_000)
    expect(BROADCAST_AD_EVERY_MS).toBe(15 * 60_000)
    expect(adEveryMs(false)).toBe(AD_EVERY_MS)
    expect(adEveryMs(true)).toBe(BROADCAST_AD_EVERY_MS)
  })

  it('names ONOSENDAI.TECH on the end card, keeping the button and the mark; the site keeps its words', () => {
    const site = HOSAKA_1.scenes[HOSAKA_1.scenes.length - 1]
    const stream = broadcastCut(HOSAKA_1).scenes[HOSAKA_1.scenes.length - 1]
    expect(site.lines).toEqual(['SEE THE CLOUD COMPUTE PANEL', 'IN THE ONOSENDAI MENU'])
    expect(stream.lines).toEqual(['SEE THE CLOUD COMPUTE PANEL', 'IN THE ONOSENDAI.TECH MENU'])
    expect(stream).toMatchObject({ kind: 'end', icon: 'menu', mark: true, from: site.from, to: site.to })
    // Every other scene is the same scene.
    broadcastCut(HOSAKA_1).scenes.slice(0, -1).forEach((sc, i) => expect(sc).toBe(HOSAKA_1.scenes[i]))
    expect(adLength(broadcastCut(HOSAKA_1))).toBe(adLength(HOSAKA_1))
  })

  it('is cut once per spot, and found by id like the site\'s', () => {
    expect(broadcastCut(HOSAKA_1)).toBe(broadcastCut(HOSAKA_1))
    expect(adFor(HOSAKA_1.id, false)).toBe(HOSAKA_1)
    expect(adFor(HOSAKA_1.id, true)).toBe(broadcastCut(HOSAKA_1))
    expect(adFor('gone-1-old', true)).toBe(broadcastCut(ADS[0]))
  })
})
