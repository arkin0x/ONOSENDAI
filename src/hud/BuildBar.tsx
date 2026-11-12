/**
 * BuildBar.tsx - BUILD mode on screen: where the build cursor is, how big a
 * cell is, what to place, and the ways out.
 *
 * It stands in the instrument stack where the free view's FocusBar would,
 * since BUILD mode rides that view (store/useBuilder.ts). Minimal by
 * arkinox's ruling (2026-10-07): the wrench and BUILD with EXIT, one line
 * with the plane and cell size (the cursor's coordinate left it on
 * 2026-11-02), and the buttons. That
 * building does not move your avatar (design note §4.2) is said in EXPLAIN,
 * kept to short lines under a cap that fits a phone. EXIT leaves the view where it is (R6), like
 * the workshop's close; Escape does the same, as a chip on the Escape stack
 * that the mode itself registers (store/useBuilder.ts), after anything opened
 * inside the mode (a deploy's bar closes first).
 * RETURN TO AVATAR brings the build cursor back to you without leaving. It
 * sits beside EXIT and is there only while it has something to do: the
 * cursor away from you, or a chain explorer mark to clear (arkinox,
 * 2026-11-09: "move Avatar up to the same row as the exit button ... make it
 * disappear when its inactive"). On a narrow bar it has a second header row,
 * under EXIT on the right, kept even while it is gone, so nothing moves.
 *
 * While a deploy is lined up the deploy bar is the working surface and the
 * instrument stack, this bar with it, steps aside (App.tsx), as it always has.
 */

