/**
 * The shallow bag warning (arkinox, 2026-10-19: "i think when hiding a bag we
 * need a clear warning if the depth is <13"). Discovery computes heights 0 to
 * SCAN_MAX_HEIGHT wherever a view stops, so a bag hidden there is found by
 * anyone viewing its region. The chip shows through SCAN_MAX_HEIGHT and is
 * gone one height above it, where the past-height warning takes over; the
 * publish confirmation of a shallow LOCAL bag says the same.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SCAN_MAX_HEIGHT } from '../../store/useShards'
import { SHALLOW_WARN, shallowBag, shallowExplain } from '../../lib/shallowBag'
import { HeightWarnings } from '../DeployBar'
import { PublishBody } from '../PublishSwitch'

/** A machine that computes well past discovery's reach, and one that stops at it. */
const FAST = SCAN_MAX_HEIGHT + 8
const SLOW = SCAN_MAX_HEIGHT

/** Attribute-escaped, as React writes a title. */
const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

const warnings = (height: number, intoChest = false, localMax = FAST): string =>
  renderToStaticMarkup(<HeightWarnings height={height} intoChest={intoChest} localMax={localMax} />)

describe('shallowBag', () => {
  it('is every height discovery computes, and none past it', () => {
    expect(shallowBag(0)).toBe(true)
    expect(shallowBag(SCAN_MAX_HEIGHT)).toBe(true)
    expect(shallowBag(SCAN_MAX_HEIGHT + 1)).toBe(false)
  })
})

describe('HeightWarnings', () => {
  it('at SCAN_MAX_HEIGHT shows only the chip, its explanation the tooltip', () => {
    const html = warnings(SCAN_MAX_HEIGHT)
    expect(html).toContain('deploybar__shallow')
    expect(html).toContain(SHALLOW_WARN)
    expect(html).toContain(`title="${attr(shallowExplain(FAST))}"`)
    expect(html).not.toContain('deploybar__warn')
    expect(html).not.toContain('Past height')
  })

  it('at SCAN_MAX_HEIGHT + 1 shows only the past-height warning', () => {
    const html = warnings(SCAN_MAX_HEIGHT + 1)
    expect(html).not.toContain('deploybar__shallow')
    expect(html).not.toContain(SHALLOW_WARN)
    expect(html).toContain('deploybar__warn')
    expect(html).toContain(`Past height ${SCAN_MAX_HEIGHT}`)
  })

  it('shows neither while a shard is aimed into a chest, at any height', () => {
    expect(warnings(SCAN_MAX_HEIGHT, true)).toBe('')
    expect(warnings(SCAN_MAX_HEIGHT + 1, true)).toBe('')
  })

  it('says going deeper needs HOSAKA on a machine whose own ceiling discovery already reaches', () => {
    const html = warnings(SCAN_MAX_HEIGHT, false, SLOW)
    expect(html).toContain(`title="${attr(shallowExplain(SLOW))}"`)
    expect(shallowExplain(SLOW)).toContain(`height ${SCAN_MAX_HEIGHT + 1} or more`)
    expect(shallowExplain(SLOW)).toContain('needs HOSAKA')
    expect(shallowExplain(SCAN_MAX_HEIGHT + 1)).not.toContain('HOSAKA')
  })

  it('says height, as the row it warns about does, with the numbers from SCAN_MAX_HEIGHT', () => {
    const tip = shallowExplain(FAST)
    expect(tip).toContain(`height ${SCAN_MAX_HEIGHT} or less`)
    expect(tip).toContain(`height ${SCAN_MAX_HEIGHT + 1} or more`)
    expect(tip.toLowerCase()).not.toContain('depth')
  })
})

describe('PublishBody', () => {
  it('adds the chip line for a shallow LOCAL bag going LIVE', () => {
    const html = renderToStaticMarkup(<PublishBody height={SCAN_MAX_HEIGHT} />)
    expect(html).toContain('pubswitch__shallow')
    expect(html).toContain(SHALLOW_WARN)
  })

  it('leaves it out past SCAN_MAX_HEIGHT, and when the height is unknown', () => {
    for (const height of [SCAN_MAX_HEIGHT + 1, null]) {
      const html = renderToStaticMarkup(<PublishBody height={height} />)
      expect(html).toContain('Anyone who computes the region')
      expect(html).not.toContain(SHALLOW_WARN)
    }
  })
})
