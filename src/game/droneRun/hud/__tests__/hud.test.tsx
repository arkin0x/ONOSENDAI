/**
 * hud.test.tsx - DRONE RUN's HUD (game/droneRun/hud): every phase draws the
 * same fixed slots, so nothing moves between them (owner: no layout jumps);
 * the cards' buttons call RESTART, NEXT WAVE and EXIT GAME, and Enter or R
 * press the first; each gun shows its own gauge; the phone's buttons write
 * the controls, three and four fingers at once; the floating sticks' rings
 * draw where a finger lands; the rail charging turns the MOVE stick into AIM
 * (LOOK hidden) and every way the charge ends turns it back; SPRINT holds
 * sprint and its ring shows the stamina; no two controls or HUD boxes overlap
 * at the five phone sizes; the aim assist box shows only on a phone with the
 * PULSE RIFLE and tells the assist its size; the run's events play their
 * sounds and restart the pulses.
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
const assistCalls: Array<number | null> = []
vi.mock('../../assist', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../assist')>()
  return { ...real, setAssistBox: (h: number | null) => { assistCalls.push(h); real.setAssistBox(h) } }
})
vi.mock('../../audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../audio')>()),
  playSound: (s: string, w = 0) => { played.push([s, w]); return true },
  warmSound: () => {},
}))
const clicked: Array<[string, number]> = []
vi.mock('../../clicks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../clicks')>()),
  playClick: (c: string, w = 0) => { clicked.push([c, w]); return true },
}))

import { createElement, useState } from 'react'
import { mount, textOf, type Host } from '../../../../test/elementRoot'
import { HudView, type HudViewProps } from '../HudView'
import { aimShown, drawStick, DroneRunHud, reactTo } from '../DroneRunHud'
import { TouchPad } from '../TouchPad'
import { ASSIST_PX, BASE_WEAPONS, COPY, FIRE_PX, IDLE_HUD, JUMP_PX, STICK_PX, assistShown, staminaOf, weaponsOfHud, type HudState } from '../model'
import { AssistBox } from '../AssistBox'
import { AIM_SCALE, aimingNow, controls$, lookRateNow, lookState, lookStickRate, noteSprintLocked, noteWeapons, pressCycle, pressJump, pressReload, pressSelect, readInput, resetInput, setFire, setInputPaused, setSprint, tickLook } from '../../input'
import { useDroneRunSound } from '../../audio'
import { readFileSync } from 'node:fs'
import type { RunEvent } from '../../../../lib/games/droneRun/sim/events'

const PHASES: HudState['phase'][] = ['safe', 'wave', 'cleared', 'failed']
/** A stick's refs, empty (no DOM). */
const sticks = () => ({ base: { current: null }, knob: { current: null } })

function props(over: Partial<HudState> = {}, more: Partial<HudViewProps> = {}): HudViewProps {
  return {
    hud: { ...IDLE_HUD, ...over },
    weapons: BASE_WEAPONS,
    touch: false,
    locked: true,
    muted: false,
    exiting: false,
    pulses: { hurt: 0, hit: 0, kill: 0 },
    onRestart: vi.fn(),
    onNextWave: vi.fn(),
    onExit: vi.fn(),
    onToggleSound: vi.fn(),
    ...more,
  }
}

const cls = (h: Host): string => String(h.props.className ?? '')
/** The fixed slots: every element whose class is one of these, as a sorted list of class names. */
const SLOTS = ['drun-top', 'drun-pips', 'drun-wave', 'drun-left', 'drun-clock', 'drun-sound', 'drun-prompt', 'drun-prompt__title', 'drun-prompt__line', 'drun-cross', 'drun-bottom', 'drun-gun', 'drun-gun__name', 'drun-gauge', 'drun-gauge__status', 'drun-hints', 'drun-stick', 'drun-btn', 'drun-radar', 'drun-assist', 'drun-stamina']
function slots(all: Host[]): string[] {
  return all.flatMap((h) => cls(h).split(' ').filter((c) => SLOTS.includes(c) || c.startsWith('drun-btn--') || c.startsWith('drun-stick--'))).sort()
}

beforeEach(() => { resetInput(0, 0); played.length = 0; clicked.length = 0; assistCalls.length = 0 })
afterEach(() => { vi.restoreAllMocks() })

