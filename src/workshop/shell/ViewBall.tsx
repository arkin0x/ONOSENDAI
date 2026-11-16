/**
 * ViewBall.tsx - the view ball, top right, one of the workshop's five fixed
 * places (workshop redesign, phase 1). The axes compass in a ball: drag it to
 * orbit, with any tool (a drag keeps turning past the ball until the finger
 * lifts); tap it for the views menu. It replaces the 152px ORBIT ball at the
 * bottom right and the compass that only VIEW had.
 *
 * The menu: HOME, FIT, TOP, FRONT, SIDE; the working grid's tip and roll keys
 * with RESET, from the pad under the old compass; the snap; and the avatar
 * ghost, which is a view setting (it stays in AVATAR too).
 */

import { Vector3 } from 'three'
import { DIVISIONS } from 'sno-core/shards'
import { FLOOR } from 'sno-core/stamps'
import { Compass3D } from '../../scene/Compass3D'
import { OrbitSphere } from '../../hud/ui/OrbitSphere'
import { Field, Switch } from '../../hud/ui/Switch'
import { noCallout } from '../../hooks/useRepeatable'
import { useWorkshop } from '../../store/useWorkshop'
import { benchPose, orbitBy, planeAfter, requestView, useBenchView, type ViewKind } from '../benchAxes'
import { stepDivision } from '../divisions'
import { EyePreview } from '../EyePreview'

/** The bench's axes as the compass draws them: model +Z is render -Z (shards.ts toRender). */
const BENCH_DIRS = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, -1) }

const VIEWS: Array<{ kind: ViewKind; label: string; title: string }> = [
  { kind: 'home', label: 'HOME', title: 'The view the bench opens on' },
  { kind: 'fit', label: 'FIT', title: 'The whole shard in view, from where you look' },
  { kind: 'top', label: 'TOP', title: 'Straight down' },
  { kind: 'front', label: 'FRONT', title: 'Straight on, along Z' },
  { kind: 'side', label: 'SIDE', title: 'From the side, along X' },
]

/**
 * The grid pad, for the bench: the arrows turn the working grid a quarter
 * while the geometry stays put, so the next points go down on another plane.
 * Up and down tip it about the screen's horizontal, left and right roll it
 * about the line of sight (benchAxes planeAfter). RESET is the black sun's
 * seat here: the grid back on the floor and the camera back where the bench
 * opens. The same keys the compass's pad had, in one row of thumb-sized keys.
 */
function GridPad(): JSX.Element {
  const w = useWorkshop.getState
  const press = (fn: () => void) => (e: React.PointerEvent): void => { e.preventDefault(); e.stopPropagation(); fn() }
  const turn = (about: 'tip' | 'roll') => (): void => w().setPlane(planeAfter(w().plane, useBenchView.getState().axes, about))
  return (
    <div className="ws__viewmenu-grid" role="group" aria-label="Grid controls">
      <span className="workshop__label">GRID</span>
      <button className="ws__viewmenu-btn ws__viewmenu-btn--sq" {...noCallout} onPointerDown={press(turn('tip'))} aria-label="Tip the grid up">▲</button>
      <button className="ws__viewmenu-btn ws__viewmenu-btn--sq" {...noCallout} onPointerDown={press(turn('tip'))} aria-label="Tip the grid down">▼</button>
      <button className="ws__viewmenu-btn ws__viewmenu-btn--sq" {...noCallout} onPointerDown={press(turn('roll'))} aria-label="Roll the grid left">◀</button>
      <button className="ws__viewmenu-btn ws__viewmenu-btn--sq" {...noCallout} onPointerDown={press(turn('roll'))} aria-label="Roll the grid right">▶</button>
      <button className="ws__viewmenu-btn ws__viewmenu-reset" {...noCallout} onPointerDown={press(() => { w().setPlane(FLOOR); requestView({ kind: 'home' }) })} title="The grid back on the floor, the view back where the bench opens">RESET</button>
    </div>
  )
}

/** The views menu under the ball. A view picked puts it away, so the view is seen. */
function ViewMenu({ onClose }: { onClose: () => void }): JSX.Element {
  const division = useWorkshop((s) => s.division)
  const showAvatar = useWorkshop((s) => s.showAvatar)
  const w = useWorkshop.getState
  return (
    <div className="ws__viewmenu" role="group" aria-label="Views">
      <div className="ws__viewmenu-views" role="group" aria-label="View">
        {VIEWS.map((v) => (
          <button key={v.kind} className="ws__viewmenu-btn" title={v.title} onClick={() => { requestView({ kind: v.kind }); onClose() }}>{v.label}</button>
        ))}
      </div>
      <GridPad />
      <div className="ws__viewmenu-row" role="group" aria-label="Snap">
        <span className="workshop__label">SNAP</span>
        <button className="ws__viewmenu-btn ws__viewmenu-btn--sq" onClick={() => w().setDivision(stepDivision(division, -1))} disabled={division === DIVISIONS[0]} aria-label="Coarser snap" title="Coarser snap">−</button>
        <span className="workshop__value" title={division === 1 ? 'Snap to whole units' : `Snap to 1/${division} of a unit`}>{division === 1 ? '1' : `1/${division}`}</span>
        <button className="ws__viewmenu-btn ws__viewmenu-btn--sq" onClick={() => w().setDivision(stepDivision(division, 1))} disabled={division === DIVISIONS[DIVISIONS.length - 1]} aria-label="Finer snap" title="Finer snap">+</button>
      </div>
      <div className="ws__viewmenu-row">
        <Field id="ws-view-ghost" label="avatar ghost">
          <Switch id="ws-view-ghost" className="ui-switch--ok" checked={showAvatar} onCheckedChange={(v) => w().setShowAvatar(v)} />
        </Field>
      </div>
    </div>
  )
}

export function ViewBall({ open, onToggle, onClose }: { open: boolean; onToggle: () => void; onClose: () => void }): JSX.Element {
  // SET EYE's WHAT YOU SEE stands under the ball, where the views menu would; the menu, open, takes the place.
  const eyeEdit = useWorkshop((s) => s.eyeEdit)
  return (
    <div className="ws__view">
      <OrbitSphere
        className={`ws__viewball${open ? ' is-on' : ''}`}
        onTurn={orbitBy}
        onTap={onToggle}
        label="VIEW"
        title="Drag to orbit the view; keep dragging past the ball. Tap for views."
        ariaLabel="View ball. Drag to orbit, tap for views."
        aria={{ 'aria-expanded': open, 'aria-haspopup': 'true' }}
      >
        <Compass3D bench pose={benchPose} dirs={BENCH_DIRS} />
      </OrbitSphere>
      {open && <ViewMenu onClose={onClose} />}
      {eyeEdit && !open && <EyePreview />}
    </div>
  )
}
