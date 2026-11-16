/**
 * TouchPad.tsx - DRONE RUN's phone controls: two floating sticks, one per
 * thumb, with what each hand needs above it (owner, 2026-11-16: move, look
 * and fire at the same time; LOOK starts at nothing wherever it is touched;
 * aim with the left while the rail charges; SPRINT on the left).
 *
 * | Where | What |
 * |---|---|
 * | bottom left | the MOVE stick: floating (where a thumb lands on the left half is its centre; the ring is drawn there and goes back on lift), analog, so the run speeds up as far as it is pushed |
 * | bottom right | the LOOK stick, the same size and floating on the right half: held off where it landed it turns the view, faster the farther out (input.ts lookStickRate) |
 * | right half, a second finger | drag to look (input.ts TOUCH_RAD_PER_PX) |
 * | above the LOOK stick | FIRE, big and round; held fires (and charges the rail). JUMP beside it, round and smaller (again in the air: the double jump) |
 * | just above the MOVE stick, toward the middle | SPRINT, JUMP's size and look; held sprints. A ring round it is the stamina: it drains while sprinting and dims while emptied (the lockout) |
 * | above SPRINT (beside the MOVE stick on a short landscape screen) | the gun button: the gun in hand's icon, name and gauge; a tap goes to the next gun |
 * | above the gun button (beside it on a short screen) | RELOAD, only for the gun with a magazine (its place is kept for the others) |
 *
 * SPRINT tapped latches sprint on (lit), so one thumb can tap it and go
 * back to the MOVE stick; a second tap, the MOVE stick let go, the lockout,
 * a card or the page losing focus turn it off. Held longer than a tap, it
 * sprints only while held (input.ts pressSprintPad).
 *
 * While the rail charges (FIRE held with the CHARGE RAIL in hand) the MOVE
 * stick aims: its label reads AIM, its knob carries a crosshair and it takes
 * the rail's blue; the LOOK stick is hidden (its place kept). Both come back
 * when the shot goes (FIRE let go) or the charge ends any other way.
 *
 * The sticks' drawing and the look are moved by the HUD's view layer
 * (DroneRunHud: input.ts TouchTracker), which takes the touches that land
 * on no button. Every control takes its own finger (pointer id): FIRE and
 * SPRINT hold one source per finger, so lifting one finger never stops
 * another's, and moving or aiming, looking, firing, jumping and sprinting
 * all work at once. touch-action none throughout.
 */

import type { RefObject } from 'react'
import { Crosshair, RotateCcw } from 'lucide-react'
import { noCallout } from '../../../hooks/useRepeatable'
import { pressCycle, pressJump, pressReload, pressSprintPad, releaseSprintPad, setFire } from '../input'
import { Gauge } from './HudView'
import { COPY, staminaOf, weaponIcon, type HudState, type HudWeapon } from './model'

type Press = React.PointerEvent<HTMLElement>

/** A stick's drawing: its ring (measured for the finger's centre and reach) and its knob (moved by the HUD). */
export interface StickRefs { base: RefObject<HTMLDivElement>; knob: RefObject<HTMLSpanElement> }

/** A control's own finger: kept off the view layer underneath, and never a scroll, a zoom or a long-press menu. */
function own(e: Press): void {
  e.preventDefault()
  e.stopPropagation()
}

/** FIRE's source for one finger, so two fingers on it are two sources. */
export const fireSource = (pointerId: number): string => `pad:fire:${pointerId}`
/** SPRINT's source for one finger. */
export const sprintSource = (pointerId: number): string => `pad:sprint:${pointerId}`

/** A press's time, ms: the event's own, or the clock's when it carries none. */
const when = (e: Press): number => (Number.isFinite(e.timeStamp) ? e.timeStamp : Date.now())

/** The stamina ring's radius in its 100-unit box: just inside the button's own border. */
const METER_R = 44

export interface TouchPadProps {
  hud: HudState
  weapons: HudWeapon[]
  move: StickRefs
  look: StickRefs
  /** The rail charging: the MOVE stick aims, the LOOK stick hides. */
  aiming?: boolean
  /** A finger (or Shift) holds sprint: the button is lit. */
  sprintHeld?: boolean
  /** SPRINT is latched on by a tap: the button is lit. */
  sprintLatched?: boolean
}

