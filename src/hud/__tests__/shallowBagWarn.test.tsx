/**
 * The shallow bag warning (arkinox, 2026-10-19: "i think when hiding a bag we
 * need a clear warning if the depth is <13"). Discovery opens heights 0 to
 * SCAN_MAX_HEIGHT wherever a view stands, so a bag hidden there opens for
 * spectators and Cyberspace TV. The line shows through SCAN_MAX_HEIGHT and is
 * gone one height above it, where the past-height warning takes over.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SCAN_MAX_HEIGHT } from '../../store/useShards'
import { SHALLOW_EXPLAIN, SHALLOW_WARN, ShallowWarn, shallowBag } from '../DeployBar'

const BAR = readFileSync(join(__dirname, '..', 'DeployBar.tsx'), 'utf8')

describe('shallowBag', () => {
  it('is every height discovery opens, and none past it', () => {
    expect(shallowBag(0)).toBe(true)
    expect(shallowBag(SCAN_MAX_HEIGHT)).toBe(true)
    expect(shallowBag(SCAN_MAX_HEIGHT + 1)).toBe(false)
  })
})

describe('ShallowWarn', () => {
  it('shows at SCAN_MAX_HEIGHT, its explanation the tooltip', () => {
    const html = renderToStaticMarkup(<ShallowWarn height={SCAN_MAX_HEIGHT} />)
    expect(html).toContain('deploybar__shallow')
    expect(html).toContain(SHALLOW_WARN)
    expect(html).toContain(`title="${SHALLOW_EXPLAIN}"`)
  })

  it('is gone at SCAN_MAX_HEIGHT + 1', () => {
    expect(renderToStaticMarkup(<ShallowWarn height={SCAN_MAX_HEIGHT + 1} />)).toBe('')
  })

  it('says height, as the row it warns about does, with the numbers from SCAN_MAX_HEIGHT', () => {
    expect(SHALLOW_EXPLAIN).toContain(`height ${SCAN_MAX_HEIGHT} or less`)
    expect(SHALLOW_EXPLAIN).toContain(`height ${SCAN_MAX_HEIGHT + 1} or more`)
    expect(SHALLOW_EXPLAIN.toLowerCase()).not.toContain('depth')
    expect(BAR).toContain('label="HIDE AT HEIGHT"')
  })
})

describe('the deploy bar source', () => {
  it('draws the warning from the live height for every hide, not for an aim', () => {
    expect(BAR).toContain('{!intoChest && <ShallowWarn height={height} />}')
  })

  it('keeps the threshold out of the code as a literal', () => {
    const src = BAR.slice(BAR.indexOf('export function shallowBag'), BAR.indexOf('export function DeployBar'))
    expect(src).not.toMatch(/\b1[23]\b/)
  })
})
