/**
 * DroneRunHud.tsx - DRONE RUN's HUD, controls and sounds on the game screen.
 *
 * It lays a view layer over the canvas that takes the presses meant for the
 * game: on a desktop a press locks the pointer (input.ts attachDesktop), and
 * on a phone the touches that land on no button drive the floating MOVE
 * stick (left half), the floating LOOK stick (right half) or, with a second
 * finger on the right, the look drag, each finger by its pointer id (input.ts
 * TouchTracker). It draws each stick's ring where its finger landed and puts
 * it back on lift. Over it the HUD (HudView) and, on a phone, the controls
 * (TouchPad). The game bar (name, EXIT GAME) stays above all of it.
 *
 * On a phone it turns the view each screen frame by the LOOK stick's rate
 * (input.ts tickLook), and while the rail charges (FIRE held with a charge
 * gun in hand and switched in, not overheated, no card up) it switches the MOVE stick to aim
 * (TouchTracker.setAim): the steps read no movement and the LOOK stick
 * hides; FIRE let go, another gun, a card or the page losing focus (which
 * lets go of FIRE) switch it back.
 *
 * It also:
 * - plays the sounds from the run's events (audio.ts) and the clicks in the
 *   player's head (clicks.ts: the hitmarker, the kill, an aimed pull sent
 *   wide), and flashes the screen's edges on a hit taken and the hit marker
 *   on a hit landed (larger and gold on the kill);
 * - plays each control's press sound (clicks.ts): the presses input.ts
 *   tells (controls$), the cards' buttons and the sound switch;
 * - while a card is up (RUN FAILED, WAVE n CLEAR) lets the mouse go, stops
 *   the game reading the controls, pauses the run (so the aim assist asks
 *   nothing) and takes Enter and R for the card's first button (RESTART,
 *   NEXT WAVE);
 * - shows the aim assist box only while the last pointer was a finger and
 *   the game is not exiting (model.ts assistShown);
 * - tells the controls how many guns there are and which is in hand, so
 *   Q, the wheel and the gun button go to the next one.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { RunEvent } from '../../../lib/games/droneRun/sim/events'
import { useGame } from '../../../store/useGame'
import { useSoundMutes } from '../../../store/useSoundMutes'
import { playSound, toggleDroneRunSound, useDroneRunSound, warmSound } from '../audio'
import { playClick, type Click } from '../clicks'
import { attachDesktop, controls$, held$, noteWeapons, type ControlPress, padFiring, pointer, releaseAll, releasePointer, setAiming, setInputPaused, sprintHeld, sprintLatched, tickLook, TouchTracker, type Pt, type StickPlace } from '../input'
import { HudView, type Pulses } from './HudView'
import { TouchPad } from './TouchPad'
import { IDLE_HUD, STICK_PX, weaponsOfHud, type HudState, type HudWeapon } from './model'
import { nextWaveRun, onDroneRunEvent, restartRun, setRunPaused, useDroneRunHud } from '../runner'

export interface DroneRunHudProps {
  hud: HudState
  /** The guns as the HUD shows them; from the HUD's own lists when absent. */
  weapons?: HudWeapon[]
  restart: () => void
  nextWave: () => void
  /** The run's events, each step's in order (runner.ts onDroneRunEvent); returns the unsubscribe. */
  subscribe: (cb: (e: RunEvent) => void) => () => void
  /** EXIT GAME on a card; the game session's exit when absent. */
  exit?: () => void
  /** Force the phone's controls on or off (tests, screenshots); by the pointer otherwise. */
  touch?: boolean
}

/** A phone or a tablet: the main pointer is a finger. */
function coarsePointer(): boolean {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches } catch { return false }
}

/**
 * Whether the last pointer on the page was a finger: true until a pointer
 * says otherwise on a touch screen; a mouse, a pen or a trackpad (an iPad
 * with one) makes it false, the next touch true again. Watched on the
 * window, before anything else handles the event. Off a touch screen, false.
 */