export function TouchPad({ hud, weapons, move, look, aiming = false, sprintHeld = false, sprintLatched = false }: TouchPadProps): JSX.Element {
  const weapon = weapons[hud.weapon]
  const stamina = staminaOf(hud)
  const Icon = weaponIcon(weapon)
  const reloadable = weapon?.gauge === 'ammo'
  const fireDown = (e: Press): void => {
    own(e)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* fine */ }
    setFire(fireSource(e.pointerId), true)
  }
  const fireUp = (e: Press): void => { e.stopPropagation(); setFire(fireSource(e.pointerId), false) }
  const sprintDown = (e: Press): void => {
    own(e)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* fine */ }
    pressSprintPad(sprintSource(e.pointerId), when(e))
  }
  const sprintUp = (e: Press): void => { e.stopPropagation(); releaseSprintPad(sprintSource(e.pointerId), when(e)) }
  /** A cancelled touch, or the capture lost without a lift: it ends a hold and never latches. */
  const sprintGone = (e: Press): void => { e.stopPropagation(); releaseSprintPad(sprintSource(e.pointerId), when(e), false) }
  return (
    <div className="drun-touch" aria-label="game controls">
      <div ref={move.base} className={`drun-stick drun-stick--move${aiming ? ' is-aim' : ''}`} aria-label={aiming ? COPY.stickAim : COPY.move}>
        <span className="drun-stick__label" aria-hidden>{aiming ? COPY.stickAim : COPY.move}</span>
        <span ref={move.knob} className="drun-stick__knob">{aiming && <Crosshair className="drun-stick__aim" size={22} strokeWidth={2.2} aria-hidden />}</span>
      </div>
      <div ref={look.base} className={`drun-stick drun-stick--look${aiming ? ' is-hidden' : ''}`} aria-label={COPY.look} aria-hidden={aiming}>
        <span className="drun-stick__label" aria-hidden>{COPY.look}</span>
        <span ref={look.knob} className="drun-stick__knob" />
      </div>
      <button className="drun-btn drun-btn--fire" aria-label={COPY.fire} {...noCallout} onPointerDown={fireDown} onPointerUp={fireUp} onPointerCancel={fireUp} onLostPointerCapture={fireUp}>{COPY.fire}</button>
      <button className="drun-btn drun-btn--jump" aria-label={COPY.jump} {...noCallout} onPointerDown={(e) => { own(e); pressJump() }}>{COPY.jump}</button>
      <button
        className={`drun-btn drun-btn--sprint${sprintHeld || sprintLatched ? ' is-held' : ''}${sprintLatched ? ' is-latched' : ''}${stamina.sprinting ? ' is-sprinting' : ''}${stamina.locked ? ' is-locked' : ''}`}
        aria-label={COPY.sprint}
        aria-pressed={sprintHeld || sprintLatched}
        hidden={!stamina.shown}
        disabled={!stamina.shown}
        {...noCallout}
        onPointerDown={sprintDown}
        onPointerUp={sprintUp}
        onPointerCancel={sprintGone}
        onLostPointerCapture={sprintGone}
      >
        <svg className="drun-meter" viewBox="0 0 100 100" role="meter" aria-label={COPY.stamina} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stamina.stamina * 100)}>
          <circle className="drun-meter__track" cx={50} cy={50} r={METER_R} />
          <circle className="drun-meter__fill" cx={50} cy={50} r={METER_R} pathLength={100} strokeDasharray="100 100" strokeDashoffset={100 - stamina.stamina * 100} />
        </svg>
        <span className="drun-btn__word">{COPY.sprint}</span>
      </button>
      <button className="drun-btn drun-btn--gun" aria-label={`${weapon?.name ?? ''}: next gun`} {...noCallout} onPointerDown={(e) => { own(e); pressCycle(1) }}>
        <span className="drun-gunbtn__head"><Icon size={16} strokeWidth={2.4} aria-hidden /><span className="drun-gunbtn__name">{weapon?.name ?? ''}</span></span>
        <Gauge hud={hud} weapon={weapon} />
      </button>
      <button className="drun-btn drun-btn--reload" aria-label={COPY.reload} hidden={!reloadable} disabled={!reloadable} {...noCallout} onPointerDown={(e) => { own(e); pressReload() }}>
        <RotateCcw size={14} strokeWidth={2.4} aria-hidden />{COPY.reload}
      </button>
    </div>
  )
}
