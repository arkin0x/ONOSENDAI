/**
 * terrainWheel.test.ts - in TERRAIN the wheel chooses the hotbar slot (owner,
 * 2026-11-24: "can the scroll wheel change the hotbar selection?"): down the
 * next, up the one before, round the nine, over the scene only; and the
 * chosen slot is clearly green ("can the selected item be more green").
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useTerrain } from '../../store/useTerrain'
import { WHEEL_STEP, terrainWheel } from '../TerrainView'

class FakeCanvas extends EventTarget {
  tagName = 'CANVAS'
  closest(): null { return null }
}
class FakePanel extends EventTarget {
  tagName = 'DIV'
  closest(): null { return null }
}

function wheel(on: EventTarget, deltaY: number, deltaMode = 0): void {
  const e = new Event('wheel')
  Object.assign(e, { deltaY, deltaMode })
  on.dispatchEvent(e)
}

const slot = (): number => useTerrain.getState().inventory.slot
let stop: () => void = () => {}

beforeEach(() => {
  const inv = useTerrain.getState().inventory
  useTerrain.setState({ sheet: false, inventory: { ...inv, slot: 0 } })
})
afterEach(() => stop())

describe('the wheel in TERRAIN', () => {
  it('down chooses the next slot, up the one before, round the nine; small scrolls add up', () => {
    const canvas = new FakeCanvas()
    stop = terrainWheel(canvas)
    wheel(canvas, 100)
    expect(slot()).toBe(1)
    wheel(canvas, -100)
    expect(slot()).toBe(0)
    wheel(canvas, -100)
    expect(slot()).toBe(useTerrain.getState().inventory.hotbar.length - 1)
    wheel(canvas, 100)
    expect(slot()).toBe(0)
    // A trackpad's small deltas: nothing until they add up to a step.
    wheel(canvas, WHEEL_STEP / 2)
    expect(slot()).toBe(0)
    wheel(canvas, WHEEL_STEP / 2)
    expect(slot()).toBe(1)
    // A wheel that counts in lines.
    wheel(canvas, 3, 1)
    expect(slot()).toBe(2)
  })

  it('over a menu or a panel does nothing: it scrolls there as ever', () => {
    const panel = new FakePanel()
    stop = terrainWheel(panel)
    wheel(panel, 300)
    expect(slot()).toBe(0)
  })
})

describe('the chosen slot', () => {
  it('is clearly green: mint over its ground at about a third, a brighter mint edge, its number in mint', () => {
    const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
    expect(css).toContain('.terrain-slot.is-on::before { background: linear-gradient(rgba(124, 255, 196, 0.36), rgba(124, 255, 196, 0.36)), var(--terrain-fill); }')
    expect(css).toContain('.terrain-slot.is-on { --terrain-line: #b8ffe1; }')
    expect(css).toContain('.terrain-slot.is-on .terrain-slot__num { color: var(--terrain); opacity: 1; font-weight: 700; }')
  })
})