export function useLastPointerFinger(touch: boolean): boolean {
  const [finger, setFinger] = useState(true)
  const last = useRef(true)
  useEffect(() => {
    if (!touch || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    const seen = (e: PointerEvent): void => {
      const now = e.pointerType === 'touch'
      if (now !== last.current) { last.current = now; setFinger(now) }
    }
    const opts = { capture: true, passive: true }
    window.addEventListener('pointerdown', seen, opts)
    window.addEventListener('pointermove', seen, opts)
    return () => { window.removeEventListener('pointerdown', seen, opts); window.removeEventListener('pointermove', seen, opts) }
  }, [touch])
  return touch && finger
}

/** Whether `get` holds, re-read whenever FIRE or SPRINT goes down or up (input.ts held$). */
function useHeld(get: () => boolean): boolean {
  return useSyncExternalStore(
    (l) => { held$.listeners.add(l); return () => { held$.listeners.delete(l) } },
    get,
    () => false,
  )
}

/**
 * Whether the MOVE stick aims: a phone, no card up, a charge gun (the rail)
 * in hand, ready (not still switching in) and not overheated, and a finger
 * on FIRE. The rail fires on release, so FIRE let go is the shot (or the
 * fizzle). While it switches in it cannot charge, so the stick still moves.
 */
export function aimShown(touch: boolean, card: boolean, padFire: boolean, hud: Pick<HudState, 'weapon' | 'overheated' | 'switching'>, weapons: readonly HudWeapon[]): boolean {
  return touch && !card && padFire && !hud.overheated && !hud.switching && weapons[hud.weapon]?.gauge === 'charge'
}

function usePointerLocked(): boolean {
  return useSyncExternalStore(
    (l) => { pointer.listeners.add(l); return () => { pointer.listeners.delete(l) } },
    () => pointer.locked,
    () => false,
  )
}

/**
 * What an event does on screen and in the speakers: the sound it plays, the
 * click in the player's head (clicks.ts: the hitmarker, the kill, an aimed
 * pull sent wide), and which pulse it restarts (the hit marker, its kill
 * look, the red flash).
 */
export function reactTo(e: RunEvent): { sound: Parameters<typeof playSound>[0] | null; click?: Click; weapon?: number; pulse?: 'hurt' | 'hit' | 'kill' } {
  switch (e.type) {
    case 'shot': return e.wide ? { sound: 'shot', weapon: e.weapon, click: 'miss' } : { sound: 'shot', weapon: e.weapon }
    case 'hit': return { sound: null, click: 'hit', pulse: 'hit' }
    case 'drone-destroyed': return { sound: null, click: 'kill', pulse: 'kill' }
    case 'player-hit': return { sound: 'hurt', pulse: 'hurt' }
    case 'overheated': return { sound: 'overheat' }
    case 'reloaded': return { sound: 'reload' }
    case 'wave-started': return { sound: 'wave' }
    case 'cleared': return { sound: 'clear' }
    case 'failed': return { sound: 'fail' }
    default: return { sound: null }
  }
}

export function DroneRunHud({ hud, weapons: given, restart, nextWave, subscribe, exit, touch: forceTouch }: DroneRunHudProps): JSX.Element {
  const touch = forceTouch ?? coarsePointer()
  const fingers = useLastPointerFinger(touch)
  const listed = useMemo(() => weaponsOfHud(hud), [hud.weaponNames, hud.weaponKinds, hud.weaponCharges, hud.weaponAssists])
  const weapons = given ?? listed
  const locked = usePointerLocked()
  // Both hooks every render (a short-circuit would skip the second once the first is on, and React needs the same hooks each time).
  const gameMuted = useDroneRunSound((s) => s.muted)
  const allMuted = useSoundMutes((s) => s.master)
  const muted = gameMuted || allMuted
  const exiting = useGame((s) => s.busy === 'exiting')
  const [pulses, setPulses] = useState<Pulses>({ hurt: 0, hit: 0, kill: 0 })
  const layer = useRef<HTMLDivElement>(null)
  const move = { base: useRef<HTMLDivElement>(null), knob: useRef<HTMLSpanElement>(null) }
  const look = { base: useRef<HTMLDivElement>(null), knob: useRef<HTMLSpanElement>(null) }
  const touchRef = useRef(touch)
  touchRef.current = touch
  const card = hud.phase === 'failed' || hud.phase === 'cleared'
  const padFire = useHeld(padFiring)
  const sprinting = useHeld(sprintHeld)
  const sprintOn = useHeld(sprintLatched)
  const aiming = aimShown(touch, card, padFire, hud, weapons)
  /** How far each ring is moved from its resting place now, px (so its resting place can be read back from where it is drawn). */
  const shifted = useRef({ move: { x: 0, y: 0 }, look: { x: 0, y: 0 } })
  const exitGame = exit ?? ((): void => { void useGame.getState().exit() })
  // The cards' buttons and the sound switch, each with its press sound (clicks.ts).
  const leave = (): void => { playClick('ui:exit'); exitGame() }
  const again = (): void => { playClick('ui:restart'); restart() }
  const onward = (): void => { playClick('ui:nextWave'); nextWave() }
  /** The sound switch: going on, its two notes (going off, it is silent already). */
  const toggleSound = (): void => { toggleDroneRunSound(); playClick('ui:sound') }
  const toggleRef = useRef(toggleSound)
  toggleRef.current = toggleSound

  // The sticks' resting places and reach, read from where they are drawn (before that, from the layout's default places).
  const tracker = useMemo(() => new TouchTracker(
    () => placeOf(move.base.current, shifted.current.move) ?? defaultPlace('move'),
    { look: () => (touchRef.current ? placeOf(look.base.current, shifted.current.look) ?? defaultPlace('look') : null) },
  ), [])
  /** Each stick's ring where its finger landed (or at rest), and its knob. */
  const drawKnob = (): void => {
    drawStick(move.base.current, move.knob.current, tracker.ring, tracker.knob, shifted.current.move, defaultPlace('move'))
    drawStick(look.base.current, look.knob.current, tracker.lookRing, tracker.lookKnob, shifted.current.look, defaultPlace('look'))
  }

  // The keyboard and the mouse, while the screen is up.
  useEffect(() => {
    const el = layer.current
    // A renderer with no DOM (tests) hands no element to listen on.
    if (!el || typeof el.addEventListener !== 'function' || typeof document === 'undefined') return
    return attachDesktop({ el, win: window, doc: document as DesktopDoc }, { onMute: () => toggleRef.current(), onGesture: warmSound })
  }, [])

  // A card up: the mouse goes free, the controls rest, every finger lets go.
  useEffect(() => {
    setInputPaused(card)
    setRunPaused(card)
    if (card) { releasePointer(); tracker.clear(); drawKnob() }
  }, [card])
  useEffect(() => () => { setInputPaused(false); setAiming(false) }, [])

  // The rail charging: the MOVE stick aims and the LOOK stick rests; a finger already down is re-centred where it is.
  useEffect(() => {
    tracker.setAim(aiming)
    drawKnob()
  }, [aiming])

  // Away from the page (an app switch on a phone, a hidden tab): every finger lets go, so the stick and the look take
  // the next touch, even when the old touches never sent their pointerup.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const letGo = (): void => { tracker.clear(); releaseAll(); drawKnob() }
    const hidden = (): void => { if (document.visibilityState === 'hidden') letGo() }
    window.addEventListener('blur', letGo)
    document.addEventListener('visibilitychange', hidden)
    return () => { window.removeEventListener('blur', letGo); document.removeEventListener('visibilitychange', hidden) }
  }, [])

  useEffect(() => { noteWeapons(weapons.length, hud.weapon) }, [weapons.length, hud.weapon])

  // The LOOK stick turns the view each screen frame, at its rate.
  useEffect(() => {
    if (!touch || typeof requestAnimationFrame !== 'function') return
    let last = -1
    let id = 0
    const frame = (t: number): void => {
      if (last >= 0) tickLook((t - last) / 1000)
      last = t
      id = requestAnimationFrame(frame)
    }
    id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
  }, [touch])

  // Enter or R presses the card's first button.
  useEffect(() => {
    if (!card) return
    const key = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (e.code === 'Enter' && (e.target as HTMLElement | null)?.closest?.('button')) return
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'KeyR') return
      e.preventDefault()
      if (hud.phase === 'failed') again(); else onward()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [card, hud.phase, restart, nextWave])

  // Each control's press sound (input.ts controls$: FIRE, JUMP, a gun, RELOAD, sprint on and off, the lockout).
  useEffect(() => {
    const press = (c: ControlPress): void => { playClick(`ui:${c}`) }
    controls$.listeners.add(press)
    return () => { controls$.listeners.delete(press) }
  }, [])

  // Sounds and pulses from the run's events. A hit's tick takes the gun of the shot before it (a step lists the shot first).
  useEffect(() => {
    let gun = 0
    return subscribe((e) => {
      const r = reactTo(e)
      if (e.type === 'shot') gun = e.weapon
      if (r.sound) playSound(r.sound, r.weapon ?? 0)
      if (r.click) playClick(r.click, gun)
      if (r.pulse === 'hurt') setPulses((p) => ({ ...p, hurt: p.hurt + 1 }))
      else if (r.pulse === 'hit') setPulses((p) => ({ ...p, hit: p.hit + 1 }))
      else if (r.pulse === 'kill') setPulses((p) => ({ ...p, hit: p.hit + 1, kill: p.hit + 1 }))
    })
  }, [subscribe])

  const onTouchDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType !== 'touch' || card) return
    warmSound()
    const took = tracker.down(e.pointerId, e.clientX, e.clientY, e.currentTarget.clientWidth || window.innerWidth, e.currentTarget.clientHeight || window.innerHeight)
    if (!took) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* fine */ }
    if (took !== 'look') drawKnob()
  }
  const onTouchMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType !== 'touch') return
    tracker.move(e.pointerId, e.clientX, e.clientY)
    if (tracker.holdsStick(e.pointerId)) drawKnob()
  }
  const onTouchUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType !== 'touch') return
    tracker.up(e.pointerId)
    drawKnob()
  }

  return (
    <div className={`drun-hud${card ? ' is-card' : ''}`}>
      <div
        ref={layer}
        className="drun-layer"
        aria-hidden
        onPointerDown={onTouchDown}
        onPointerMove={onTouchMove}
        onPointerUp={onTouchUp}
        onPointerCancel={onTouchUp}
        onLostPointerCapture={onTouchUp}
      />
      <HudView
        hud={hud}
        weapons={weapons}
        touch={touch}
        fingers={fingers}
        locked={locked}
        muted={muted}
        exiting={exiting}
        pulses={pulses}
        onRestart={again}
        onNextWave={onward}
        onExit={leave}
        onToggleSound={toggleSound}
      />
      {touch && <TouchPad hud={hud} weapons={weapons} move={move} look={look} aiming={aiming} sprintHeld={sprinting} sprintLatched={sprintOn} />}
    </div>
  )
}

