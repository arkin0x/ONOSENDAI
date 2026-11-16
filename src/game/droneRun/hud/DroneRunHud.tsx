/**
 * DroneRunHud.tsx - DRONE RUN's HUD, controls and sounds on the game screen.
 *
 * It lays a view layer over the canvas that takes the presses meant for the
 * game: on a desktop a press locks the pointer (input.ts attachDesktop), and
 * on a phone the touches that land on no button drive the MOVE stick (left
 * half), the LOOK stick (on it) or the look drag (the rest of the right
 * half), each finger by its pointer id (input.ts TouchTracker). Over it the
 * HUD (HudView) and, on a phone, the controls (TouchPad). The game bar
 * (name, EXIT GAME) stays above all of it.
 *
 * On a phone it turns the view each screen frame by the LOOK stick's rate
 * (input.ts tickLook).
 *
 * It also:
 * - plays the sounds from the run's events (audio.ts), and flashes the
 *   screen's edges on a hit taken and the hit marker on a hit landed;
 * - while a card is up (RUN FAILED, WAVE n CLEAR) lets the mouse go, stops
 *   the game reading the controls, and takes Enter and R for the card's
 *   first button (RESTART, NEXT WAVE);
 * - tells the controls how many guns there are and which is in hand, so
 *   Q, the wheel and the gun button go to the next one.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { RunEvent } from '../../../lib/games/droneRun/sim/events'
import { useGame } from '../../../store/useGame'
import { useSoundMutes } from '../../../store/useSoundMutes'
import { playSound, toggleDroneRunSound, useDroneRunSound, warmSound } from '../audio'
import { attachDesktop, noteWeapons, pointer, releaseAll, releasePointer, setInputPaused, tickLook, TouchTracker, type StickPlace } from '../input'
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

function usePointerLocked(): boolean {
  return useSyncExternalStore(
    (l) => { pointer.listeners.add(l); return () => { pointer.listeners.delete(l) } },
    () => pointer.locked,
    () => false,
  )
}

/** What an event does on screen and in the speakers: the sound it plays, and which pulse it restarts. */
export function reactTo(e: RunEvent): { sound: Parameters<typeof playSound>[0] | null; weapon?: number; pulse?: keyof Pulses } {
  switch (e.type) {
    case 'shot': return { sound: 'shot', weapon: e.weapon }
    case 'hit': return { sound: 'hit', pulse: 'hit' }
    case 'drone-destroyed': return { sound: 'pop' }
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
  const listed = useMemo(() => weaponsOfHud(hud), [hud.weaponNames, hud.weaponKinds, hud.weaponCharges])
  const weapons = given ?? listed
  const locked = usePointerLocked()
  const muted = useDroneRunSound((s) => s.muted) || useSoundMutes((s) => s.master)
  const exiting = useGame((s) => s.busy === 'exiting')
  const [pulses, setPulses] = useState<Pulses>({ hurt: 0, hit: 0 })
  const layer = useRef<HTMLDivElement>(null)
  const move = { base: useRef<HTMLDivElement>(null), knob: useRef<HTMLSpanElement>(null) }
  const look = { base: useRef<HTMLDivElement>(null), knob: useRef<HTMLSpanElement>(null) }
  const touchRef = useRef(touch)
  touchRef.current = touch
  const card = hud.phase === 'failed' || hud.phase === 'cleared'
  const leave = exit ?? ((): void => { void useGame.getState().exit() })

  // The sticks' centres and reach, read from where they are drawn (before that, from the layout's default places).
  const tracker = useMemo(() => new TouchTracker(
    () => placeOf(move.base.current) ?? defaultPlace('move'),
    { look: () => (touchRef.current ? placeOf(look.base.current) ?? defaultPlace('look') : null) },
  ), [])
  const drawKnob = (): void => {
    const k = move.knob.current
    if (k?.style) k.style.transform = `translate(${tracker.knob.dx}px, ${tracker.knob.dy}px)`
    const l = look.knob.current
    if (l?.style) l.style.transform = `translate(${tracker.lookKnob.dx}px, ${tracker.lookKnob.dy}px)`
  }

  // The keyboard and the mouse, while the screen is up.
  useEffect(() => {
    const el = layer.current
    // A renderer with no DOM (tests) hands no element to listen on.
    if (!el || typeof el.addEventListener !== 'function' || typeof document === 'undefined') return
    return attachDesktop({ el, win: window, doc: document as DesktopDoc }, { onMute: toggleDroneRunSound, onGesture: warmSound })
  }, [])

  // A card up: the mouse goes free, the controls rest, every finger lets go.
  useEffect(() => {
    setInputPaused(card)
    setRunPaused(card)
    if (card) { releasePointer(); tracker.clear(); drawKnob() }
  }, [card])
  useEffect(() => () => { setInputPaused(false) }, [])

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
      if (hud.phase === 'failed') restart(); else nextWave()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [card, hud.phase, restart, nextWave])

  // Sounds and pulses from the run's events.
  useEffect(() => subscribe((e) => {
    const r = reactTo(e)
    if (r.sound) playSound(r.sound, r.weapon ?? 0)
    if (r.pulse) { const k = r.pulse; setPulses((p) => ({ ...p, [k]: p[k] + 1 })) }
  }), [subscribe])

  const onTouchDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType !== 'touch' || card) return
    warmSound()
    const took = tracker.down(e.pointerId, e.clientX, e.clientY, e.currentTarget.clientWidth || window.innerWidth)
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
        locked={locked}
        muted={muted}
        exiting={exiting}
        pulses={pulses}
        onRestart={restart}
        onNextWave={nextWave}
        onExit={leave}
        onToggleSound={toggleDroneRunSound}
      />
      {touch && <TouchPad hud={hud} weapons={weapons} move={move} look={look} />}
    </div>
  )
}

type DesktopDoc = Parameters<typeof attachDesktop>[0]['doc']

/** A stick's centre and reach from its ring as drawn, or null before it is drawn (or with no DOM). */
function placeOf(el: HTMLElement | null): StickPlace | null {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null
  const r = el.getBoundingClientRect()
  return r.width > 0 ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: r.width / 2 } : null
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
