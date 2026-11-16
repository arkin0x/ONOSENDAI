/**
 * TouchPad.tsx - DRONE RUN's phone controls, laid out as WALK's (owner,
 * 2026-11-14: movement on the left, look and jump on the right).
 *
 * | Where | What |
 * |---|---|
 * | bottom left | the move stick: analog (a thumb anywhere on the left half drives it, measured from its centre), so the run speeds up as far as it is pushed |
 * | right half | drag anywhere that is not a button to look (input.ts TOUCH_RAD_PER_PX) |
 * | bottom right | FIRE, big; held fires (and charges the rail) |
 * | left of FIRE | JUMP (again in the air: the double jump) |
 * | above FIRE | the gun button: the gun in hand's icon, name and gauge; a tap goes to the next gun |
 * | above the gun button | RELOAD, only for the gun with a magazine (its place is kept for the others) |
 *
 * The stick's drawing and the look are moved by the HUD's view layer
 * (DroneRunHud: input.ts TouchTracker), which takes the touches that land
 * on no button. Every control here takes its own finger, so moving, looking
 * and firing at once all work. touch-action none throughout.
 */

import type { RefObject } from 'react'
import { RotateCcw } from 'lucide-react'
import { noCallout } from '../../../hooks/useRepeatable'
import { pressCycle, pressJump, pressReload, setFire } from '../input'
import { Gauge } from './HudView'
import { COPY, weaponIcon, type HudState, type HudWeapon } from './model'

type Press = React.PointerEvent<HTMLElement>

/** A control's own finger: kept off the view layer underneath, and never a scroll, a zoom or a long-press menu. */
function own(e: Press): void {
  e.preventDefault()
  e.stopPropagation()
}

export function TouchPad({ hud, weapons, baseRef, knobRef }: { hud: HudState; weapons: HudWeapon[]; baseRef: RefObject<HTMLDivElement>; knobRef: RefObject<HTMLSpanElement> }): JSX.Element {
  const weapon = weapons[hud.weapon]
  const Icon = weaponIcon(weapon)
  const reloadable = weapon?.gauge === 'ammo'
  const fireDown = (e: Press): void => {
    own(e)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* fine */ }
    setFire('pad:fire', true)
  }
  const fireUp = (e: Press): void => { e.stopPropagation(); setFire('pad:fire', false) }
  return (
    <div className="drun-touch" aria-label="game controls">
      <div ref={baseRef} className="drun-stick" aria-label="move">
        <span ref={knobRef} className="drun-stick__knob" />
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
