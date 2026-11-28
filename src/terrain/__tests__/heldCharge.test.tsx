/**
 * heldCharge.test.tsx - the Quarry Charge in hand is held where a carried
 * block is (owner, 2026-11-28: "the quarry charge should be held in the
 * bottom right like the blocks are"; terrain/HeldCharge.tsx): in the carried
 * block's own box (.terrain-held), its canvas centred on that box, the model
 * fitted to the block's footprint and tilted toward you as the block is, with
 * the block's sway and dip.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'

vi.mock('@react-three/fiber', () => ({
  Canvas: () => null,
  useThree: () => () => {},
  useFrame: () => {},
}))
vi.mock('../../scene/ShardMesh', () => ({ ShardMesh: () => null }))
vi.mock('../../scene/shardLight', () => ({ ShardLights: () => null }))
vi.mock('../../lib/blueprint/quarryModel', () => ({
  QUARRY_BOX: { min: [-2.08, -3, -2.32], max: [2.08, 3.6, 1.61] },
  quarryArmedModel: async () => null,
  useQuarryModel: () => ({ shards: [] }),
}))

import { mount, type Host } from '../../test/elementRoot'
import { HELD_SHARE, HeldCharge, TILT, TURN, VIEW_SHARE, heldChargeFit } from '../HeldCharge'
import { useTerrain } from '../../store/useTerrain'

const CSS = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
const BOX = { min: [-2.08, -3, -2.32], max: [2.08, 3.6, 1.61] }
const classes = (h: Host): string[] => String(h.props.className ?? '').split(' ')
const byClass = (all: Host[], name: string): Host | undefined => all.find((h) => classes(h).includes(name))

/** The declarations of the first rule whose selector is exactly `sel`. */
function rule(sel: string): string {
  const at = CSS.indexOf(`\n${sel} {`)
  expect(at, sel).toBeGreaterThan(-1)
  return CSS.slice(at, CSS.indexOf('}', at))
}

describe('the charge in hand', () => {
  it('is drawn in the carried block\'s own box, with its walk and its dip, never a whole-screen canvas', async () => {
    useTerrain.setState({ inventory: { ...useTerrain.getState().inventory, charges: 3 } })
    const m = await mount(createElement(HeldCharge, { shown: true }))
    const all = m.all()
    const outer = byClass(all, 'terrain-held')!
    expect(outer).toBeTruthy()
    expect(classes(outer)).toContain('terrain-held--charge')
    expect(outer.props['aria-hidden']).toBeTruthy()
    expect(outer.props.style).toBeUndefined()
    expect(byClass(all, 'terrain-held-charge__view')).toBeTruthy()
    // None left: hidden in its place, the canvas kept.
    useTerrain.setState({ inventory: { ...useTerrain.getState().inventory, charges: 0 } })
    await new Promise((r) => setTimeout(r, 0))
    const after = byClass(m.all(), 'terrain-held')!
    expect(after.props.style).toEqual({ visibility: 'hidden' })
    await m.unmount()
  })

  it('dips when one is placed, on the block\'s dip, and starts it again on the next without making the canvas again', async () => {
    useTerrain.setState({ inventory: { ...useTerrain.getState().inventory, charges: 5 } })
    const m = await mount(createElement(HeldCharge, { shown: true }))
    const dip = (): Host => byClass(m.all(), 'terrain-held-charge__dip')!
    const view = byClass(m.all(), 'terrain-held-charge__view')
    expect(classes(dip())).not.toContain('is-dip-a')
    useTerrain.setState({ inventory: { ...useTerrain.getState().inventory, charges: 4 } })
    await new Promise((r) => setTimeout(r, 0))
    expect(classes(dip())).toContain('is-dip-a')
    useTerrain.setState({ inventory: { ...useTerrain.getState().inventory, charges: 3 } })
    await new Promise((r) => setTimeout(r, 0))
    expect(classes(dip())).toContain('is-dip-b')
    // The same element: the canvas was not made again.
    expect(byClass(m.all(), 'terrain-held-charge__view')).toBe(view)
    await m.unmount()
  })

  it('its canvas is centred on the block\'s box, VIEW_SHARE boxes across, and moves as the block does', () => {
    const view = rule('.terrain-held-charge__view')
    expect(view).toContain(`width: ${Math.round(VIEW_SHARE * 100)}%;`)
    expect(view).toContain(`height: ${Math.round(VIEW_SHARE * 100)}%;`)
    expect(view).toContain('left: 50%;')
    expect(view).toContain('top: 50%;')
    expect(view).toContain('transform: translate(-50%, -50%);')
    // The block's dip (the same keyframes, and a twin with the same steps), and its walk's 900 ms sway.
    expect(CSS).toContain('.terrain-held-charge__dip.is-dip-a { animation: terrain-held-dip 220ms ease-out; }')
    expect(CSS).toContain('@keyframes terrain-held-dip { 40% { transform: translateY(14px) rotate(-8deg); } }')
    expect(CSS).toContain('@keyframes terrain-held-charge-dip { 40% { transform: translateY(14px) rotate(-8deg); } }')
    expect(CSS).toContain('.terrain-held.is-walking .terrain-held-charge__sway { animation: terrain-held-charge-sway 900ms ease-in-out infinite alternate; }')
    expect(CSS).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.terrain-held\.is-walking \.terrain-held-charge__sway,/)
    // The old whole-screen canvas is gone.
    expect(CSS).not.toContain('\n.terrain-held-charge {')
  })

  it('the model fits the block\'s footprint: its middle at the box\'s middle, its tallest or widest reach HELD_SHARE of the box', () => {
    const fit = heldChargeFit(BOX)
    expect(fit.centre[0]).toBeCloseTo(0)
    expect(fit.centre[1]).toBeCloseTo(0.3)
    expect(fit.centre[2]).toBeCloseTo((1.61 - 2.32) / 2)
    // The canvas at the model's depth, in units, and one carried-block box of it.
    const across = 2 * fit.depth * Math.tan((40 * Math.PI) / 360)
    const boxUnits = across / VIEW_SHARE
    const tall = (6.6 * Math.cos(TILT) + 3.93 * Math.sin(Math.abs(TILT))) * fit.scale
    const wide = (4.16 * Math.cos(TURN) + 3.93 * Math.sin(Math.abs(TURN))) * fit.scale
    expect(Math.max(tall, wide) / boxUnits).toBeCloseTo(HELD_SHARE, 6)
    // An item in hand: about the tilted block's reach, inside its canvas.
    expect(HELD_SHARE).toBeGreaterThan(1)
    expect(HELD_SHARE).toBeLessThan(VIEW_SHARE)
    // Tilted toward you and turned, as the block is (about 20 and 36 degrees).
    expect(TILT * 180 / Math.PI).toBeGreaterThan(15)
    expect(TILT * 180 / Math.PI).toBeLessThan(25)
    expect(Math.abs(TURN) * 180 / Math.PI).toBeGreaterThan(30)
    expect(Math.abs(TURN) * 180 / Math.PI).toBeLessThan(40)
  })
})
