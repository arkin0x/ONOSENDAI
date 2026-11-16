/**
 * hud.test.tsx - DRONE RUN's HUD (game/droneRun/hud): every phase draws the
 * same fixed slots, so nothing moves between them (owner: no layout jumps);
 * the cards' buttons call RESTART, NEXT WAVE and EXIT GAME, and Enter or R
 * press the first; each gun shows its own gauge; the phone's buttons write
 * the controls; the run's events play their sounds and restart the pulses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
vi.mock('../../../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/relay')>()),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  queryEach: vi.fn(async () => []),
}))
const played: Array<[string, number]> = []
vi.mock('../../audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../audio')>()),
  playSound: (s: string, w = 0) => { played.push([s, w]); return true },
  warmSound: () => {},
}))

import { createElement } from 'react'
import { mount, textOf, type Host } from '../../../../test/elementRoot'
import { HudView, type HudViewProps } from '../HudView'
import { DroneRunHud, reactTo } from '../DroneRunHud'
import { TouchPad } from '../TouchPad'
import { BASE_WEAPONS, COPY, IDLE_HUD, weaponsOfHud, type HudState } from '../model'
import { readInput, resetInput } from '../../input'
import type { RunEvent } from '../../../../lib/games/droneRun/sim/events'

const PHASES: HudState['phase'][] = ['safe', 'wave', 'cleared', 'failed']

function props(over: Partial<HudState> = {}, more: Partial<HudViewProps> = {}): HudViewProps {
  return {
    hud: { ...IDLE_HUD, ...over },
    weapons: BASE_WEAPONS,
    touch: false,
    locked: true,
    muted: false,
    exiting: false,
    pulses: { hurt: 0, hit: 0 },
    onRestart: vi.fn(),
    onNextWave: vi.fn(),
    onExit: vi.fn(),
    onToggleSound: vi.fn(),
    ...more,
  }
}

const cls = (h: Host): string => String(h.props.className ?? '')
/** The fixed slots: every element whose class is one of these, as a sorted list of class names. */
const SLOTS = ['drun-top', 'drun-pips', 'drun-wave', 'drun-left', 'drun-clock', 'drun-sound', 'drun-prompt', 'drun-prompt__title', 'drun-prompt__line', 'drun-cross', 'drun-bottom', 'drun-gun', 'drun-gun__name', 'drun-gauge', 'drun-gauge__status', 'drun-hints', 'drun-stick', 'drun-btn']
function slots(all: Host[]): string[] {
  return all.flatMap((h) => cls(h).split(' ').filter((c) => SLOTS.includes(c) || c.startsWith('drun-btn--'))).sort()
}

beforeEach(() => { resetInput(0, 0); played.length = 0 })
afterEach(() => { vi.restoreAllMocks() })

describe('the HUD keeps its slots in every phase', () => {
  for (const touch of [false, true]) {
    it(`${touch ? 'phone' : 'desktop'}: the same boxes in safe, wave, cleared and failed`, async () => {
      const seen: string[][] = []
      for (const phase of PHASES) {
        const m = await mount(createElement('div', null, createElement(HudView, props({ phase, hp: phase === 'failed' ? 0 : 2 })), touch ? createElement(TouchPad, { hud: { ...IDLE_HUD, phase }, weapons: BASE_WEAPONS, baseRef: { current: null }, knobRef: { current: null } }) : null))
        seen.push(slots(m.all()))
        await m.unmount()
      }
      for (const s of seen) expect(s).toEqual(seen[0])
      expect(seen[0].length).toBeGreaterThan(10)
    })
  }

  it('the safe zone says how to start, and the line is kept empty in the other phases', async () => {
    const safe = await mount(createElement(HudView, props({ phase: 'safe', waveName: 'FIRST CONTACT' })))
    expect(safe.says(COPY.safePrompt)).toBe(true)
    expect(safe.says('WAVE 1  FIRST CONTACT')).toBe(true)
    await safe.unmount()
    const wave = await mount(createElement(HudView, props({ phase: 'wave' })))
    expect(wave.says(COPY.safePrompt)).toBe(false)
    expect(wave.all().some((h) => cls(h) === 'drun-prompt')).toBe(true)
    await wave.unmount()
  })

  it('HP pips: filled for what is left, blinking while you cannot be hit', async () => {
    const m = await mount(createElement(HudView, props({ hp: 1, maxHp: 3, invulnerable: true })))
    const pips = m.all().filter((h) => cls(h).includes('drun-pip '))
    expect(pips.map((h) => cls(h).includes('is-full'))).toEqual([true, false, false])
    expect(m.all().some((h) => cls(h).includes('drun-pips is-blinking'))).toBe(true)
    await m.unmount()
  })

  it('WAVE n / total, drones left and the clock', async () => {
    const m = await mount(createElement(HudView, props({ phase: 'wave', wave: 2, wavesTotal: 3, dronesLeft: 7, runTime: 12.3 })))
    expect(m.says('WAVE 2 / 3')).toBe(true)
    expect(textOf(m.all().find((h) => cls(h) === 'drun-left')!)).toBe('7')
    expect(m.says('0:12.3')).toBe(true)
    await m.unmount()
  })
})

