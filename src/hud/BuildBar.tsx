/**
 * BuildBar.tsx - BUILD mode on screen: where the build cursor is, how big a
 * cell is, what to place, and the ways out.
 *
 * It stands in the instrument stack where the free view's FocusBar would,
 * since BUILD mode rides that view (store/useBuilder.ts). Minimal by
 * arkinox's ruling (2026-10-07): the wrench and BUILD with EXIT, one line
 * with the cursor's place, plane and cell size, and the buttons. That
 * building does not move your avatar (design note §4.2) is said in EXPLAIN,
 * kept to short lines under a cap that fits a phone. EXIT leaves the view where it is (R6), like
 * the workshop's close; Escape does the same, as a chip on the Escape stack
 * that the mode itself registers (store/useBuilder.ts), after anything opened
 * inside the mode (a deploy's bar closes first).
 * RETURN TO AVATAR brings the build cursor back to you without leaving.
 *
 * While a deploy is lined up the deploy bar is the working surface and the
 * instrument stack, this bar with it, steps aside (App.tsx), as it always has.
 */

import { formatCellSize, formatDistance } from 'sno-core/scale'
import { samePosition, useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { buildPlane, moveUnderWay } from '../lib/buildCursor'
import { axisDistance } from '../lib/nearby'
import { shortAxis } from '../lib/viewAt'
import { Explanation } from './Explanation'
import { useStash } from './stash'
import { Diamond, House, Pencil, Wrench } from 'lucide-react'

/** The buttons' icons, one size for all three, matched to the 8px capitals beside them. */
const ICON = 12

export function BuildBar(): JSX.Element | null {
  const active = useBuilder((s) => s.active)
  const cursor = useCyberspace((s) => s.cursor)
  const position = useCyberspace((s) => s.position)
  const plane = useCyberspace(buildPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  // On your avatar: the same coordinate in the plane your head shows.
  const onAvatar = useCyberspace((s) => samePosition(s.cursor, s.position) && buildPlane(s) === s.plane)
  // A move committed before building that is still going: a proof being
  // computed, or a route stepping. Not a paused or failed route, which is
  // waiting on you and moves nothing. It is not the Builder's, and the bar
  // says so, with a STOP, since the pad's STOP is not shown while building.
  const moving = useCyberspace(moveUnderWay)
  if (!active) return null

  const stop = (): void => {
    const s = useCyberspace.getState()
    if (s.plan) s.cancelPlan()
    else s.cancel()
  }

  return (
    <div className="hyperbar buildbar" role="group" aria-label="Build mode">
      <div className="buildbar__head">
        <Wrench className="buildbar__glyph" size={14} strokeWidth={2.25} aria-hidden />
        <span className="hyperbar__text">
          <span className="hyperbar__label">BUILD</span>
          {/* Where the build cursor is, in which plane, and the cell a
              placement lands in, which the zoom sets: one line. */}
          <span className="hyperbar__meta">
            {[cursor.x, cursor.y, cursor.z].map(shortAxis).join(', ')} · {plane === 0 ? 'DATASPACE' : 'IDEASPACE'} · 2^{scaleExp} · {formatCellSize(scaleExp)}
          </span>
        </span>
        <button className="hyperbar__end buildbar__exit" onClick={() => useBuilder.getState().exit()} title="Leave build mode. The view stays where it is (Esc, or B)">EXIT</button>
      </div>

      {moving && (
        <div className="buildbar__warn">
          A move you committed before building is still under way; it moves your avatar when it finishes.
          <button className="buildbar__stop" onClick={stop} title="Stop that move (X)">STOP</button>
        </div>
      )}

      <div className="buildbar__acts">
        <button className="buildbar__act" onClick={() => useStash.getState().openModels()} title="Choose one of your models and place it at the build cursor"><Diamond className="buildbar__icon" size={ICON} strokeWidth={2.25} aria-hidden />PLACE OBJECT</button>
        <button className="buildbar__act" onClick={() => useStash.getState().openMessage()} title="Write a message and hide it at the build cursor"><Pencil className="buildbar__icon" size={ICON} strokeWidth={2.25} aria-hidden />HIDE MESSAGE</button>
        <button className="buildbar__act" disabled={onAvatar} onClick={() => useBuilder.getState().toAvatar()} title="Bring the build cursor and the view back to your avatar, still building (X)"><House className="buildbar__icon" size={ICON} strokeWidth={2.25} aria-hidden />RETURN TO AVATAR</button>
      </div>

      <Explanation>
        <ul className="buildbar__explain">
          <li>The white cube marked BUILD is the build cursor: what you place lands in its cell.</li>
          <li>Move it with the pad or W A S D (R and F for depth). + and − (Q and E on a keyboard) make the cells bigger or smaller. VIEW in the Position panel jumps it anywhere; P switches the plane.</li>
          <li>CHAIN aims it too: each step along a chain, yours or a spectated avatar's ([ ] Home End), puts it on that action. Spectating keeps build mode on.</li>
          <li>When you place something, its ghost shows where it lands and the green box is the region someone must compute to find it; the height you hide it at sets that box.</li>
          <li>Building never moves your avatar and signs no move.{onAvatar ? '' : ` Your avatar is ${formatDistance(axisDistance(cursor, position))} away.`}</li>
          <li>EXIT, Esc or B leaves build mode; the view stays where it is.</li>
        </ul>
      </Explanation>
    </div>
  )
}
