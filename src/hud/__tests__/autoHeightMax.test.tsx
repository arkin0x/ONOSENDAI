/**
 * The automatic hide height never goes past discovery's reach (owner,
 * 2026-11-14: a player's shards hidden at 13 were "missing" on his laptop and
 * still on his phone). The deploy bar fits the height to hold the whole model
 * (lib/deployFit.ts); a model across a big region edge used to be fitted to 13
 * or more without anyone choosing it, where no scan finds it, not even the
 * hider's own other devices. Now the fit stops at SCAN_MAX_HEIGHT and the
 * height stays there; + still goes higher, under the past-height warning.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SCAN_MAX_HEIGHT } from '../../store/useShards'
import { autoHeightMax } from '../../lib/shallowBag'
import { fitHeight } from '../../lib/deployFit'
import type { Position } from '../../lib/space'
import { FitNote, HeightWarnings, autoFitHeight } from '../DeployBar'

const BAR = readFileSync(join(__dirname, '..', 'DeployBar.tsx'), 'utf8')

/** A model about four gibsons in reach at unit 0 (vertices in model units). */
const small = { vertices: [[0, 0, 0], [2, 0, 0], [0, 2, 0], [2, 2, 2]].map((p) => ({ p: p as [number, number, number], c: [1, 1, 1] as [number, number, number] })), parts: undefined }

/** Centred in every cube up to 2^12 along an axis. */
const MID = (1n << 20n) + (1n << 11n)
/** One gibson past 12,288: a 2^12 boundary that is not a 2^13 one, so a model across it fits only at 13. */
const ACROSS: Position = { x: 3n * 4096n + 1n, y: MID, z: MID }
/** Well inside small cubes: the model fits low. */
const INSIDE: Position = { x: MID + 4n, y: MID, z: MID }

const fit = (cursor: Position, ceiling: number): number | null =>
  autoFitHeight({ shard: small, wearsLook: false, fitShape: null, unit: 0, cursor, step: 0, aimed: [], seedFit: null, autoMax: autoHeightMax(ceiling) })

describe('autoHeightMax', () => {
  it('is discovery’s reach on a device that computes past it, and the device’s own ceiling below it', () => {
    expect(autoHeightMax(SCAN_MAX_HEIGHT + 8)).toBe(SCAN_MAX_HEIGHT)
    expect(autoHeightMax(SCAN_MAX_HEIGHT)).toBe(SCAN_MAX_HEIGHT)
    expect(autoHeightMax(10)).toBe(10)
  })
})

describe('the automatic height of a shard', () => {
  it('across a 2^12 edge: the fit used to pick 13; now nothing up to 12 is offered and the height stays at 12', () => {
    // The old fit, up to the device ceiling: past discovery.
    expect(fitHeight(small, 0, ACROSS, 0, 0, SCAN_MAX_HEIGHT + 8)).toBe(SCAN_MAX_HEIGHT + 1)
    expect(fit(ACROSS, SCAN_MAX_HEIGHT + 8)).toBeNull()
    // And the bar's effect falls back to autoMax, never to the ceiling.
    expect(BAR).toContain('const want = fitH ?? autoMax')
    expect(BAR).not.toContain('fitH ?? ceiling')
  })

  it('inside small cubes: unchanged, the smallest height that holds it', () => {
    const h = fit(INSIDE, SCAN_MAX_HEIGHT + 8)
    expect(h).toBe(fitHeight(small, 0, INSIDE, 0, 0, SCAN_MAX_HEIGHT + 8))
    expect(h).not.toBeNull()
    expect(h!).toBeLessThanOrEqual(SCAN_MAX_HEIGHT)
  })

  it('every fit in the bar is bounded by autoMax, none by the ceiling', () => {
    expect(BAR).toMatch(/autoFitHeight\(\{[^}]*autoMax \}\)/)
    expect(BAR).toContain('seedDraftHeight(pending.seed.fit, cursor, plane, step, autoMax)')
    expect(BAR).not.toMatch(/fitHeight(All)?\([^)]*ceiling\)/)
  })
})

describe('what the bar says', () => {
  it('the fit note says the height stopped and that + goes higher, past every scan', () => {
    const html = renderToStaticMarkup(<FitNote cause="edge" autoMax={SCAN_MAX_HEIGHT} ceiling={SCAN_MAX_HEIGHT + 8} />)
    expect(html).toContain('Sits across a region edge, so part of it will be cut off; move it to fit.')
    expect(html).toContain('Press + to hide it higher')
    expect(html).toContain('not even on your other devices')
    const size = renderToStaticMarkup(<FitNote cause="size" autoMax={SCAN_MAX_HEIGHT} ceiling={SCAN_MAX_HEIGHT + 8} />)
    expect(size.replace(/<!-- -->/g, '')).toContain(`larger than any region up to 2^${SCAN_MAX_HEIGHT};`)
  })

  it('offers no + where the device cannot go higher', () => {
    const html = renderToStaticMarkup(<FitNote cause="edge" autoMax={10} ceiling={10} />)
    expect(html).not.toContain('Press +')
  })

  it('the past-height warning says your other devices will not find it either', () => {
    const html = renderToStaticMarkup(<HeightWarnings height={SCAN_MAX_HEIGHT + 1} intoChest={false} localMax={SCAN_MAX_HEIGHT + 8} />)
    expect(html).toContain(`Past height ${SCAN_MAX_HEIGHT}`)
    expect(html).toContain('not even on your other devices')
  })
})
