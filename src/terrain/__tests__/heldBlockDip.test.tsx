/**
 * heldBlockDip.test.tsx - the carried block dips when what you carry changes
 * (terrain/TerrainView.tsx HeldBlock), without the cube being made again on
 * every change, and at most once each DIP_MS (review of #977: a stream of
 * Quarry drops changes the counts every few frames), so each dip plays out.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { mount, type Host } from '../../test/elementRoot'
import { DIP_MS, HeldBlock } from '../TerrainView'
import { useTerrain } from '../../store/useTerrain'
import { emptyInventory } from '../../lib/terrain/terrainDb'

const classes = (h: Host): string[] => String(h.props.className ?? '').split(' ')
const byClass = (all: Host[], name: string): Host | undefined => all.find((h) => classes(h).includes(name))
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))
const carry = (n: number): void => {
  const inv = useTerrain.getState().inventory
  useTerrain.setState({ inventory: { ...inv, counts: { ...inv.counts, 1: n } } })
}

describe('the carried block\'s dip', () => {
  it('starts again on the next change without the cube being made again, and at most once each DIP_MS', async () => {
    useTerrain.setState({ inventory: { ...emptyInventory(), counts: { 1: 10 }, hotbar: [1, 0, 0, 0, 0, 0, 0, 0, 0], slot: 0 } })
    const m = await mount(createElement(HeldBlock))
    const dip = (): Host => byClass(m.all(), 'terrain-held__dip')!
    const cube = byClass(m.all(), 'terrain-held__cube')
    expect(cube).toBeTruthy()
    expect(classes(dip())).not.toContain('is-dipping')
    carry(11)
    await tick()
    expect(classes(dip())).toContain('is-dipping')
    // A stream of changes inside the dip: let pass, the dip plays out.
    for (let n = 12; n < 20; n++) { carry(n); await tick() }
    expect(classes(dip())).toContain('is-dipping')
    expect(classes(dip())).not.toContain('is-dipping-b')
    // Once it has played out, the next change dips again, under its other name.
    await tick(DIP_MS + 20)
    carry(21)
    await tick()
    expect(classes(dip())).toContain('is-dipping-b')
    // The same cube throughout: never made again.
    expect(byClass(m.all(), 'terrain-held__cube')).toBe(cube)
    await m.unmount()
  })
})
