/**
 * BuildBar.tsx - BUILD mode on screen: where the build cursor is, how big a
 * cell is, what to place, and the ways out.
 *
 * It stands in the instrument stack where the free view's FocusBar would,
 * since BUILD mode rides that view (store/useBuilder.ts), and it says in so
 * many words that building does not move your avatar, so nobody thinks they
 * teleported (design note §4.2). EXIT leaves the view where it is (R6), like
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
import { buildPlane } from '../lib/buildCursor'
import { axisDistance } from '../lib/nearby'
import { shortAxis } from '../lib/viewAt'
import { Explanation } from './Explanation'
import { useStash } from './stash'

export function BuildBar(): JSX.Element | null {
  const active = useBuilder((s) => s.active)
  const cursor = useCyberspace((s) => s.cursor)
  const position = useCyberspace((s) => s.position)
  const plane = useCyberspace(buildPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  // On your avatar: the same coordinate in the plane your head shows.
  const onAvatar = useCyberspace((s) => samePosition(s.cursor, s.position) && buildPlane(s) === s.plane)
  // A move committed before building can still be computing or stepping a
  // route. It is not the Builder's, and the bar says so rather than let it
  // look as if building moved you.
  const moving = useCyberspace((s) => s.proof.status === 'computing' || s.plan !== null)
  if (!active) return null

  return (
    <div className="hyperbar buildbar" role="group" aria-label="Build mode">
      <div className="buildbar__head">
        <span className="hyperbar__glyph buildbar__glyph" aria-hidden="true">⬚</span>
        <span className="hyperbar__text">
          <span className="hyperbar__label">BUILD MODE</span>
          <span className="hyperbar__meta">
            {[cursor.x, cursor.y, cursor.z].map(shortAxis).join(', ')} · {plane === 0 ? 'DATASPACE' : 'IDEASPACE'}
          </span>
        </span>
        <button className="hyperbar__end buildbar__exit" onClick={() => useBuilder.getState().exit()} title="Leave build mode. The view stays where it is (Esc, or B)">EXIT</button>
      </div>

      <div className="buildbar__facts">
        <span>
          <strong>CELL 2^{scaleExp}</strong> · {formatCellSize(scaleExp)} on a side. Each step moves the build cursor one cell; + makes the cells bigger, − smaller.
        </span>
        <span className="buildbar__still">
          {onAvatar ? 'The build cursor is on your avatar.' : `Your avatar stays where it is, ${formatDistance(axisDistance(cursor, position))} away.`} Building never moves your avatar and signs no move.
        </span>
        {moving && (
          <span className="buildbar__warn">A move you committed before building is still under way. It moves your avatar when it finishes; building does not.</span>
        )}
      </div>

      <div className="buildbar__acts">
        <button className="buildbar__act" onClick={() => useStash.getState().openModels()} title="Choose one of your models and place it at the build cursor">◇ PLACE OBJECT</button>
        <button className="buildbar__act" onClick={() => useStash.getState().openMessage()} title="Write a message and hide it at the build cursor">✎ HIDE MESSAGE</button>
        <button className="buildbar__act" disabled={onAvatar} onClick={() => useBuilder.getState().toAvatar()} title="Bring the build cursor and the view back to your avatar, still building (X)">⌂ RETURN TO AVATAR</button>
      </div>

      <Explanation>
        Build mode places objects and messages at the build cursor, the white
        cube marked BUILD, instead of at your avatar. The build cursor is a
        position of its own. The movement controls (the pad, W A S D, and R
        and F for depth) move it one cell at a time, and the zoom decides how
        big a cell is: zoom out with + to place very large objects (2^6 and
        up) or to cross great distances in a few steps, and zoom in with − to
        place precisely. To build somewhere else entirely, type a coordinate
        or a place into VIEW in the Position panel and the build cursor jumps
        there, or zoom far out, move the cursor, and zoom back in. P switches
        the plane you build in. Nothing you do here moves your avatar or signs
        a movement, which is why COMMIT and the route are not shown while you
        build. Hiding something still costs the work of computing its
        region&apos;s key, wherever you stand. EXIT leaves the view exactly
        where it is; RETURN TO AVATAR brings the build cursor back to you.
      </Explanation>
    </div>
  )
}