type DesktopDoc = Parameters<typeof attachDesktop>[0]['doc']

/** A stick's resting centre and reach from its ring as drawn (less how far it is moved now), or null before it is drawn (or with no DOM). */
function placeOf(el: HTMLElement | null, moved: Pt = { x: 0, y: 0 }): StickPlace | null {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null
  const r = el.getBoundingClientRect()
  return r.width > 0 ? { cx: r.left + r.width / 2 - moved.x, cy: r.top + r.height / 2 - moved.y, radius: r.width / 2 } : null
}

/**
 * Draws one stick: its ring moved from its resting place to `ring` (or back
 * when null), its knob at `knob` from the ring's centre. `moved` is kept up
 * to date with how far the ring is moved.
 */
export function drawStick(base: HTMLElement | null, knobEl: HTMLElement | null, ring: Pt | null, knob: { dx: number; dy: number }, moved: Pt, fallback: StickPlace): void {
  if (base?.style) {
    if (ring) {
      const rest = placeOf(base, moved) ?? fallback
      moved.x = ring.x - rest.cx
      moved.y = ring.y - rest.cy
      base.style.transform = `translate(${moved.x}px, ${moved.y}px)`
    } else {
      moved.x = 0
      moved.y = 0
      base.style.transform = ''
    }
  }
  if (knobEl?.style) knobEl.style.transform = `translate(${knob.dx}px, ${knob.dy}px)`
}

/** Where a stick stands by the layout's defaults (styles.css: 20px in from the side, 24px up, STICK_PX across). */
export function defaultPlace(which: 'move' | 'look'): StickPlace {
  const w = typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 375
  const h = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 812
  const r = STICK_PX / 2
  return { cx: which === 'move' ? 20 + r : w - 20 - r, cy: h - 24 - r, radius: r }
}

/**
 * The HUD on the game screen, from the runner (runner.ts): its store, its
 * events, RESTART and NEXT WAVE. Until the run is made (the world loading)
 * it shows the safe zone at full health, so nothing jumps when it starts.
 */
export function DroneRunHudMount(): JSX.Element {
  const hud = useDroneRunHud()
  return <DroneRunHud hud={hud.maxHp > 0 ? hud : IDLE_HUD} restart={restartRun} nextWave={nextWaveRun} subscribe={onDroneRunEvent} />
}
