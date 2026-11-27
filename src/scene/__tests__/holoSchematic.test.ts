/**
 * holoSchematic.test.ts: a blueprint card in the world (DECK-0010 §7.3) is
 * drawn in cyberspace's own axes, whichever way the view is turned (§3.1),
 * with its shape fitted inside its cube: hidden cells grey smoke, revealed
 * ones in their block's colour.
 */
import { describe, expect, it } from 'vitest'
import { MODEL_FILL, schematicCells, toRender } from '../HoloSchematic'
import { blockKind } from '../../lib/terrain/blocks'
import type { ViewAxes } from '../../lib/space'
import type { FinderView } from '../../lib/blueprint/format'

const PLAIN: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } as ViewAxes
const TURNED: ViewAxes = { right: { axis: 'z', dir: -1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'x', dir: 1 } } as ViewAxes

describe('the holo schematic', () => {
  it('maps cyberspace axes into the render frame the way the view does', () => {
    expect(toRender(PLAIN, [1, 2, 3])).toEqual([1, 2, 3])
    // Turned a quarter: X goes out of the screen, Z to the left; Y stays up.
    expect(toRender(TURNED, [1, 2, 3])).toEqual([-3, 2, 1])
  })

  it('fits the box inside the cube, hidden cells as smoke and revealed ones in their colour', () => {
    // A 2 x 1 x 1 box: one hidden cell, one revealed Ferrovein.
    const view: FinderView = { size: [2, 1, 1], occupied: [true, true], revealed: new Map([[1, 40]]) }
    const c = schematicCells(view)
    expect(c.k).toBeCloseTo(MODEL_FILL / 2)
    expect(c.smoke).toHaveLength(1)
    expect(c.solid).toHaveLength(1)
    expect(c.solid[0].color).toBe(blockKind(40)!.color)
    // Centred: the two cells sit either side of the cube's centre along X.
    expect(c.smoke[0][0]).toBeCloseTo(-c.k / 2)
    expect(c.solid[0].at[0]).toBeCloseTo(c.k / 2)
    for (const p of [...c.smoke, ...c.solid.map((s) => s.at)]) for (const v of p) expect(Math.abs(v)).toBeLessThan(0.5)
  })
})

describe('the marker in the rulebook (#945)', () => {
  it('corner brackets round a 0.84 box: three arms at each of the eight corners, none longer than its share', async () => {
    const { bracketSegments, BRACKET_BOX } = await import('../HoloSchematic')
    const s = bracketSegments(BRACKET_BOX)
    expect(BRACKET_BOX).toBe(0.84)
    expect(s.length).toBe(8 * 3 * 6)
    for (let i = 0; i < s.length; i += 6) {
      const d = Math.hypot(s[i + 3] - s[i], s[i + 4] - s[i + 1], s[i + 5] - s[i + 2])
      expect(d).toBeCloseTo(BRACKET_BOX * 0.22)
      for (let k = 0; k < 3; k++) expect(Math.abs(s[i + k])).toBeCloseTo(BRACKET_BOX / 2)
    }
  })

  it('each revealed block keeps its colour and its own edge colour', () => {
    const view = { size: [2, 1, 1] as const, occupied: [true, true], revealed: new Map([[0, 1], [1, 5]]) }
    const c = schematicCells(view)
    expect(c.solid.map((s) => [s.color, s.edge])).toEqual([['#555e60', '#80898c'], ['#943300', '#f47000']])
  })

  it('a blueprint card opened is read like a letter, an item or a sound', async () => {
    const { opensAsHidden } = await import('../../hooks/useHiddenState')
    expect(opensAsHidden('blueprint')).toBe(true)
  })
})
