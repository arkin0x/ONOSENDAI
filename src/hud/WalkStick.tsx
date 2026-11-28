/**
 * WalkStick.tsx - WALK's and TERRAIN's stick for a phone's left thumb, in
 * place of the FORWARD, BACK and side keys (owner, 2026-11-28: "design a
 * great ux ui joystick to replace the directional buttons on the left side
 * ... Where you start touching is where the amount comes from ... joystick
 * is only on the left for planar movement; vertical movement belongs to
 * the buttons on the right").
 *
 * | Part | What it does |
 * |---|---|
 * | the zone (.walkstick) | an invisible box over the lower left of the scene, under every button (z 99): a finger landing in it takes the stick; a finger landing on a button, the LOOK ball or the scene elsewhere never does |
 * | the centre | where the finger lands (lib/walkStick.ts): it starts at no movement, wherever it lands |
 * | the ring and the knob | drawn where the finger landed (kept on screen), fading in; the knob follows the finger, kept inside the ring; past the ring the ring trails the finger (followCentre), so pulling back reverses at once |
 * | the direction mark | an arc on the ring: the way the stick walks, snapped to the 8 directions the step WALK takes, or as pushed in fluid WALK; as bright as the push |
 * | let go | the ring fades out, the walk stops (store/walkHold.ts stickHold) |
 * | at rest (.walkstick-home, in the walk pad's box) | a faint ring where the walk pad stood, with MOVE in it: where to put a thumb. Hidden while the stick is held |
 * | a mouse or keys (hooks/useFingerInput.ts) | no zone; the home box prints W A S D instead, as every control prints its key |
 * | the newcomer view | veiled with the walk keys it replaced (pad.arrows): hidden, it takes no touch |
 * | haptics | a light tick (navigator.vibrate, where there is one: not on an iPhone) when the finger lands and when the push leaves the dead zone |
 *
 * Only one finger takes the stick; it keeps it wherever it slides until it
 * lifts (pointer capture), so a thumb walking off the zone keeps walking.
 * Every other finger is its own: JUMP, DOWN, GRAVITY, PLACE, SMASH, the
 * LOOK ball and the scene's look drag all work while the stick is held.
 * The ring moves by style writes, never a render, so a drag costs nothing.
 * Under reduced motion nothing fades (styles.css).
 */

import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { StickTracker, type StickState } from '../lib/walkStick'
import { stickHold } from '../store/walkHold'
import { fluidOn } from '../store/fluidSwitch'
import { buzzGate } from '../lib/buzz'
import { noCallout } from '../hooks/useRepeatable'

/** The knob's reach from the centre, CSS px: the push is 1 at this distance (a 112px ring, the walk pad's box). */
export const STICK_REACH = 48
/** The ring's drawn half-width, CSS px. */
const RING_HALF = 56
/** How far inside the screen's edges the ring is kept, CSS px. */
const RING_MARGIN = 4
/** A light tick, ms of vibration. */
const TICK_MS = 8

/** The ring's chamfered outline (an octagon, flat sides square to the screen) in its 120-unit box. */
const OCTAGON = (() => {
  const r = 56
  const pts: string[] = []
  for (let k = 0; k < 8; k++) {
    const a = ((22.5 + 45 * k) * Math.PI) / 180
    pts.push(`${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`)
  }
  return pts.join(' ')
})()

/** The ring's drawing: chamfered outline, the 8 directions' notches, the dead zone's dot, and the direction arc (rotated by --stick-a). */
function Ring(): JSX.Element {
  const notch = (k: number): JSX.Element => {
    const a = (k * 45 * Math.PI) / 180
    const long = k % 2 === 0
    const r0 = long ? 41 : 44
    return <line key={k} className={long ? 'walkstick__notch is-axis' : 'walkstick__notch'} x1={r0 * Math.cos(a)} y1={r0 * Math.sin(a)} x2={49 * Math.cos(a)} y2={49 * Math.sin(a)} />
  }
  return (
    <svg className="walkstick__ring" viewBox="-60 -60 120 120" aria-hidden>
      <polygon className="walkstick__plate" points={OCTAGON} />
      <circle className="walkstick__track" r={49} />
      {Array.from({ length: 8 }, (_, k) => notch(k))}
      <circle className="walkstick__dead" r={STICK_REACH * 0.12 + 2} />
      <g className="walkstick__dir">
        <path d="M 46.6 -17 A 49.6 49.6 0 0 1 46.6 17" />
      </g>
    </svg>
  )
}

/** The knob: a small chamfered plate with a bright centre. */
function Knob(): JSX.Element {
  return (
    <svg className="walkstick__knobface" viewBox="-24 -24 48 48" aria-hidden>
      <polygon points="-9,-21 9,-21 21,-9 21,9 9,21 -9,21 -21,9 -21,-9" />
      <circle r={4} />
    </svg>
  )
}