describe('the HUD keeps its slots in every phase', () => {
  for (const touch of [false, true]) {
    it(`${touch ? 'phone' : 'desktop'}: the same boxes in safe, wave, cleared and failed`, async () => {
      const seen: string[][] = []
      for (const phase of PHASES) {
        const m = await mount(createElement('div', null, createElement(HudView, props({ phase, hp: phase === 'failed' ? 0 : 2 })), touch ? createElement(TouchPad, { hud: { ...IDLE_HUD, phase }, weapons: BASE_WEAPONS, move: sticks(), look: sticks() }) : null))
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
    const w = weaponsOfHud({ weaponNames: ['A', 'B', 'C'], weaponKinds: ['heat', 'ammo', 'heat'], weaponCharges: [false, false, true], weaponAssists: [null, 'auto', null] })
    expect(w.map((x) => [x.gauge, x.heats, x.assist])).toEqual([['heat', true, null], ['ammo', false, 'auto'], ['charge', true, null]])
    expect(weaponsOfHud({ weaponNames: [], weaponKinds: [], weaponCharges: [], weaponAssists: [] })).toBe(BASE_WEAPONS)
    // The base variant's: the PULSE RIFLE alone takes the assist.
    expect(BASE_WEAPONS.map((x) => x.assist)).toEqual(['auto', null, null])
    expect(weaponsOfHud(IDLE_HUD).map((x) => x.assist)).toEqual(['auto', null, null])
  })

  it('desktop: printed hints, full in the safe zone, folded in a wave; CLICK AIM before the lock', async () => {
    const safe = await mount(createElement(HudView, props({ phase: 'safe' })))
    expect(safe.says('WASD')).toBe(true)
    expect(safe.says('RELOAD')).toBe(true)
    await safe.unmount()
    const wave = await mount(createElement(HudView, props({ phase: 'wave' }, { locked: false })))
    expect(wave.says('WASD')).toBe(false)
    expect(wave.says('CLICKAIM')).toBe(true)
    expect(wave.says('1 2 3 QGUNS')).toBe(true)
    await wave.unmount()
  })

  it('desktop: SHIFT SPRINT among the printed keys in the safe zone', async () => {
    const safe = await mount(createElement(HudView, props({ phase: 'safe' })))
    expect(safe.says('SHIFTSPRINT')).toBe(true)
    await safe.unmount()
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
    const m = await mount(createElement(TouchPad, { hud: { ...IDLE_HUD, weapon: 0 }, weapons: BASE_WEAPONS, move: sticks(), look: sticks() }))
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
    const scatter = await mount(createElement(TouchPad, { hud: { ...IDLE_HUD, weapon: 1, ammo: 2, mag: 6 }, weapons: BASE_WEAPONS, move: sticks(), look: sticks() }))
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
    expect(reactTo(ev({ type: 'shot', weapon: 2 })).click).toBeUndefined()
    expect(reactTo(ev({ type: 'hit' }))).toMatchObject({ sound: null, click: 'hit', pulse: 'hit' })
    expect(reactTo(ev({ type: 'player-hit' }))).toMatchObject({ sound: 'hurt', pulse: 'hurt' })
    expect(reactTo(ev({ type: 'drone-destroyed' }))).toMatchObject({ sound: null, click: 'kill', pulse: 'kill' })
    // An aimed pull the assist sent wide: the shot, a faint whiff, no hitmarker and no marker.
    expect(reactTo(ev({ type: 'shot', weapon: 0, wide: true }))).toMatchObject({ sound: 'shot', click: 'miss' })
    expect(reactTo(ev({ type: 'shot', weapon: 0, wide: true })).pulse).toBeUndefined()
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

describe('the hitmarker and the press sounds', () => {
  const ev = (e: Partial<RunEvent> & { type: RunEvent['type'] }): RunEvent => e as RunEvent
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))
  const marks = (all: Host[]): Host[] => all.filter((h) => cls(h).startsWith('drun-hitmark'))

  it('a hit shows the marker and ticks for the gun that fired; a kill shows the kill look and its own sound; a shot sent wide shows none and only whiffs', async () => {
    let send: ((e: RunEvent) => void) | null = null
    const m = await mount(createElement(DroneRunHud, { hud: { ...IDLE_HUD, phase: 'wave' }, restart: vi.fn(), nextWave: vi.fn(), subscribe: (cb) => { send = cb; return () => { send = null } }, exit: vi.fn(), touch: false }))
    expect(marks(m.all())).toEqual([])
    send!(ev({ type: 'shot', weapon: 0, wide: true }))
    await tick()
    expect(marks(m.all())).toEqual([])
    expect(clicked).toEqual([['miss', 0]])
    send!(ev({ type: 'shot', weapon: 2 }))
    send!(ev({ type: 'hit', drone: 1, damage: 1 }))
    await tick()
    expect(marks(m.all()).map(cls)).toEqual(['drun-hitmark'])
    expect(clicked.at(-1)).toEqual(['hit', 2])
    send!(ev({ type: 'shot', weapon: 1 }))
    send!(ev({ type: 'hit', drone: 1, damage: 1 }))
    send!(ev({ type: 'drone-destroyed', drone: 1, enemy: 'scout' }))
    await tick()
    expect(marks(m.all()).map(cls)).toEqual(['drun-hitmark is-kill'])
    expect(clicked.slice(-2)).toEqual([['hit', 1], ['kill', 1]])
    // The next plain hit goes back to the plain look.
    send!(ev({ type: 'hit', drone: 2, damage: 1 }))
    await tick()
    expect(marks(m.all()).map(cls)).toEqual(['drun-hitmark'])
    // None of these are the guns' own sounds: the hitmarker never goes through playSound.
    expect(played.every(([s]) => s === 'shot')).toBe(true)
    await m.unmount()
  })

  it('each control on the phone has its press sound: FIRE, JUMP, SPRINT on and off, the gun, RELOAD; the lockout too', async () => {
    const m = await mount(createElement(DroneRunHud, { hud: { ...IDLE_HUD, phase: 'wave', weapon: 1, ammo: 2, mag: 6 }, restart: vi.fn(), nextWave: vi.fn(), subscribe: () => () => {}, exit: vi.fn(), touch: true }))
    const btnOf = (mod: string): Host => m.all().find((h) => cls(h).includes(`drun-btn--${mod}`))!
    const press = (h: Host, name: string, extra: Record<string, unknown> = {}): void => { (h.props[name] as (e: unknown) => void)({ pointerId: 7, pointerType: 'touch', timeStamp: 1000, preventDefault() {}, stopPropagation() {}, currentTarget: { setPointerCapture() {} }, ...extra }) }
    press(btnOf('fire'), 'onPointerDown')
    press(btnOf('fire'), 'onPointerUp')
    press(btnOf('jump'), 'onPointerDown')
    press(btnOf('sprint'), 'onPointerDown')
    press(btnOf('sprint'), 'onPointerUp', { timeStamp: 1600 })
    press(btnOf('gun'), 'onPointerDown')
    press(btnOf('reload'), 'onPointerDown')
    noteSprintLocked(false)
    noteSprintLocked(true)
    noteSprintLocked(true)
    expect(clicked.map(([c]) => c)).toEqual(['ui:fire', 'ui:jump', 'ui:sprintOn', 'ui:sprintOff', 'ui:switch', 'ui:reload', 'ui:lockout'])
    await m.unmount()
  })

  it('a second finger on FIRE is no second press; a latched SPRINT run dry is the lockout alone, not SPRINT off too', async () => {
    const m = await mount(createElement(DroneRunHud, { hud: { ...IDLE_HUD, phase: 'wave' }, restart: vi.fn(), nextWave: vi.fn(), subscribe: () => () => {}, exit: vi.fn(), touch: true }))
    const btnOf = (mod: string): Host => m.all().find((h) => cls(h).includes(`drun-btn--${mod}`))!
    const e = (id: number, t = 1000) => ({ pointerId: id, pointerType: 'touch', timeStamp: t, preventDefault() {}, stopPropagation() {}, currentTarget: { setPointerCapture() {} } })
    ;(btnOf('fire').props.onPointerDown as (e: unknown) => void)(e(1))
    ;(btnOf('fire').props.onPointerDown as (e: unknown) => void)(e(2))
    // A tap latches sprint on.
    ;(btnOf('sprint').props.onPointerDown as (e: unknown) => void)(e(3, 2000))
    ;(btnOf('sprint').props.onPointerUp as (e: unknown) => void)(e(3, 2100))
    noteSprintLocked(true)
    expect(clicked.map(([c]) => c)).toEqual(['ui:fire', 'ui:sprintOn', 'ui:lockout'])
    await m.unmount()
  })

  it('RESTART, NEXT WAVE, EXIT GAME and the sound switch each have their own press sound', async () => {
    // A card takes Enter and R on the window: a window that listens.
    const g = globalThis as unknown as Record<string, unknown>
    const had = { add: g.addEventListener, remove: g.removeEventListener }
    g.addEventListener = () => {}
    g.removeEventListener = () => {}
    const restart = vi.fn(), nextWave = vi.fn(), exit = vi.fn()
    const failed = await mount(createElement(DroneRunHud, { hud: { ...IDLE_HUD, phase: 'failed' }, restart, nextWave, subscribe: () => () => {}, exit, touch: true }))
    const click = (all: Host[], c: string): void => { (all.find((h) => cls(h) === c)!.props.onClick as (e?: unknown) => void)() }
    click(failed.all(), 'drun-card__go')
    click(failed.all(), 'drun-card__exit')
    click(failed.all(), 'drun-sound')
    await failed.unmount()
    const cleared = await mount(createElement(DroneRunHud, { hud: { ...IDLE_HUD, phase: 'cleared' }, restart, nextWave, subscribe: () => () => {}, exit, touch: true }))
    click(cleared.all(), 'drun-card__go')
    await cleared.unmount()
    expect(clicked.map(([c]) => c)).toEqual(['ui:restart', 'ui:exit', 'ui:sound', 'ui:nextWave'])
    expect(restart).toHaveBeenCalledTimes(1)
    expect(nextWave).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledTimes(1)
    useDroneRunSound.setState({ muted: false })
    g.addEventListener = had.add
    g.removeEventListener = had.remove
  })

  it('the desktop keys press the same controls (Space, 1 to 3, Q, R, Shift)', () => {
    const heard: string[] = []
    const l = (c: string): void => { heard.push(c) }
    controls$.listeners.add(l)
    noteWeapons(3, 0)
    pressJump()
    pressSelect(0)
    pressSelect(2)
    pressCycle(1)
    pressReload()
    setSprint('key:ShiftLeft', true)
    setSprint('key:ShiftLeft', false)
    setFire('mouse', true)
    setFire('mouse', false)
    controls$.listeners.delete(l)
    // Choosing the gun already in hand is no switch.
    expect(heard).toEqual(['jump', 'switch', 'switch', 'reload', 'sprintOn', 'sprintOff', 'fire'])
  })

  it('a card up, no control sounds at all', () => {
    const heard: string[] = []
    const l = (c: string): void => { heard.push(c) }
    controls$.listeners.add(l)
    setInputPaused(true)
    pressJump(); pressReload(); pressCycle(1); setFire('mouse', true); setSprint('key:ShiftLeft', true); noteSprintLocked(true)
    setInputPaused(false)
    controls$.listeners.delete(l)
    expect(heard).toEqual([])
  })
})

describe('three fingers at once, and a fourth on JUMP (phone)', () => {
  type Handler = (e: unknown) => void
  const W = 375, H = 812
  const MOVE = { cx: 20 + STICK_PX / 2, cy: H - 24 - STICK_PX / 2 }
  const LOOK = { cx: W - 20 - STICK_PX / 2, cy: H - 24 - STICK_PX / 2 }
  const g = globalThis as unknown as Record<string, unknown>
  let saved: Record<string, unknown> = {}
  let winEvents: EventTarget
  beforeEach(() => {
    saved = { innerWidth: g.innerWidth, innerHeight: g.innerHeight, document: g.document, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener }
    winEvents = new EventTarget()
    const docEvents = new EventTarget()
    g.innerWidth = W
    g.innerHeight = H
    g.addEventListener = (t: string, f: EventListener) => winEvents.addEventListener(t, f)
    g.removeEventListener = (t: string, f: EventListener) => winEvents.removeEventListener(t, f)
    g.document = { visibilityState: 'visible', addEventListener: (t: string, f: EventListener) => docEvents.addEventListener(t, f), removeEventListener: (t: string, f: EventListener) => docEvents.removeEventListener(t, f) }
  })
  afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete g[k]; else g[k] = v } })

  async function pad() {
    const m = await mount(createElement(DroneRunHud, { hud: { ...IDLE_HUD, phase: 'wave' }, restart: vi.fn(), nextWave: vi.fn(), subscribe: () => () => {}, exit: vi.fn(), touch: true }))
    const find = (c: string): Host => m.all().find((h) => cls(h).split(' ').includes(c))!
    const layer = find('drun-layer')
    const on = (h: Host, name: string, e: Record<string, unknown>): void => (h.props[name] as Handler)({ pointerType: 'touch', preventDefault: () => {}, stopPropagation: () => {}, currentTarget: { clientWidth: W, clientHeight: H, setPointerCapture: () => {} }, ...e })
    const touch = (name: 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture', id: number, x = 0, y = 0): void => on(layer, name, { pointerId: id, clientX: x, clientY: y })
    const button = (mod: string, name: string, id: number): void => on(find(`drun-btn--${mod}`), name, { pointerId: id })
    return { m, touch, button }
  }

  it('the aim assist box follows the last pointer: a trackpad or a mouse hides it, the next touch brings it back', async () => {
    const m = await mount(createElement(DroneRunHud, { hud: { ...IDLE_HUD, phase: 'wave' }, restart: vi.fn(), nextWave: vi.fn(), subscribe: () => () => {}, exit: vi.fn(), touch: true }))
    const boxCls = (): string => cls(m.all().find((h) => cls(h).split(' ').includes('drun-assist'))!)
    const pointer = (type: string, pointerType: string): void => { winEvents.dispatchEvent(Object.assign(new Event(type), { pointerType })) }
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))
    expect(boxCls()).toBe('drun-assist')
    pointer('pointermove', 'mouse')
    await tick()
    expect(boxCls()).toBe('drun-assist is-off')
    expect(assistCalls[assistCalls.length - 1]).toBeNull()
    pointer('pointerdown', 'pen')
    await tick()
    expect(boxCls()).toBe('drun-assist is-off')
    pointer('pointerdown', 'touch')
    await tick()
    expect(boxCls()).toBe('drun-assist')
    expect(assistCalls[assistCalls.length - 1]).toBeGreaterThan(0)
    await m.unmount()
  })

  it('move, look and fire held together; lifting one leaves the others; JUMP on top', async () => {
    const { m, touch, button } = await pad()
    touch('onPointerDown', 1, MOVE.cx, MOVE.cy)
    touch('onPointerMove', 1, MOVE.cx, MOVE.cy - 60)
    touch('onPointerDown', 2, LOOK.cx, LOOK.cy)
    touch('onPointerMove', 2, LOOK.cx + 40, LOOK.cy)
    button('fire', 'onPointerDown', 3)
    tickLook(0.1)
    const a = readInput()
    expect(a.move.fwd).toBeCloseTo(1)
    expect(a.yaw).toBeCloseTo(lookStickRate(40, 0, STICK_PX / 2).yaw * 0.1)
    expect(a.yaw).toBeLessThan(0)
    expect(a.fire).toBe(true)
    // The LOOK finger lifts: the turning stops, moving and firing go on.
    touch('onPointerUp', 2)
    const y = lookState.yaw
    tickLook(0.1)
    const b = readInput()
    expect(b.yaw).toBe(y)
    expect(b.move.fwd).toBeCloseTo(1)
    expect(b.fire).toBe(true)
    // A fourth finger on JUMP: an edge, while the others hold.
    touch('onPointerDown', 2, LOOK.cx, LOOK.cy)
    touch('onPointerMove', 2, LOOK.cx - 40, LOOK.cy)
    button('jump', 'onPointerDown', 4)
    tickLook(0.1)
    const c = readInput()
    expect(c.jump).toBe(true)
    expect(c.move.fwd).toBeCloseTo(1)
    expect(c.fire).toBe(true)
    expect(c.yaw).toBeGreaterThan(y)
    expect(readInput().jump).toBe(false)
    await m.unmount()
  })

  it('a finger that slides off its control keeps it; cancel and lost capture let go of that finger only; blur of all', async () => {
    const { m, touch, button } = await pad()
    touch('onPointerDown', 1, MOVE.cx, MOVE.cy)
    touch('onPointerDown', 2, LOOK.cx, LOOK.cy)
    touch('onPointerMove', 2, LOOK.cx + 60, LOOK.cy)
    button('fire', 'onPointerDown', 3)
    // The MOVE finger slides far onto the right half; another finger on the left is not a second stick.
    touch('onPointerMove', 1, 330, MOVE.cy)
    touch('onPointerDown', 5, MOVE.cx, MOVE.cy + 60)
    expect(readInput().move.strafe).toBeCloseTo(1)
    // FIRE's finger moving over the view (it is captured by FIRE) moves nothing.
    touch('onPointerMove', 3, 100, 100)
    expect(readInput().fire).toBe(true)
    // A cancel on the MOVE finger: moving stops; the look and fire hold.
    touch('onPointerCancel', 1)
    tickLook(0.1)
    const a = readInput()
    expect(a.move).toEqual({ fwd: 0, strafe: 0 })
    expect(a.fire).toBe(true)
    expect(a.yaw).toBeLessThan(0)
    // Lost capture on the LOOK finger: turning stops; fire holds.
    touch('onLostPointerCapture', 2)
    const y = lookState.yaw
    tickLook(0.1)
    expect(readInput().yaw).toBe(y)
    // Two fingers on FIRE: one cancelled, the other still fires; its lost capture ends it.
    button('fire', 'onPointerDown', 7)
    button('fire', 'onPointerCancel', 3)
    expect(readInput().fire).toBe(true)
    button('fire', 'onLostPointerCapture', 7)
    expect(readInput().fire).toBe(false)
    // All three again, then the window loses focus: everything lets go.
    touch('onPointerDown', 8, MOVE.cx, MOVE.cy)
    touch('onPointerMove', 8, MOVE.cx, MOVE.cy - 60)
    touch('onPointerDown', 9, LOOK.cx, LOOK.cy)
    touch('onPointerMove', 9, LOOK.cx + 60, LOOK.cy)
    button('fire', 'onPointerDown', 10)
    winEvents.dispatchEvent(new Event('blur'))
    const y2 = lookState.yaw
    tickLook(0.1)
    const b = readInput()
    expect(b.move).toEqual({ fwd: 0, strafe: 0 })
    expect(b.fire).toBe(false)
    expect(b.yaw).toBe(y2)
    // The controls take new fingers after.
    touch('onPointerDown', 11, MOVE.cx, MOVE.cy)
    touch('onPointerMove', 11, MOVE.cx, MOVE.cy - 60)
    expect(readInput().move.fwd).toBeCloseTo(1)
    await m.unmount()
  })
})