describe('the gauge follows the gun in hand', () => {
  it('heat (OVERHEAT when locked), a magazine (RELOADING), a charge', async () => {
    const hot = await mount(createElement(HudView, props({ weapon: 0, heat: 1, overheated: true })))
    expect(hot.says(COPY.overheat)).toBe(true)
    expect(hot.all().some((h) => cls(h).includes('drun-gauge--heat is-hot'))).toBe(true)
    await hot.unmount()
    const mag = await mount(createElement(HudView, props({ weapon: 1, ammo: 4, mag: 6 })))
    expect(mag.says('4 / 6')).toBe(true)
    await mag.unmount()
    const rel = await mount(createElement(HudView, props({ weapon: 1, ammo: 0, mag: 6, reloading: true })))
    expect(rel.says(COPY.reloading)).toBe(true)
    await rel.unmount()
    const rail = await mount(createElement(HudView, props({ weapon: 2, charge: 0.5 })))
    expect(rail.all().some((h) => cls(h).startsWith('drun-gauge drun-gauge--charge'))).toBe(true)
    expect(rail.says('CHARGE RAIL')).toBe(true)
    await rail.unmount()
  })

  it('the runner\'s lists name the guns and their gauges', () => {
    const w = weaponsOfHud({ weaponNames: ['A', 'B', 'C'], weaponKinds: ['heat', 'ammo', 'heat'], weaponCharges: [false, false, true] })
    expect(w.map((x) => [x.gauge, x.heats])).toEqual([['heat', true], ['ammo', false], ['charge', true]])
    expect(weaponsOfHud({ weaponNames: [], weaponKinds: [], weaponCharges: [] })).toBe(BASE_WEAPONS)
  })

  it('desktop: printed hints, full in the safe zone, folded in a wave; CLICK AIM before the lock', async () => {
    const safe = await mount(createElement(HudView, props({ phase: 'safe' })))
    expect(safe.says('WASD')).toBe(true)
    expect(safe.says('RELOAD')).toBe(true)
    await safe.unmount()
    const wave = await mount(createElement(HudView, props({ phase: 'wave' }, { locked: false })))
    expect(wave.says('WASD')).toBe(false)
    expect(wave.says('CLICKAIM')).toBe(true)
    expect(wave.says('1 2 3GUNS')).toBe(true)
    await wave.unmount()
  })
})

describe('the cards', () => {
  it('RUN FAILED: RESTART and EXIT GAME', async () => {
    const p = props({ phase: 'failed', hp: 0 })
    const m = await mount(createElement(HudView, p))
    expect(m.says(COPY.failed)).toBe(true)
    await m.press(COPY.restart)
    expect(p.onRestart).toHaveBeenCalledTimes(1)
    await m.press(COPY.exit)
    expect(p.onExit).toHaveBeenCalledTimes(1)
    await m.unmount()
  })

  it('WAVE n CLEAR: the time, the drones downed, NEXT WAVE and EXIT GAME', async () => {
    const p = props({ phase: 'cleared', wave: 1, runTime: 31.4, kills: 9 })
    const m = await mount(createElement(HudView, p))
    expect(m.says('WAVE 1 CLEAR')).toBe(true)
    expect(m.says('0:31.4')).toBe(true)
    expect(m.says(`${COPY.downed} 9`)).toBe(true)
    await m.press(COPY.nextWave)
    expect(p.onNextWave).toHaveBeenCalledTimes(1)
    await m.press(COPY.exit)
    expect(p.onExit).toHaveBeenCalledTimes(1)
    await m.unmount()
  })

  it('no card in the safe zone or a wave', async () => {
    for (const phase of ['safe', 'wave'] as const) {
      const m = await mount(createElement(HudView, props({ phase })))
      expect(m.buttons(COPY.restart).length + m.buttons(COPY.nextWave).length).toBe(0)
      await m.unmount()
    }
  })

  it('Enter or R press the card\'s first button; nothing while no card is up', async () => {
    const keys = new EventTarget()
    const win = globalThis as unknown as Record<string, unknown>
    const had = { add: win.addEventListener, remove: win.removeEventListener }
    win.addEventListener = (t: string, f: EventListener) => keys.addEventListener(t, f)
    win.removeEventListener = (t: string, f: EventListener) => keys.removeEventListener(t, f)
    const press = (code: string): void => { const e = new Event('keydown'); Object.assign(e, { code }); keys.dispatchEvent(e) }
    const restart = vi.fn(), nextWave = vi.fn()
    const sub = (): (() => void) => () => {}
    const failed = await mount(createElement(DroneRunHud, { hud: { ...IDLE_HUD, phase: 'failed', hp: 0 }, restart, nextWave, subscribe: sub, exit: vi.fn(), touch: false }))
    press('KeyR')
    press('Enter')
    expect(restart).toHaveBeenCalledTimes(2)
    await failed.unmount()
    const cleared = await mount(createElement(DroneRunHud, { hud: { ...IDLE_HUD, phase: 'cleared' }, restart, nextWave, subscribe: sub, exit: vi.fn(), touch: false }))
    press('Enter')
    expect(nextWave).toHaveBeenCalledTimes(1)
    await cleared.unmount()
    const wave = await mount(createElement(DroneRunHud, { hud: { ...IDLE_HUD, phase: 'wave' }, restart, nextWave, subscribe: sub, exit: vi.fn(), touch: false }))
    press('Enter')
    expect(restart).toHaveBeenCalledTimes(2)
    expect(nextWave).toHaveBeenCalledTimes(1)
    await wave.unmount()
    win.addEventListener = had.add
    win.removeEventListener = had.remove
  })
})

