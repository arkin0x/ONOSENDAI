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