describe('the floating sticks\' rings, as the HUD draws them', () => {
  /** A stand-in for a stick's ring: its resting box at (cx, cy), moved by whatever translate its style holds, as a browser measures it. */
  function ring(cx: number, cy: number, r: number) {
    const el = {
      style: { transform: '' },
      getBoundingClientRect: () => {
        const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(el.style.transform)
        const dx = m ? Number(m[1]) : 0, dy = m ? Number(m[2]) : 0
        return { left: cx - r + dx, top: cy - r + dy, width: 2 * r, height: 2 * r }
      },
    }
    return el
  }

  it('the ring moves to where the finger landed, follows a new landing, and goes back to rest on lift; the knob from its centre', () => {
    const base = ring(80, 728, 60), knob = { style: { transform: '' } }
    const moved = { x: 0, y: 0 }
    const fallback = { cx: 0, cy: 0, radius: 60 }
    drawStick(base as never, knob as never, { x: 150, y: 500 }, { dx: 0, dy: 0 }, moved, fallback)
    expect(base.style.transform).toBe('translate(70px, -228px)')
    const r = base.getBoundingClientRect()
    expect([r.left + 60, r.top + 60]).toEqual([150, 500])
    // Drawn again while moved: measured from its resting place, not from where it is drawn.
    drawStick(base as never, knob as never, { x: 160, y: 510 }, { dx: 12, dy: -5 }, moved, fallback)
    expect(base.style.transform).toBe('translate(80px, -218px)')
    expect(knob.style.transform).toBe('translate(12px, -5px)')
    drawStick(base as never, knob as never, null, { dx: 0, dy: 0 }, moved, fallback)
    expect(base.style.transform).toBe('')
    expect(moved).toEqual({ x: 0, y: 0 })
  })
})