describe('the phone\'s buttons', () => {
  const ev = () => ({ preventDefault: () => {}, stopPropagation: () => {}, pointerId: 3, currentTarget: { setPointerCapture: () => {} } })
  const btn = (all: Host[], mod: string): Host => all.find((h) => cls(h).includes(`drun-btn--${mod}`))!

  it('FIRE held fires; JUMP and the gun button are edges; RELOAD only for the gun with a magazine', async () => {
    const m = await mount(createElement(TouchPad, { hud: { ...IDLE_HUD, weapon: 0 }, weapons: BASE_WEAPONS, baseRef: { current: null }, knobRef: { current: null } }))
    const all = m.all()
    ;(btn(all, 'fire').props.onPointerDown as (e: unknown) => void)(ev())
    expect(readInput().fire).toBe(true)
    ;(btn(all, 'fire').props.onPointerUp as (e: unknown) => void)(ev())
    expect(readInput().fire).toBe(false)
    ;(btn(all, 'jump').props.onPointerDown as (e: unknown) => void)(ev())
    expect(readInput().jump).toBe(true)
    expect(readInput().jump).toBe(false)
    ;(btn(all, 'gun').props.onPointerDown as (e: unknown) => void)(ev())
    expect(readInput().select).toBe(1)
    expect(btn(all, 'reload').props.hidden).toBe(true)
    expect(textOf(btn(all, 'gun'))).toContain('PULSE RIFLE')
    await m.unmount()
    const scatter = await mount(createElement(TouchPad, { hud: { ...IDLE_HUD, weapon: 1, ammo: 2, mag: 6 }, weapons: BASE_WEAPONS, baseRef: { current: null }, knobRef: { current: null } }))
    const r = btn(scatter.all(), 'reload')
    expect(r.props.hidden).toBe(false)
    ;(r.props.onPointerDown as (e: unknown) => void)(ev())
    expect(readInput().reload).toBe(true)
    expect(textOf(btn(scatter.all(), 'gun'))).toContain('2 / 6')
    await scatter.unmount()
  })
})

describe('the run\'s events', () => {
  it('each plays its sound; hits taken and landed restart their pulses', async () => {
    const ev = (e: Partial<RunEvent> & { type: RunEvent['type'] }): RunEvent => e as RunEvent
    expect(reactTo(ev({ type: 'shot', weapon: 2 }))).toMatchObject({ sound: 'shot', weapon: 2 })
    expect(reactTo(ev({ type: 'hit' }))).toMatchObject({ sound: 'hit', pulse: 'hit' })
    expect(reactTo(ev({ type: 'player-hit' }))).toMatchObject({ sound: 'hurt', pulse: 'hurt' })
    expect(reactTo(ev({ type: 'drone-destroyed' })).sound).toBe('pop')
    expect(reactTo(ev({ type: 'overheated' })).sound).toBe('overheat')
    expect(reactTo(ev({ type: 'reloaded' })).sound).toBe('reload')
    expect(reactTo(ev({ type: 'wave-started' })).sound).toBe('wave')
    expect(reactTo(ev({ type: 'cleared' })).sound).toBe('clear')
    expect(reactTo(ev({ type: 'failed' })).sound).toBe('fail')
    expect(reactTo(ev({ type: 'landed' })).sound).toBeNull()

    let send: ((e: RunEvent) => void) | null = null
    const m = await mount(createElement(DroneRunHud, { hud: { ...IDLE_HUD, phase: 'wave' }, restart: vi.fn(), nextWave: vi.fn(), subscribe: (cb) => { send = cb; return () => { send = null } }, exit: vi.fn(), touch: false }))
    expect(m.all().some((h) => cls(h) === 'drun-flash')).toBe(false)
    send!(ev({ type: 'player-hit', hp: 2 }))
    send!(ev({ type: 'shot', weapon: 1 }))
    await new Promise((r) => setTimeout(r, 5))
    expect(played).toEqual([['hurt', 0], ['shot', 1]])
    expect(m.all().some((h) => cls(h) === 'drun-flash')).toBe(true)
    await m.unmount()
    expect(send).toBeNull()
  })
})
