/**
 * TouchPad.tsx - DRONE RUN's phone controls: two sticks, one per thumb,
 * with what each hand needs above it (owner, 2026-11-16: move, look and
 * fire at the same time).
 *
 * | Where | What |
 * |---|---|
 * | bottom left | the MOVE stick: analog (a thumb anywhere on the left half drives it, measured from its centre), so the run speeds up as far as it is pushed |
 * | bottom right | the LOOK stick, the same size: held off centre it turns the view, faster the farther out (input.ts lookStickRate) |
 * | right half, off the stick and the buttons | drag to look (input.ts TOUCH_RAD_PER_PX) |
 * | above the LOOK stick | FIRE, big and round; held fires (and charges the rail). JUMP beside it, round and smaller (again in the air: the double jump) |
 * | above the MOVE stick | the gun button: the gun in hand's icon, name and gauge; a tap goes to the next gun |
 * | above the gun button | RELOAD, only for the gun with a magazine (its place is kept for the others) |
 *
 * The sticks' drawing and the look are moved by the HUD's view layer
 * (DroneRunHud: input.ts TouchTracker), which takes the touches that land
 * on no button. Every control takes its own finger (pointer id): FIRE holds
 * one fire source per finger, so lifting one finger never stops another's,
 * and moving, looking, firing and jumping all work at once. touch-action
 * none throughout.
 */

import type { RefObject } from 'react'
import { RotateCcw } from 'lucide-react'
import { noCallout } from '../../../hooks/useRepeatable'
import { pressCycle, pressJump, pressReload, setFire } from '../input'
import { Gauge } from './HudView'
import { COPY, weaponIcon, type HudState, type HudWeapon } from './model'

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

export function TouchPad({ hud, weapons, move, look }: { hud: HudState; weapons: HudWeapon[]; move: StickRefs; look: StickRefs }): JSX.Element {
  const weapon = weapons[hud.weapon]
  const Icon = weaponIcon(weapon)
  const reloadable = weapon?.gauge === 'ammo'
  const fireDown = (e: Press): void => {
    own(e)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* fine */ }
    setFire(fireSource(e.pointerId), true)
  }
  const fireUp = (e: Press): void => { e.stopPropagation(); setFire(fireSource(e.pointerId), false) }
  return (
    <div className="drun-touch" aria-label="game controls">
      <div ref={move.base} className="drun-stick drun-stick--move" aria-label={COPY.move}>
        <span className="drun-stick__label" aria-hidden>{COPY.move}</span>
        <span ref={move.knob} className="drun-stick__knob" />
      </div>
      <div ref={look.base} className="drun-stick drun-stick--look" aria-label={COPY.look}>
        <span className="drun-stick__label" aria-hidden>{COPY.look}</span>
        <span ref={look.knob} className="drun-stick__knob" />
      </div>
      <button className="drun-btn drun-btn--fire" aria-label={COPY.fire} {...noCallout} onPointerDown={fireDown} onPointerUp={fireUp} onPointerCancel={fireUp} onLostPointerCapture={fireUp}>{COPY.fire}</button>
      <button className="drun-btn drun-btn--jump" aria-label={COPY.jump} {...noCallout} onPointerDown={(e) => { own(e); pressJump() }}>{COPY.jump}</button>
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