describe('aim: the rail charging turns the MOVE stick into AIM', () => {
  type Handler = (e: unknown) => void
  const W = 375, H = 812
  const MOVE = { cx: 20 + STICK_PX / 2, cy: H - 24 - STICK_PX / 2 }
  const LOOK = { cx: W - 20 - STICK_PX / 2, cy: H - 24 - STICK_PX / 2 }
  const g = globalThis as unknown as Record<string, unknown>
  let saved: Record<string, unknown> = {}
  let winEvents: EventTarget
  let docEvents: EventTarget
  let doc: { visibilityState: string }
  beforeEach(() => {
    saved = { innerWidth: g.innerWidth, innerHeight: g.innerHeight, document: g.document, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener }
    winEvents = new EventTarget()
    docEvents = new EventTarget()
    g.innerWidth = W
    g.innerHeight = H
    g.addEventListener = (t: string, f: EventListener) => winEvents.addEventListener(t, f)
    g.removeEventListener = (t: string, f: EventListener) => winEvents.removeEventListener(t, f)
    doc = { visibilityState: 'visible', addEventListener: (t: string, f: EventListener) => docEvents.addEventListener(t, f), removeEventListener: (t: string, f: EventListener) => docEvents.removeEventListener(t, f) } as never
    g.document = doc
  })
  afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete g[k]; else g[k] = v } })

  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))
  const RAIL = 2, PULSE = 0

  async function hudWith(start: Partial<HudState>) {
    let set: ((h: HudState) => void) | null = null
    function Wrap(): JSX.Element {
      const [hud, setHud] = useState<HudState>({ ...IDLE_HUD, phase: 'wave', ...start })
      set = setHud
      return createElement(DroneRunHud, { hud, restart: vi.fn(), nextWave: vi.fn(), subscribe: () => () => {}, exit: vi.fn(), touch: true })
    }
    const m = await mount(createElement(Wrap))
    const find = (c: string): Host => m.all().find((h) => cls(h).split(' ').includes(c))!
    const on = (h: Host, name: string, e: Record<string, unknown>): void => (h.props[name] as Handler)({ pointerType: 'touch', preventDefault: () => {}, stopPropagation: () => {}, currentTarget: { clientWidth: W, clientHeight: H, setPointerCapture: () => {} }, ...e })
    const touch = (name: string, id: number, x = 0, y = 0): void => on(find('drun-layer'), name, { pointerId: id, clientX: x, clientY: y })
    const button = (mod: string, name: string, id: number, timeStamp?: number): void => on(find(`drun-btn--${mod}`), name, { pointerId: id, timeStamp })
    const hud = async (over: Partial<HudState>): Promise<void> => { set!({ ...IDLE_HUD, phase: 'wave', ...start, ...over }); await tick() }
    /** What the sticks show now. */
    const shows = () => {
      const move = find('drun-stick--move'), look = find('drun-stick--look')
      return {
        aim: cls(move).split(' ').includes('is-aim'),
        label: textOf(move),
        crosshair: m.all().some((h) => cls(h).includes('drun-stick__aim')),
        lookHidden: cls(look).split(' ').includes('is-hidden'),
      }
    }
    return { m, touch, button, hud, shows }
  }
  const AIMING = { aim: true, label: COPY.stickAim, crosshair: true, lookHidden: true }
  const PLAIN = { aim: false, label: COPY.move, crosshair: false, lookHidden: false }

  it('FIRE held with the rail: the left stick aims (move 0, the view turns finely), LOOK hidden; FIRE let go: back, a held finger re-centred', async () => {
    const { m, touch, button, shows } = await hudWith({ weapon: RAIL })
    expect(shows()).toEqual(PLAIN)
    touch('onPointerDown', 1, MOVE.cx, MOVE.cy)
    touch('onPointerMove', 1, MOVE.cx, MOVE.cy - 60)
    expect(readInput().move.fwd).toBeCloseTo(1)
    button('fire', 'onPointerDown', 3)
    await tick()
    expect(shows()).toEqual(AIMING)
    expect(aimingNow()).toBe(true)
    // The finger already down is re-centred where it is: nothing turns until it moves on from there.
    const a = readInput()
    expect(a.move).toEqual({ fwd: 0, strafe: 0 })
    expect(a.fire).toBe(true)
    expect(lookRateNow()).toEqual({ yaw: 0, pitch: 0 })
    touch('onPointerMove', 1, MOVE.cx + 30, MOVE.cy - 60)
    const want = lookStickRate(30, 0, STICK_PX / 2, AIM_SCALE).yaw
    expect(lookRateNow().yaw).toBeCloseTo(want)
    const y = lookState.yaw
    tickLook(0.1)
    expect(lookState.yaw).toBeCloseTo(y + want * 0.1)
    expect(readInput().move).toEqual({ fwd: 0, strafe: 0 })
    // A touch on the right while it aims takes no LOOK stick.
    touch('onPointerDown', 2, LOOK.cx, LOOK.cy)
    touch('onPointerMove', 2, LOOK.cx + 60, LOOK.cy)
    expect(lookRateNow().yaw).toBeCloseTo(want)
    // The shot: FIRE let go. Both sticks back; the left finger, still down, moves from where it is now.
    button('fire', 'onPointerUp', 3)
    await tick()
    expect(shows()).toEqual(PLAIN)
    expect(aimingNow()).toBe(false)
    expect(lookRateNow()).toEqual({ yaw: 0, pitch: 0 })
    expect(readInput().move).toEqual({ fwd: 0, strafe: 0 })
    touch('onPointerMove', 1, MOVE.cx + 30, MOVE.cy - 120)
    expect(readInput().move.fwd).toBeCloseTo(1)
    await m.unmount()
    expect(aimingNow()).toBe(false)
  })

  it('a gun switch, a card, the page hidden and blur each end the aim; overheat ends it; another gun never aims', async () => {
    const { m, button, hud, shows } = await hudWith({ weapon: RAIL })
    button('fire', 'onPointerDown', 3)
    await tick()
    expect(shows()).toEqual(AIMING)
    // Another gun in hand, FIRE still held.
    await hud({ weapon: PULSE })
    expect(shows()).toEqual(PLAIN)
    expect(aimingNow()).toBe(false)
    // Back to the rail with FIRE still held: aiming again.
    await hud({ weapon: RAIL })
    expect(shows()).toEqual(AIMING)
    // Overheated, the charge is dropped.
    await hud({ weapon: RAIL, overheated: true })
    expect(shows()).toEqual(PLAIN)
    await hud({ weapon: RAIL })
    expect(shows()).toEqual(AIMING)
    // A card: every control lets go.
    await hud({ weapon: RAIL, phase: 'failed', hp: 0 })
    expect(aimingNow()).toBe(false)
    expect(shows().aim).toBe(false)
    await hud({ weapon: RAIL })
    expect(shows()).toEqual(PLAIN)
    // The window loses focus.
    button('fire', 'onPointerDown', 4)
    await tick()
    expect(shows()).toEqual(AIMING)
    winEvents.dispatchEvent(new Event('blur'))
    await tick()
    expect(shows()).toEqual(PLAIN)
    expect(aimingNow()).toBe(false)
    // The page hidden.
    button('fire', 'onPointerDown', 5)
    await tick()
    expect(shows()).toEqual(AIMING)
    doc.visibilityState = 'hidden'
    docEvents.dispatchEvent(new Event('visibilitychange'))
    await tick()
    expect(shows()).toEqual(PLAIN)
    doc.visibilityState = 'visible'
    // FIRE with the PULSE RIFLE moves as ever.
    await hud({ weapon: PULSE })
    button('fire', 'onPointerDown', 6)
    await tick()
    expect(shows()).toEqual(PLAIN)
    await m.unmount()
  })

  it('aimShown: a phone, no card, a finger on FIRE, a charge gun, not overheated', () => {
    const h = { weapon: RAIL, overheated: false, switching: false }
    expect(aimShown(true, false, true, h, BASE_WEAPONS)).toBe(true)
    expect(aimShown(false, false, true, h, BASE_WEAPONS)).toBe(false)
    expect(aimShown(true, true, true, h, BASE_WEAPONS)).toBe(false)
    expect(aimShown(true, false, false, h, BASE_WEAPONS)).toBe(false)
    expect(aimShown(true, false, true, { ...h, overheated: true }, BASE_WEAPONS)).toBe(false)
    expect(aimShown(true, false, true, { ...h, weapon: PULSE }, BASE_WEAPONS)).toBe(false)
    // Still switching in, the rail cannot charge: the stick keeps moving.
    expect(aimShown(true, false, true, { ...h, switching: true }, BASE_WEAPONS)).toBe(false)
  })

  it('SPRINT: held sprints, per finger, with move and look and fire at once; the button lights while held', async () => {
    const { m, touch, button } = await hudWith({ weapon: PULSE })
    const sprintCls = (): string => cls(m.all().find((h) => cls(h).includes('drun-btn--sprint'))!)
    touch('onPointerDown', 1, MOVE.cx, MOVE.cy)
    touch('onPointerMove', 1, MOVE.cx, MOVE.cy - 60)
    touch('onPointerDown', 2, LOOK.cx, LOOK.cy)
    touch('onPointerMove', 2, LOOK.cx + 40, LOOK.cy)
    button('fire', 'onPointerDown', 3)
    button('sprint', 'onPointerDown', 4, 1000)
    await tick()
    expect(sprintCls()).toContain('is-held')
    tickLook(0.1)
    const a = readInput()
    expect([a.sprint, a.fire, a.move.fwd > 0.99, a.yaw < 0]).toEqual([true, true, true, true])
    // A second finger on SPRINT, the first lifting after a hold: still sprinting.
    button('sprint', 'onPointerDown', 5, 1500)
    button('sprint', 'onPointerUp', 4, 2000)
    expect(readInput().sprint).toBe(true)
    button('sprint', 'onLostPointerCapture', 5, 2100)
    await tick()
    expect(readInput().sprint).toBe(false)
    expect(sprintCls()).not.toContain('is-held')
    expect(sprintCls()).not.toContain('is-latched')
    expect(readInput().move.fwd).toBeCloseTo(1)
    await m.unmount()
  })

  it('SPRINT tapped latches on and lights; a second tap, the MOVE stick let go, the lockout, a card and blur each turn it off', async () => {
    const { m, touch, button, hud } = await hudWith({ weapon: PULSE })
    const sprintCls = (): string => cls(m.all().find((h) => cls(h).includes('drun-btn--sprint'))!)
    const tap = async (id: number, at: number): Promise<void> => { button('sprint', 'onPointerDown', id, at); button('sprint', 'onPointerUp', id, at + 90); button('sprint', 'onLostPointerCapture', id, at + 91); await tick() }
    // One thumb: tap SPRINT, then the MOVE stick.
    await tap(4, 1000)
    expect(sprintCls()).toContain('is-latched')
    expect(sprintCls()).toContain('is-held')
    touch('onPointerDown', 1, MOVE.cx, MOVE.cy)
    touch('onPointerMove', 1, MOVE.cx, MOVE.cy - 60)
    const a = readInput()
    expect([a.sprint, a.move.fwd > 0.99]).toEqual([true, true])
    // A second tap.
    await tap(4, 2000)
    expect(sprintCls()).not.toContain('is-latched')
    expect(readInput().sprint).toBe(false)
    // The MOVE thumb lifting.
    await tap(4, 3000)
    expect(readInput().sprint).toBe(true)
    touch('onPointerUp', 1)
    await tick()
    expect(readInput().sprint).toBe(false)
    expect(sprintCls()).not.toContain('is-latched')
    // The lockout (the runner tells input.ts each step).
    await tap(4, 4000)
    noteSprintLocked(true)
    await tick()
    expect(readInput().sprint).toBe(false)
    expect(sprintCls()).not.toContain('is-latched')
    // A card.
    await tap(4, 5000)
    await hud({ weapon: PULSE, phase: 'failed', hp: 0 })
    expect(readInput().sprint).toBe(false)
    await hud({ weapon: PULSE })
    expect(sprintCls()).not.toContain('is-latched')
    // Blur, and the page hidden.
    await tap(4, 6000)
    winEvents.dispatchEvent(new Event('blur'))
    await tick()
    expect(readInput().sprint).toBe(false)
    await tap(4, 7000)
    expect(readInput().sprint).toBe(true)
    doc.visibilityState = 'hidden'
    docEvents.dispatchEvent(new Event('visibilitychange'))
    await tick()
    expect(readInput().sprint).toBe(false)
    expect(sprintCls()).not.toContain('is-latched')
    doc.visibilityState = 'visible'
    await m.unmount()
  })
})

