/**
 * droneRunScreen.test.tsx - EXIT GAME on the game bar (game/droneRun/
 * DroneRunScreen.tsx) has the same press sound as EXIT GAME on a card, and
 * leaves the game. The canvas, the HUD and the session are stood in.
 */

import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  clicks: [] as string[],
  state: {
    session: { game: { name: 'DRONE RUN' }, world: null, entry: null, level: null, worldError: null },
    busy: null as string | null,
    message: null as string | null,
    exit: vi.fn(async () => null),
    hide: vi.fn(),
  },
}))
vi.mock('../Canvas3D', () => ({ Canvas3D: () => null }))
vi.mock('../hud/DroneRunHud', () => ({ DroneRunHudMount: () => null }))
vi.mock('../clicks', () => ({ playClick: (c: string) => { h.clicks.push(c); return true } }))
vi.mock('../../../store/useGame', () => ({
  useGame: Object.assign(<T,>(sel: (s: typeof h.state) => T) => sel(h.state), { getState: () => h.state }),
}))

import { createElement } from 'react'
import { mount } from '../../../test/elementRoot'
import { DroneRunScreen } from '../DroneRunScreen'

describe('the game bar', () => {
  it('EXIT GAME plays the exit press sound and leaves', async () => {
    const m = await mount(createElement(DroneRunScreen))
    const exit = m.all().find((x) => String(x.props.className ?? '') === 'gameview__exit')!
    ;(exit.props.onClick as (e: unknown) => void)({ currentTarget: { blur() {} } })
    await new Promise((r) => setTimeout(r, 5))
    expect(h.clicks).toEqual(['ui:exit'])
    expect(h.state.exit).toHaveBeenCalledTimes(1)
    await m.unmount()
  })
})
