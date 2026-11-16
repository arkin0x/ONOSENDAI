/**
 * hud.test.tsx - DRONE RUN's HUD (game/droneRun/hud): every phase draws the
 * same fixed slots, so nothing moves between them (owner: no layout jumps);
 * the cards' buttons call RESTART, NEXT WAVE and EXIT GAME, and Enter or R
 * press the first; each gun shows its own gauge; the phone's buttons write
 * the controls, three and four fingers at once; the aim assist box shows
 * only on a phone with the PULSE RIFLE and tells the assist its size; the
 * run's events play their sounds and restart the pulses.
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

import { createElement } from 'react'
import { mount, textOf, type Host } from '../../../../test/elementRoot'
import { HudView, type HudViewProps } from '../HudView'
import { DroneRunHud, reactTo } from '../DroneRunHud'
import { TouchPad } from '../TouchPad'
import { ASSIST_PX, BASE_WEAPONS, COPY, FIRE_PX, IDLE_HUD, JUMP_PX, STICK_PX, assistShown, weaponsOfHud, type HudState } from '../model'
import { AssistBox } from '../AssistBox'
import { lookState, lookStickRate, readInput, resetInput, tickLook } from '../../input'
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
const SLOTS = ['drun-top', 'drun-pips', 'drun-wave', 'drun-left', 'drun-clock', 'drun-sound', 'drun-prompt', 'drun-prompt__title', 'drun-prompt__line', 'drun-cross', 'drun-bottom', 'drun-gun', 'drun-gun__name', 'drun-gauge', 'drun-gauge__status', 'drun-hints', 'drun-stick', 'drun-btn', 'drun-radar', 'drun-assist']
function slots(all: Host[]): string[] {
  return all.flatMap((h) => cls(h).split(' ').filter((c) => SLOTS.includes(c) || c.startsWith('drun-btn--') || c.startsWith('drun-stick--'))).sort()
}

beforeEach(() => { resetInput(0, 0); played.length = 0; assistCalls.length = 0 })
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
    const on = (h: Host, name: string, e: Record<string, unknown>): void => (h.props[name] as Handler)({ pointerType: 'touch', preventDefault: () => {}, stopPropagation: () => {}, currentTarget: { clientWidth: W, setPointerCapture: () => {} }, ...e })
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
    touch('onPointerDown', 1, MOVE.cx, MOVE.cy - 60)
    touch('onPointerDown', 2, LOOK.cx + 40, LOOK.cy)
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
    touch('onPointerDown', 2, LOOK.cx - 40, LOOK.cy)
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
    touch('onPointerDown', 1, MOVE.cx, MOVE.cy - 60)
    touch('onPointerDown', 2, LOOK.cx + 60, LOOK.cy)
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
    touch('onPointerDown', 8, MOVE.cx, MOVE.cy - 60)
    touch('onPointerDown', 9, LOOK.cx + 60, LOOK.cy)
    button('fire', 'onPointerDown', 10)
    winEvents.dispatchEvent(new Event('blur'))
    const y2 = lookState.yaw
    tickLook(0.1)
    const b = readInput()
    expect(b.move).toEqual({ fwd: 0, strafe: 0 })
    expect(b.fire).toBe(false)
    expect(b.yaw).toBe(y2)
    // The controls take new fingers after.
    touch('onPointerDown', 11, MOVE.cx, MOVE.cy - 60)
    expect(readInput().move.fwd).toBeCloseTo(1)
    await m.unmount()
  })
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
    const short = block(520), shorter = block(380)
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