describe('the SPRINT button\'s stamina ring', () => {
  const meter = (all: Host[]): Host => all.find((h) => h.props.role === 'meter' && h.props['aria-label'] === COPY.stamina)!
  const fill = (all: Host[]): Host => all.find((h) => cls(h) === 'drun-meter__fill')!
  const sprint = (all: Host[]): Host => all.find((h) => cls(h).includes('drun-btn--sprint'))!

  it('full when the runner says nothing of stamina; drains with it; dims while locked out', async () => {
    expect(staminaOf(IDLE_HUD)).toEqual({ stamina: 1, sprinting: false, locked: false, shown: true })
    const full = await mount(createElement(TouchPad, { hud: IDLE_HUD, weapons: BASE_WEAPONS, move: sticks(), look: sticks() }))
    expect(meter(full.all()).props['aria-valuenow']).toBe(100)
    expect(fill(full.all()).props.strokeDashoffset).toBe(0)
    expect(textOf(sprint(full.all()))).toBe(COPY.sprint)
    await full.unmount()
    const draining = await mount(createElement(TouchPad, { hud: { ...IDLE_HUD, stamina: 0.4, sprinting: true, sprintLocked: false } as HudState, weapons: BASE_WEAPONS, move: sticks(), look: sticks(), sprintHeld: true }))
    expect(meter(draining.all()).props['aria-valuenow']).toBe(40)
    expect(fill(draining.all()).props.strokeDashoffset).toBeCloseTo(60)
    expect(cls(sprint(draining.all()))).toContain('is-sprinting')
    expect(cls(sprint(draining.all()))).toContain('is-held')
    expect(cls(sprint(draining.all()))).not.toContain('is-locked')
    await draining.unmount()
    const locked = await mount(createElement(TouchPad, { hud: { ...IDLE_HUD, stamina: 0.1, sprinting: false, sprintLocked: true } as HudState, weapons: BASE_WEAPONS, move: sticks(), look: sticks() }))
    expect(meter(locked.all()).props['aria-valuenow']).toBe(10)
    expect(cls(sprint(locked.all()))).toContain('is-locked')
    await locked.unmount()
    // A variant with no stamina: SPRINT does nothing there, so it is not shown (its place kept).
    const none = await mount(createElement(TouchPad, { hud: { ...IDLE_HUD, stamina: 0, hasStamina: false } as HudState, weapons: BASE_WEAPONS, move: sticks(), look: sticks() }))
    expect(sprint(none.all()).props.hidden).toBe(true)
    expect(sprint(none.all()).props.disabled).toBe(true)
    await none.unmount()
    // Out of range or missing, it stays sane.
    expect(staminaOf({ ...IDLE_HUD, stamina: 7 } as HudState).stamina).toBe(1)
    expect(staminaOf({ ...IDLE_HUD, stamina: -1 } as HudState).stamina).toBe(0)
    expect(staminaOf({ ...IDLE_HUD, stamina: Number.NaN } as HudState).stamina).toBe(1)
  })

  it('tapped on (latched), the button is lit and pressed', async () => {
    const on = await mount(createElement(TouchPad, { hud: IDLE_HUD, weapons: BASE_WEAPONS, move: sticks(), look: sticks(), sprintLatched: true }))
    expect(cls(sprint(on.all()))).toContain('is-latched')
    expect(cls(sprint(on.all()))).toContain('is-held')
    expect(sprint(on.all()).props['aria-pressed']).toBe(true)
    await on.unmount()
    const off = await mount(createElement(TouchPad, { hud: IDLE_HUD, weapons: BASE_WEAPONS, move: sticks(), look: sticks() }))
    expect(cls(sprint(off.all()))).not.toContain('is-latched')
    expect(sprint(off.all()).props['aria-pressed']).toBe(false)
    await off.unmount()
  })

  it('the CSS dims it while locked out and draws the ring inside its border', () => {
    const css = readFileSync(new URL('../../../../styles.css', import.meta.url), 'utf8')
    // Locked out, the ring and the background dim, never the white word (no opacity on the button).
    expect(css).toMatch(/\.drun-btn--sprint\.is-locked \{ background: [^;]+; border-color: [^;]+; box-shadow: none; \}/)
    expect(css).toMatch(/\.drun-btn--sprint\.is-locked \.drun-meter__fill \{ stroke: /)
    expect(css).not.toMatch(/\.drun-btn--sprint\.is-locked[^{]*\{[^}]*opacity/)
    // Latched (tapped on), it is lit.
    expect(css).toMatch(/\.drun-btn--sprint\.is-latched \{ background: /)
    expect(css).toMatch(/\.drun-meter \{ position: absolute; inset: 0;/)
  })
})

describe('the desktop\'s stamina gauge', () => {
  const gauge = (all: Host[]): Host | undefined => all.find((h) => cls(h).split(' ').includes('drun-stamina'))
  const bar = (all: Host[]): Host => all.find((h) => h.props.role === 'meter' && h.props['aria-label'] === COPY.stamina)!

  it('shown on a desktop with stamina, in its own slot in every phase; drains with it; dims in the lockout', async () => {
    const full = await mount(createElement(HudView, props()))
    expect(gauge(full.all())).toBeDefined()
    expect(bar(full.all()).props['aria-valuenow']).toBe(100)
    expect(full.says(COPY.stamina)).toBe(true)
    await full.unmount()
    const draining = await mount(createElement(HudView, props({ stamina: 0.35, sprinting: true } as Partial<HudState>)))
    expect(bar(draining.all()).props['aria-valuenow']).toBe(35)
    expect(cls(gauge(draining.all())!)).toContain('is-sprinting')
    expect(cls(gauge(draining.all())!)).not.toContain('is-locked')
    await draining.unmount()
    const locked = await mount(createElement(HudView, props({ stamina: 0, sprintLocked: true } as Partial<HudState>)))
    expect(cls(gauge(locked.all())!)).toContain('is-locked')
    await locked.unmount()
  })

  it('not on a phone (the ring round SPRINT is its gauge), nor for a variant without stamina', async () => {
    const phone = await mount(createElement(HudView, props({}, { touch: true })))
    expect(gauge(phone.all())).toBeUndefined()
    await phone.unmount()
    const none = await mount(createElement(HudView, props({ hasStamina: false } as Partial<HudState>)))
    expect(gauge(none.all())).toBeUndefined()
    await none.unmount()
  })

  it('the CSS places it in a fixed slot of its own and dims its bar in the lockout', () => {
    const css = readFileSync(new URL('../../../../styles.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.drun-stamina \{\n  position: absolute;\n  left: 16px;\n  bottom: var\(--drun-bottom\);\n  width: 120px;/)
    expect(css).toMatch(/\.drun-stamina\.is-locked \.drun-bar__fill \{ background: /)
  })
})

describe('the controls at the five phone sizes: no two boxes overlap', () => {
  const css = readFileSync(new URL('../../../../styles.css', import.meta.url), 'utf8')
  const section = css.slice(css.indexOf('/* ---------- DRONE RUN: HUD'), css.indexOf('/* ---------- end DRONE RUN'))
  const block = (q: string): string => {
    const at = section.indexOf(`@media (${q}) {`)
    expect(at).toBeGreaterThan(-1)
    return section.slice(at, section.indexOf('\n}', at))
  }
  const px = (body: string, name: string): number => Number(new RegExp(`${name}: (\\d+)px`).exec(body)?.[1] ?? NaN)
  const tall = section.slice(0, section.indexOf('.drun-layer {'))
  const short = block('max-height: 520px'), shorter = block('max-height: 440px')

  it('the rules the boxes below are computed from are the CSS\'s own', () => {
    expect(section).toContain('--drun-above-stick: calc(var(--drun-bottom) + 4px + var(--drun-stick) + 14px);')
    expect(section).toContain('--drun-above-sprint: calc(var(--drun-above-stick) + var(--drun-jump) + 10px);')
    expect(section).toMatch(/\.drun-btn--sprint \{\n  left: 16px;\n  bottom: var\(--drun-above-stick\);\n  width: var\(--drun-jump\);\n  height: var\(--drun-jump\);/)
    expect(section).toMatch(/\.drun-radar \{\n  position: absolute;\n  top: calc\(var\(--drun-top\) \+ 38px\);\n  left: 16px;/)
    expect(shorter).toContain('.drun-radar { left: calc(16px + var(--drun-jump) + 12px); }')
    expect(section).toMatch(/\.drun-btn--gun \{\n  left: 16px;\n  bottom: var\(--drun-above-sprint\);\n  width: 150px;\n  height: 56px;/)
    expect(section).toMatch(/\.drun-btn--reload \{\n  left: 16px;\n  bottom: calc\(var\(--drun-above-sprint\) \+ 64px\);\n  width: 110px;\n  height: 36px;/)
    expect(short).toContain('.drun-btn--reload { left: calc(16px + 150px + 8px); bottom: calc(var(--drun-above-sprint) + 10px); }')
    expect(shorter).toContain('--drun-beside-move: calc(20px + var(--drun-stick) + 10px);')
    expect(shorter).toContain('.drun-btn--gun { left: var(--drun-beside-move); bottom: calc(var(--drun-bottom) + 4px); }')
    expect(shorter).toContain('.drun-btn--reload { left: var(--drun-beside-move); bottom: calc(var(--drun-bottom) + 4px + 56px + 8px); }')
    expect(px(tall, '--drun-stick')).toBe(STICK_PX)
  })

  type Box = { name: string; x0: number; y0: number; x1: number; y1: number }
  /** Every box on a phone at w x h, screen px, from the CSS's sizes and rules (no safe-area insets). */
  function boxes(w: number, h: number): Box[] {
    const isShort = h <= 520, isShorter = h <= 440
    const from = (name: string): number => px(isShorter && !Number.isNaN(px(shorter, name)) ? shorter : isShort && !Number.isNaN(px(short, name)) ? short : tall, name)
    const stick = from('--drun-stick'), fire = from('--drun-fire'), jump = from('--drun-jump')
    const radar = w >= 900 && h >= 600 ? 120 : from('--drun-radar')
    const bottom = 20, top = 12 + 46
    const aboveStick = bottom + 4 + stick + 14
    const aboveSprint = aboveStick + jump + 10
    const b = (name: string, x0: number, y0: number, bw: number, bh: number): Box => ({ name, x0, y0, x1: x0 + bw, y1: y0 + bh })
    const up = (name: string, left: number, fromBottom: number, bw: number, bh: number): Box => b(name, left, h - fromBottom - bh, bw, bh)
    const assist = (stick + fire) / 2
    // The safe zone's line: centred words (its longest line, 37 characters of 14px mono), under the radar on a narrow screen, higher on a short one.
    const promptTop = isShort ? top + 36 : w <= 640 ? top + 38 + radar + 10 : top + 52
    const promptW = Math.min(37 * 14 * 0.6, w - 32)
    const out = [
      b('top row', 16, top, w - 32, 30),
      b('radar', isShorter ? 16 + jump + 12 : 16, top + 38, radar, radar),
      b('safe zone line', (w - promptW) / 2, promptTop, promptW, 44),
      b('crosshair', w / 2 - 13, h / 2 - 13, 26, 26),
      b('assist box', w / 2 - assist / 2, h / 2 - assist / 2, assist, assist),
      up('MOVE', 20, bottom + 4, stick, stick),
      up('LOOK', w - 20 - stick, bottom + 4, stick, stick),
      up('FIRE', w - 16 - fire, aboveStick, fire, fire),
      up('JUMP', w - 16 - fire - 10 - jump, aboveStick, jump, jump),
      up('SPRINT', 16, aboveStick, jump, jump),
    ]
    if (isShorter) {
      out.push(up('gun', 20 + stick + 10, bottom + 4, 150, 56), up('RELOAD', 20 + stick + 10, bottom + 4 + 56 + 8, 110, 36))
    } else if (isShort) {
      out.push(up('gun', 16, aboveSprint, 150, 56), up('RELOAD', 16 + 150 + 8, aboveSprint + 10, 110, 36))
    } else {
      out.push(up('gun', 16, aboveSprint, 150, 56), up('RELOAD', 16, aboveSprint + 64, 110, 36))
    }
    return out
  }
  const overlap = (a: Box, c: Box): boolean => a.x0 < c.x1 && c.x0 < a.x1 && a.y0 < c.y1 && c.y0 < a.y1
  // The assist box is drawn round the crosshair on purpose; the faint box under the safe zone's centred words on a very
  // short screen is the layout before this change (the words are the safe zone's, before a wave).
  const allowed = new Set(['crosshair|assist box', 'safe zone line|assist box'])

  for (const [w, h] of [[375, 812], [412, 915], [812, 375], [800, 360], [640, 320]]) {
    it(`${w}x${h}`, () => {
      const all = boxes(w, h)
      for (const a of all) {
        expect(a.x0, `${a.name} in from the left`).toBeGreaterThanOrEqual(0)
        expect(a.x1, `${a.name} in from the right`).toBeLessThanOrEqual(w)
        expect(a.y0, `${a.name} below the top`).toBeGreaterThanOrEqual(0)
        expect(a.y1, `${a.name} above the bottom`).toBeLessThanOrEqual(h)
      }
      const hits: string[] = []
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const key = `${all[i].name}|${all[j].name}`
          if (!allowed.has(key) && overlap(all[i], all[j])) hits.push(key)
        }
      }
      expect(hits).toEqual([])
      // SPRINT sits above the MOVE stick at the left edge, FIRE's mirror: its left margin is FIRE's right one, on FIRE's
      // row, and the gun button's left edge where it is in that column (a tall screen).
      const find = (n: string): Box => all.find((x) => x.name === n)!
      const sprint = find('SPRINT'), move = find('MOVE'), fire = find('FIRE'), gun = find('gun')
      expect(sprint.y1).toBeLessThanOrEqual(move.y0)
      expect(sprint.x0).toBe(w - fire.x1)
      expect(sprint.y1).toBe(fire.y1)
      expect(sprint.x0).toBeLessThanOrEqual(move.x0)
      expect(sprint.x1).toBeGreaterThan(move.x0)
      if (h > 520) expect(gun.x0).toBe(sprint.x0)
    })
  }
})

describe('a short landscape phone: nothing on the left reaches the radar', () => {
  const css = readFileSync(new URL('../../../../styles.css', import.meta.url), 'utf8')
  /** The body of the `@media (max-height: Npx)` block in the DRONE RUN section. */
  const block = (h: number): string => {
    const from = css.indexOf('/* ---------- DRONE RUN: HUD')
    const at = css.indexOf(`@media (max-height: ${h}px) {`, from)
    expect(at).toBeGreaterThan(from)
    return css.slice(at, css.indexOf('\n}', at))
  }
  const px = (body: string, name: string): number => Number(new RegExp(`${name}: (\\d+)px`).exec(body)?.[1] ?? NaN)

  it('at 812x375, 800x360 and 640x320 the radar ends above the gun button and RELOAD (the sizes the CSS gives)', () => {
    const short = block(520), shorter = block(440)
    const stick = px(short, '--drun-stick'), radar = px(shorter, '--drun-radar')
    expect(radar).toBe(56)
    expect(shorter).toContain('.drun-btn--gun { left: var(--drun-beside-move); bottom: calc(var(--drun-bottom) + 4px); }')
    expect(shorter).toContain('--drun-beside-move: calc(20px + var(--drun-stick) + 10px);')
    // The layout's own numbers: the HUD's top line 12 + 46, the radar 38 under it; the gun button 56 tall, RELOAD 36 above it with 8 between.
    const radarBottom = 12 + 46 + 38 + radar
    for (const [w, h] of [[812, 375], [800, 360], [640, 320]]) {
      const bottom = 20 + 4
      const gunTop = h - bottom - 56
      const reloadTop = h - (bottom + 56 + 8) - 36
      expect(reloadTop).toBeGreaterThan(radarBottom)
      expect(gunTop).toBeGreaterThan(radarBottom)
      // Beside the MOVE stick, inside the screen's left half, and below the aim assist box in the middle.
      expect(20 + stick + 10 + 150).toBeLessThan(w / 2)
      expect(gunTop).toBeGreaterThan(h / 2 + (stick + px(short, '--drun-fire')) / 4)
    }
  })
})

describe('the aim assist box', () => {
  const box = (all: Host[]): Host | undefined => all.find((h) => cls(h).split(' ').includes('drun-assist'))

  it('its side is between FIRE and the MOVE stick, from the same variables in the CSS', () => {
    expect(ASSIST_PX).toBeGreaterThan(FIRE_PX)
    expect(ASSIST_PX).toBeLessThan(STICK_PX)
    const css = readFileSync(new URL('../../../../styles.css', import.meta.url), 'utf8')
    expect(css).toContain('--drun-assist: calc((var(--drun-stick) + var(--drun-fire)) / 2);')
    expect(css).toContain(`--drun-stick: ${STICK_PX}px;`)
    expect(css).toContain(`--drun-fire: ${FIRE_PX}px;`)
    expect(css).toContain(`--drun-jump: ${JUMP_PX}px;`)
    expect(css).toMatch(/\.drun-assist \{[^}]*width: var\(--drun-assist\);/)
  })

  it('shows on a phone with the PULSE RIFLE, and tells the assist half its side', async () => {
    const m = await mount(createElement(HudView, props({ phase: 'wave', weapon: 0 }, { touch: true })))
    const b = box(m.all())!
    expect(cls(b)).toBe('drun-assist')
    const last = assistCalls[assistCalls.length - 1]!
    expect(last).toBeGreaterThan(FIRE_PX / 2)
    expect(last).toBeLessThan(STICK_PX / 2)
    await m.unmount()
    expect(assistCalls[assistCalls.length - 1]).toBeNull()
  })

  it('hidden (in place) with another gun or a card up; not drawn on a desktop; the assist told null', async () => {
    for (const over of [{ phase: 'wave' as const, weapon: 1 }, { phase: 'wave' as const, weapon: 2 }, { phase: 'failed' as const, weapon: 0 }, { phase: 'cleared' as const, weapon: 0 }]) {
      assistCalls.length = 0
      const m = await mount(createElement(HudView, props(over, { touch: true })))
      expect(cls(box(m.all())!)).toBe('drun-assist is-off')
      expect(assistCalls.every((c) => c === null)).toBe(true)
      expect(assistCalls.length).toBeGreaterThan(0)
      await m.unmount()
    }
    assistCalls.length = 0
    const desk = await mount(createElement(HudView, props({ phase: 'wave', weapon: 0 }, { touch: false })))
    expect(box(desk.all())).toBeUndefined()
    expect(assistCalls.filter((c) => c !== null)).toEqual([])
    await desk.unmount()
  })

  it('follows the gun\'s own assist flag, not its place in the list', async () => {
    // A variant whose assist gun is the second.
    const moved = BASE_WEAPONS.map((w, i) => ({ ...w, assist: i === 1 ? 'auto' as const : null }))
    const second = await mount(createElement(HudView, props({ phase: 'wave', weapon: 1 }, { touch: true, weapons: moved })))
    expect(cls(box(second.all())!)).toBe('drun-assist')
    await second.unmount()
    const first = await mount(createElement(HudView, props({ phase: 'wave', weapon: 0 }, { touch: true, weapons: moved })))
    expect(cls(box(first.all())!)).toBe('drun-assist is-off')
    await first.unmount()
    expect(assistShown(true, { phase: 'wave', weapon: 1 }, moved)).toBe(true)
    expect(assistShown(true, { phase: 'wave', weapon: 0 }, moved)).toBe(false)
    expect(assistShown(true, { phase: 'wave', weapon: 5 }, moved)).toBe(false)
  })

  it('hidden while the game is exiting, and while the last pointer was not a finger', async () => {
    expect(assistShown(true, { phase: 'wave', weapon: 0 }, BASE_WEAPONS, true)).toBe(false)
    expect(assistShown(false, { phase: 'wave', weapon: 0 }, BASE_WEAPONS)).toBe(false)
    for (const more of [{ exiting: true }, { fingers: false }]) {
      assistCalls.length = 0
      const m = await mount(createElement(HudView, props({ phase: 'wave', weapon: 0 }, { touch: true, ...more })))
      expect(cls(box(m.all())!)).toBe('drun-assist is-off')
      expect(assistCalls.filter((c) => c !== null)).toEqual([])
      await m.unmount()
    }
  })

  it('measures itself as drawn: a new size is a new half side', async () => {
    const g = globalThis as unknown as Record<string, unknown>
    const had = g.ResizeObserver
    let cb: ((entries: Array<{ contentRect: { width: number } }>) => void) | null = null
    const observed: unknown[] = []
    g.ResizeObserver = class { constructor(f: typeof cb) { cb = f } observe(el: unknown) { observed.push(el) } disconnect() { cb = null } }
    const m = await mount(createElement(AssistBox, { shown: true }))
    expect(observed.length).toBe(1)
    cb!([{ contentRect: { width: 98 } }])
    expect(assistCalls[assistCalls.length - 1]).toBe(49)
    await m.unmount()
    expect(cb).toBeNull()
    expect(assistCalls[assistCalls.length - 1]).toBeNull()
    if (had === undefined) delete g.ResizeObserver; else g.ResizeObserver = had
  })
})
