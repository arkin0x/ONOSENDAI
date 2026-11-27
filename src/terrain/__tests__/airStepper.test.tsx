/**
 * airStepper.test.tsx - the ghost block's distance under PLACE
 * (terrain/AirStepper.tsx): its slot is always there, hidden while no ghost
 * belongs, so nothing round it moves; while the ghost shows, − and + move it
 * a block nearer or farther, stopping at the ends; a tap on the number turns
 * air placing off (an eye struck through, − and + dimmed and dead) and the
 * next on again (owner, 2026-11-27); and the tools stand two by two on every
 * screen, the stepper under PLACE and SURVEY under SMASH.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { mount, settled, textOf, type Host } from '../../test/elementRoot'
import { AirStepper } from '../AirStepper'
import { useAirPlace } from '../../store/useAirPlace'
import { AIR_DEFAULT, AIR_MAX, AIR_MIN } from '../../lib/terrain/airPlace'
import { airPlacing, forgetAirSwitch, setAirPlacing } from '../../store/airSwitch'

const slotOf = (all: Host[]): Host => all.find((h) => String(h.props.className ?? '').includes('terrain-tools__slot--air'))!
const btn = (all: Host[], label: string): Host => all.find((h) => h.type === 'button' && h.props['aria-label'] === label)!
const tap = async (b: Host): Promise<void> => {
  ;(b.props.onPointerDown as (e: unknown) => void)({ preventDefault: () => {}, stopPropagation: () => {} })
  await settled()
}

afterEach(() => { useAirPlace.setState({ ghost: 'off', distance: AIR_DEFAULT }); setAirPlacing(true); forgetAirSwitch() })
const middle = (all: Host[]): Host => all.find((h) => h.type === 'button' && String(h.props.className) === 'terrain-air__value')!

describe('the ghost block\'s distance', () => {
  it('keeps its slot while the ghost is off, hidden, its buttons out of reach', async () => {
    useAirPlace.setState({ ghost: 'off', distance: AIR_DEFAULT })
    const m = await mount(createElement(AirStepper))
    const slot = slotOf(m.all())
    expect(slot).toBeTruthy()
    expect(String(slot.props.className)).toContain('is-off')
    expect(btn(m.all(), 'Nearer').props.disabled).toBe(true)
    expect(btn(m.all(), 'Farther').props.disabled).toBe(true)
    await m.unmount()
  })

  it('while the ghost shows, − and + move it a block at a time, and stop at the ends', async () => {
    useAirPlace.setState({ ghost: 'ok', distance: AIR_DEFAULT })
    const m = await mount(createElement(AirStepper))
    expect(String(slotOf(m.all()).props.className)).not.toContain('is-off')
    expect(m.says(String(AIR_DEFAULT))).toBe(true)
    await tap(btn(m.all(), 'Farther'))
    expect(useAirPlace.getState().distance).toBe(AIR_DEFAULT + 1)
    expect(m.says(String(AIR_DEFAULT + 1))).toBe(true)
    for (let i = 0; i < 10 && !btn(m.all(), 'Farther').props.disabled; i++) await tap(btn(m.all(), 'Farther'))
    expect(useAirPlace.getState().distance).toBe(AIR_MAX)
    expect(btn(m.all(), 'Farther').props.disabled).toBe(true)
    for (let i = 0; i < 10 && !btn(m.all(), 'Nearer').props.disabled; i++) await tap(btn(m.all(), 'Nearer'))
    expect(useAirPlace.getState().distance).toBe(AIR_MIN)
    expect(btn(m.all(), 'Nearer').props.disabled).toBe(true)
    await m.unmount()
  })

  it('keeps the wheel\'s hint out of the number\'s cell (a mouse there read as a zero: review of #949)', async () => {
    useAirPlace.setState({ ghost: 'ok', distance: 3 })
    const m = await mount(createElement(AirStepper))
    const value = middle(m.all())
    expect(textOf(value)).toBe('3')
    expect(value.children.every((c) => typeof c === 'string' || c.type === '#text')).toBe(true)
    const hint = m.all().find((h) => h.props.className === 'terrain-air__hint')!
    const frame = m.all().find((h) => String(h.props.className).startsWith('terrain-air '))
      ?? m.all().find((h) => h.props.className === 'terrain-air')!
    // Beside the frame, not inside it.
    expect(m.all().filter((h) => h === hint).length).toBe(1)
    const inFrame = (h: Host): boolean => h.children.some((c) => c === hint || (typeof c !== 'string' && inFrame(c)))
    expect(inFrame(frame)).toBe(false)
    // Under the frame (SURVEY stands beside it now), with H's printed key beside the wheel's.
    const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
    expect(css).toMatch(/\.terrain-air__hint \{\n  position: absolute;\n  left: 0;\n  top: calc\(100% \+ 6px\);/)
    expect(css).toContain('color: rgba(255, 255, 255, 0.6);')
    expect(textOf(hint)).toContain('WHEEL')
    expect(m.all().some((h) => h.type === 'kbd' && textOf(h) === 'H')).toBe(true)
    await m.unmount()
  })

  it('goes dim red with the ghost where a block cannot go, its hairlines too', async () => {
    expect(readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')).toContain('.terrain-air.is-bad .terrain-air__value { color: #ffb4b4; border-color: rgba(200, 100, 100, 0.45); }')
    useAirPlace.setState({ ghost: 'bad' })
    const m = await mount(createElement(AirStepper))
    expect(m.all().some((h) => String(h.props.className ?? '').includes('terrain-air is-bad'))).toBe(true)
    await m.unmount()
  })

  it('the tools stand two by two on every screen: PLACE and SMASH, the stepper under PLACE, SURVEY under SMASH', () => {
    const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
    expect(css).toContain('.terrain-tools { --tool-w: 86px; display: grid; grid-template-columns: var(--tool-w) var(--tool-w); grid-template-rows: 54px 38px; column-gap: 4px; row-gap: 4px; }')
    expect(css).toContain('.terrain-tools > .terrain-act--place { grid-column: 1; grid-row: 1; }')
    expect(css).toContain('.terrain-tools > .terrain-tools__slot--smash { grid-column: 2; grid-row: 1; height: 54px; }')
    expect(css).toContain('.terrain-tools > .terrain-tools__slot--air { grid-column: 1; grid-row: 2; height: 38px; }')
    expect(css).toContain('.terrain-tools > .terrain-tools__slot--survey { grid-column: 2; grid-row: 2; }')
    expect(css).toContain('.terrain-tools__slot--air.is-off { visibility: hidden; }')
    // No screen moves a tool out of the two by two any more (the stepper's old places left of SMASH and over PLACE).
    expect(css).not.toContain('right: calc(100% + 8px); height: 28px;')
    expect(css).not.toContain('bottom: calc(100% + 4px); left: 0; height: 28px;')
    expect(css).not.toContain('grid-template-rows: 54px 54px 38px')
    // A phone held upright: the same two by two, as tiles between the pad and JUMP, never wider than on a desktop.
    expect(css).toMatch(/--tool-w: clamp\(40px, calc\([^;]*\), 86px\);/)
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\) and \(max-height: 520px\) \{\s*\.terrain-air__hint \{ display: none; \}/)
  })

  it('a tap on the number turns air placing off: an eye struck through over the number, − and + dimmed and dead', async () => {
    useAirPlace.setState({ ghost: 'ok', distance: 4 })
    const m = await mount(createElement(AirStepper))
    expect(middle(m.all()).props['aria-pressed']).toBe(true)
    await tap(middle(m.all()))
    expect(airPlacing()).toBe(false)
    // The scene hides the ghost and says so (scene/TerrainLayer.tsx): the stepper stays, in its off state.
    useAirPlace.setState({ ghost: 'hidden' })
    await settled()
    expect(String(slotOf(m.all()).props.className)).not.toContain('is-off')
    expect(m.all().some((h) => String(h.props.className ?? '').includes('terrain-air is-paused'))).toBe(true)
    expect(middle(m.all()).props['aria-pressed']).toBe(false)
    expect(m.all().some((h) => h.props['data-icon'] === 'eye-off')).toBe(true)
    const struck = m.all().find((h) => h.type === 's')!
    expect(textOf(struck)).toBe('4')
    expect(btn(m.all(), 'Nearer').props.disabled).toBe(true)
    expect(btn(m.all(), 'Farther').props.disabled).toBe(true)
    // − and + do nothing while off, even pressed.
    await tap(btn(m.all(), 'Farther'))
    expect(useAirPlace.getState().distance).toBe(4)
    expect(airPlacing()).toBe(false)
    // The hint under it offers H to show it again, and no wheel (the wheel leaves the distance alone while off).
    const hint = m.all().find((h) => h.props.className === 'terrain-air__hint')!
    expect(textOf(hint)).not.toContain('WHEEL')
    expect(textOf(hint)).toContain('SHOW')
    // Tap again: on, as before.
    await tap(middle(m.all()))
    expect(airPlacing()).toBe(true)
    useAirPlace.setState({ ghost: 'ok' })
    await settled()
    expect(m.says('4')).toBe(true)
    expect(btn(m.all(), 'Farther').props.disabled).toBe(false)
    await m.unmount()
  })

  it('hidden with no ghost to show, on or off, its middle out of reach too', async () => {
    setAirPlacing(false)
    useAirPlace.setState({ ghost: 'off' })
    const m = await mount(createElement(AirStepper))
    expect(String(slotOf(m.all()).props.className)).toContain('is-off')
    expect(middle(m.all()).props.disabled).toBe(true)
    expect(middle(m.all()).props.tabIndex).toBe(-1)
    await m.unmount()
  })
})
