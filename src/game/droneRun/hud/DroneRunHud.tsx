/**
 * DroneRunHud.tsx - DRONE RUN's HUD, controls and sounds on the game screen.
 *
 * It lays a view layer over the canvas that takes the presses meant for the
 * game: on a desktop a press locks the pointer (input.ts attachDesktop), and
 * on a phone the touches that land on no button drive the stick (left half)
 * or the look (right half). Over it the HUD (HudView) and, on a phone, the
 * controls (TouchPad). The game bar (name, EXIT GAME) stays above all of it.
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
import { attachDesktop, noteWeapons, pointer, releasePointer, setInputPaused, TouchTracker } from '../input'
import { HudView, type Pulses } from './HudView'
import { TouchPad } from './TouchPad'
import { IDLE_HUD, weaponsOfHud, type HudState, type HudWeapon } from './model'
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
  const baseRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLSpanElement>(null)
  const card = hud.phase === 'failed' || hud.phase === 'cleared'
  const leave = exit ?? ((): void => { void useGame.getState().exit() })

  // The stick's centre and reach, read from where it is drawn.
  const tracker = useMemo(() => new TouchTracker(() => {
    const r = baseRef.current?.getBoundingClientRect()
    return r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: r.width / 2 } : { cx: 80, cy: 0, radius: 56 }
  }), [])
  const drawKnob = (): void => {
    const k = knobRef.current
    if (k) k.style.transform = `translate(${tracker.knob.dx}px, ${tracker.knob.dy}px)`
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

  useEffect(() => { noteWeapons(weapons.length, hud.weapon) }, [weapons.length, hud.weapon])

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
    if (took === 'stick') drawKnob()
  }
  const onTouchMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType !== 'touch') return
    tracker.move(e.pointerId, e.clientX, e.clientY)
    if (tracker.holding.stick === e.pointerId) drawKnob()
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
      {touch && <TouchPad hud={hud} weapons={weapons} baseRef={baseRef} knobRef={knobRef} />}
    </div>
  )
}

type DesktopDoc = Parameters<typeof attachDesktop>[0]['doc']

/**
 * The HUD on the game screen, from the runner (runner.ts): its store, its
 * events, RESTART and NEXT WAVE. Until the run is made (the world loading)
 * it shows the safe zone at full health, so nothing jumps when it starts.
 */
export function DroneRunHudMount(): JSX.Element {
  const hud = useDroneRunHud()
  return <DroneRunHud hud={hud.maxHp > 0 ? hud : IDLE_HUD} restart={restartRun} nextWave={nextWaveRun} subscribe={onDroneRunEvent} />
}