import { formatCellSize, formatDistance } from 'sno-core/scale'
import { samePosition, useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { SCAN_MAX_HEIGHT, useAgainName, useShards } from '../store/useShards'
import { buildPlane, moveUnderWay } from '../lib/buildCursor'
import { axisDistance } from '../lib/nearby'
import { Explanation } from './Explanation'
import { useStash } from './stash'
import { useCover } from '../hooks/useCover'
import { useLayoutEffect, useRef } from 'react'
import { CopyPlus, DoorClosedLocked, House, Wrench } from 'lucide-react'
import { ItemIcon } from './ItemIcon'
import { sealAChest, sealADoor } from './ShardsPanel'

/** The buttons' icons, one size for all, matched to the 8px capitals beside them. */
const ICON = 12

export function BuildBar(): JSX.Element | null {
  // Covers the scene from above: BUILD frames the cursor below it (hooks/useCover).
  const coverRef = useCover('top')
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
  // The last placement, for AGAIN after a CANCEL: its name, or null.
  const again = useAgainName()
  // A mark from the chain explorer ([ ] Home End) can stand with the cursor
  // on your avatar (your own head, a boarding head): RETURN TO AVATAR still
  // clears it (toAvatar), so it stays while the mark does.
  const marked = useBuilder((s) => s.scrub !== null)
  const showHome = !onAvatar || marked
  // When RETURN TO AVATAR leaves the screen while it has the focus, however
  // it was done (pressed, Enter or Space on it, or X with it focused), the
  // focus goes to EXIT beside it rather than falling off the bar. Focus is
  // never taken from anywhere else: X from the canvas leaves it there.
  const exitRef = useRef<HTMLButtonElement>(null)
  const homeFocused = useRef(false)
  useLayoutEffect(() => {
    if (!active) { homeFocused.current = false; return }
    if (showHome || !homeFocused.current) return
    homeFocused.current = false
    exitRef.current?.focus()
  }, [active, showHome])
  if (!active) return null

  const stop = (): void => {
    const s = useCyberspace.getState()
    if (s.plan) s.cancelPlan()
    // Finished since the render: X here would end BUILD's view, not a move.
    else if (moveUnderWay(s)) s.cancel()
  }

  return (
    <div ref={coverRef} className="hyperbar buildbar" role="group" aria-label="Build mode">
      <div className="buildbar__head">
        <Wrench className="buildbar__glyph" size={14} strokeWidth={2.25} aria-hidden />
        <span className="hyperbar__text">
          <span className="hyperbar__label">BUILD</span>
          {/* The plane, and the cell a placement lands in, which the zoom
              sets: one line. No coordinate (arkinox, 2026-11-02). */}
          <span className="hyperbar__meta">
            {plane === 0 ? 'DATASPACE' : 'IDEASPACE'} · 2^{scaleExp} · {formatCellSize(scaleExp)}
          </span>
        </span>
        {/* Not rendered when it would do nothing. Its cell in the header
            is EXIT's left on a wide bar and the row under EXIT on a narrow
            one, kept while it is gone (styles.css .buildbar__head), so
            nothing moves when it comes and goes. X does the same. */}
        {showHome && (
          <button className="buildbar__act buildbar__home" onClick={() => useBuilder.getState().toAvatar()} onFocus={() => { homeFocused.current = true }} onBlur={() => { homeFocused.current = false }} aria-label="Return to avatar" title="Return to avatar: bring the build cursor and the view back to your avatar, still building (X)"><House className="buildbar__icon" size={ICON} strokeWidth={2.25} aria-hidden />RETURN TO AVATAR</button>
        )}
        <button ref={exitRef} className="hyperbar__end buildbar__exit" onClick={() => useBuilder.getState().exit()} title="Leave build mode. The view stays where it is (Esc, or B)">EXIT</button>
      </div>

      {moving && (
        <div className="buildbar__warn">
          A move you committed before building is still under way; it moves your avatar when it finishes.
          <button className="buildbar__stop" onClick={stop} title="Stop that move (X)">STOP</button>
        </div>
      )}

      {/* Nouns, not verbs, each in the same cell every time (arkinox,
          2026-11-09): what can be placed, then AGAIN. RETURN TO AVATAR moved
          up beside EXIT the same day.
          AGAIN wears copy-plus and is not shown at all while there is
          nothing to place again (arkinox, 2026-11-11). It is the last cell,
          so nothing else moves when it comes and goes. The tooltips keep the
          verbs, and so do the accessible names, each holding its visible
          word (WCAG 2.5.3, label in name). */}
      <div className="buildbar__acts">
        <button className="buildbar__act" onClick={() => useStash.getState().openModels()} aria-label="Place object" title="Place object: choose one of your models and place it at the build cursor"><ItemIcon type="shard" className="buildbar__icon" size={ICON} />OBJECT</button>
        <button className="buildbar__act" onClick={() => useStash.getState().openMessage()} aria-label="Hide message" title="Hide message: write a message and hide it at the build cursor"><ItemIcon type="message" className="buildbar__icon" size={ICON} />MESSAGE</button>
        <button className="buildbar__act" onClick={() => useStash.getState().openAudio()} aria-label="Place audio" title="Place audio: hide an audio file at the build cursor, encrypted; only finders can play it"><ItemIcon type="audio" className="buildbar__icon" size={ICON} />AUDIO</button>
        <button className="buildbar__act" onClick={() => useStash.getState().openKey()} aria-label="Forge an item" title="Forge an item: a keypair hidden at the build cursor; whoever finds it can TAKE it, and a chest can be sealed to it"><ItemIcon type="key" className="buildbar__icon" size={ICON} />ITEM</button>
        <button className="buildbar__act" onClick={sealAChest} aria-label="Seal a chest" title="Seal a chest: place a chest, then seal a message, a model or an item in it to an item or a person"><ItemIcon type="chest" className="buildbar__icon" size={ICON} />CHEST</button>
        <button className="buildbar__act" onClick={sealADoor} aria-label="Seal a door" title="Seal a door: place a door, then whatever you place in its red cube at its height is sealed to it"><DoorClosedLocked className="item-icon buildbar__icon" size={ICON} strokeWidth={2.5} aria-hidden />DOOR</button>
        <button className="buildbar__act" onClick={() => useStash.getState().openSeed()} aria-label="Plant a seed" title="Plant a seed: pick a DNA, see what it grows, and plant it at the build cursor; everyone who finds it grows the same bloom"><ItemIcon type="seed" className="buildbar__icon" size={ICON} />SEED</button>
        {again !== null && (
          <button className="buildbar__act" onClick={() => useShards.getState().placeAgain()} aria-label="Place again" title={`Place "${again}" again, with the same settings`}><CopyPlus className="item-icon buildbar__icon" size={ICON} strokeWidth={2.25} aria-hidden />AGAIN</button>
        )}
      </div>

      <Explanation>
        <ul className="buildbar__explain">
          <li>The white cube marked BUILD is the build cursor: what you place lands in its cell.</li>
          <li>Move it with the pad or W A S D (R and F for depth). + and − (Q and E on a keyboard) make the cells bigger or smaller. VIEW in the View panel jumps it anywhere; P switches the plane.</li>
          <li>[ ] Home End aim it along a chain, yours or a spectated avatar's: each step puts it on that action. Spectating keeps build mode on.</li>
          <li>When you place something, its ghost shows where it lands and the green box is the region someone must compute to find it; the height you hide it at sets that box.</li>
          {/* The cutoff in words a touch screen shows: the deploy bar's chip
              explains itself only in a tooltip (arkinox, 2026-10-19). */}
          <li>At height {SCAN_MAX_HEIGHT} or less, any view that stops inside that box finds it; at {SCAN_MAX_HEIGHT + 1} or more, only someone who knows the spot and height.</li>
          <li>After a placement, AGAIN lines it up with the same settings.</li>
          <li>While placing, STEP (, and . on a keyboard) moves and snaps it in smaller steps inside the cube, shown by the small white box, without moving the camera.</li>
          <li>Building never moves your avatar and signs no move.{onAvatar ? '' : ` Your avatar is ${formatDistance(axisDistance(cursor, position))} away.`}</li>
          <li>EXIT, Esc or B leaves build mode; the view stays where it is.</li>
        </ul>
      </Explanation>
    </div>
  )
}