/**
 * What stands in the walk pad's box: the faint ring at rest (fingers), or
 * W A S D (a mouse or keys). `held`: the stick is held, so the rest ring
 * steps back.
 */
export function WalkStickHome({ finger, held, terrain }: { finger: boolean; held: boolean; terrain: boolean }): JSX.Element {
  if (!finger) {
    return (
      <div className={`walkstick-home walkstick-home--keys${terrain ? ' is-terrain' : ''}`} aria-hidden>
        <span className="walkstick-home__caps">
          <span className="walkstick-home__cap walkstick-home__cap--w">W</span>
          <span className="walkstick-home__cap walkstick-home__cap--a">A</span>
          <span className="walkstick-home__cap walkstick-home__cap--s">S</span>
          <span className="walkstick-home__cap walkstick-home__cap--d">D</span>
        </span>
        <span className="walkstick-home__word">MOVE</span>
      </div>
    )
  }
  return (
    <div className={`walkstick-home${held ? ' is-held' : ''}${terrain ? ' is-terrain' : ''}`} aria-hidden>
      <Ring />
      <span className="walkstick-home__word">MOVE</span>
    </div>
  )
}

/**
 * The zone and the live ring. `onHeld` hears the stick taken and let go
 * (the rest ring steps back meanwhile).
 */
export function WalkStickZone({ terrain, onHeld, veil = '' }: { terrain: boolean; onHeld: (held: boolean) => void; veil?: string }): JSX.Element {
  const zone = useRef<HTMLDivElement>(null)
  const base = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const tracker = useMemo(() => new StickTracker(() => STICK_REACH), [])
  const pushed = useRef(false)

  const draw = (s: Readonly<StickState> | null): void => {
    const z = zone.current
    const b = base.current
    const k = knob.current
    if (!z || !b || !k) return
    if (!s) { b.classList.remove('is-on'); return }
    const box = z.getBoundingClientRect()
    const w = typeof window !== 'undefined' ? window.innerWidth : Infinity
    const h = typeof window !== 'undefined' ? window.innerHeight : Infinity
    const m = RING_HALF + RING_MARGIN
    const fit = (v: number, lo: number, hi: number): number => (lo <= hi ? Math.min(hi, Math.max(lo, v)) : (lo + hi) / 2)
    // The ring where the centre is, kept whole on screen; the knob from there.
    const cx = fit(s.origin.x, m, w - m)
    const cy = fit(s.origin.y, m, h - m)
    b.style.transform = `translate(${cx - box.left - RING_HALF}px, ${cy - box.top - RING_HALF}px)`
    k.style.transform = `translate(${s.knob.dx}px, ${s.knob.dy}px)`
    // The direction arc: the 8-way step the step WALK takes, or the push itself in fluid WALK.
    const angle = s.dir ? (fluidOn() ? Math.atan2(-s.vec.fwd, s.vec.strafe) : -(s.sector ?? 0) * (Math.PI / 4)) : 0
    b.style.setProperty('--stick-a', `${angle}rad`)
    b.style.setProperty('--stick-m', `${s.dir ? 0.35 + 0.65 * s.vec.mag : 0}`)
    b.classList.add('is-on')
  }

  const release = (id: number | null): void => {
    if (id !== null ? !tracker.up(id) : !tracker.state) return
    tracker.clear()
    pushed.current = false
    stickHold({ fwd: 0, strafe: 0, mag: 0 }, null)
    draw(null)
    onHeld(false)
  }

  // Whatever takes the page away lets go: WALK ending unmounts this, a lost focus or a hidden page.
  useEffect(() => {
    const away = (): void => release(null)
    const hidden = (): void => { if (document.visibilityState !== 'visible') away() }
    window.addEventListener('blur', away)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('blur', away)
      document.removeEventListener('visibilitychange', hidden)
      away()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    // A mouse walks with WASD; only a finger or a pen takes the stick.
    if (e.pointerType === 'mouse') return
    e.preventDefault()
    e.stopPropagation()
    if (!tracker.down(e.pointerId, e.clientX, e.clientY)) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* no capture here: moves still come while over the zone */ }
    buzzGate(['walkstick:down'], performance.now(), 60, TICK_MS)
    draw(tracker.move(e.pointerId, e.clientX, e.clientY))
    onHeld(true)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const s = tracker.move(e.pointerId, e.clientX, e.clientY)
    if (!s) return
    e.preventDefault()
    if (s.dir && !pushed.current) buzzGate(['walkstick:go'], performance.now(), 120, TICK_MS)
    pushed.current = s.dir !== null
    stickHold(s.vec, s.dir)
    draw(s)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => release(e.pointerId)

  return (
    <div
      ref={zone}
      className={`walkstick${terrain ? ' is-terrain' : ''}${veil}`}
      role="group"
      aria-label="Move: drag from where you touch"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
      {...noCallout}
    >
      <div ref={base} className="walkstick__base">
        <Ring />
        <div ref={knob} className="walkstick__knob"><Knob /></div>
      </div>
    </div>
  )
}
