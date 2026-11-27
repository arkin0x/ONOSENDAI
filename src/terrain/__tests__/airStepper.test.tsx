/**
 * airStepper.test.tsx - the ghost block's distance beside PLACE
 * (terrain/AirStepper.tsx): its slot is always there, hidden while the ghost
 * is off, so nothing round it moves; while the ghost shows, − and + move it
 * a block nearer or farther, stopping at the ends; and the tools keep the
 * stepper's slot in their grid on every screen.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { mount, settled, type Host } from '../../test/elementRoot'
import { AirStepper } from '../AirStepper'
import { useAirPlace } from '../../store/useAirPlace'
import { AIR_DEFAULT, AIR_MAX, AIR_MIN } from '../../lib/terrain/airPlace'

const slotOf = (all: Host[]): Host => all.find((h) => String(h.props.className ?? '').includes('terrain-tools__slot--air'))!
const btn = (all: Host[], label: string): Host => all.find((h) => h.type === 'button' && h.props['aria-label'] === label)!
const tap = async (b: Host): Promise<void> => {
  ;(b.props.onPointerDown as (e: unknown) => void)({ preventDefault: () => {}, stopPropagation: () => {} })
  await settled()
}

afterEach(() => useAirPlace.setState({ ghost: 'off', distance: AIR_DEFAULT }))

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

  it('goes dim red with the ghost where a block cannot go', async () => {
    useAirPlace.setState({ ghost: 'bad' })
    const m = await mount(createElement(AirStepper))
    expect(m.all().some((h) => String(h.props.className ?? '').includes('terrain-air is-bad'))).toBe(true)
    await m.unmount()
  })

  it('has a slot of its own in the tools\' grid on every screen, so PLACE, SMASH and SURVEY keep theirs', () => {
    const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
    expect(css).toContain('.terrain-tools > .terrain-tools__slot--air { grid-column: 2; grid-row: 2; height: 38px; }')
    expect(css).toContain('.terrain-tools__slot--air.is-off { visibility: hidden; }')
    expect(css).toContain('.terrain-tools > .terrain-tools__slot--air { position: absolute; grid-area: auto; top: 0; right: calc(100% + 8px); height: 28px; }')
  })
})
