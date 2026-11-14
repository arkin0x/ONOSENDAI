/**
 * MoveHandles.tsx - move handles on the object (workshop redesign, phase 2,
 * decision 2), in place of the nine-key pad that covered a quarter of a
 * phone. While anything is held, three handles stand out from its middle,
 * one per axis, in the axes' colors (X red, Y green, Z blue, as the view
 * ball draws them). Drag one to slide what is held along that axis in grid
 * steps; tap one for a single step its way. A whole drag is one UNDO. The
 * keys are unchanged, and the old pad is in MORE.
 *
 * Drawn over the canvas, not in it: a handle is a 44px button that takes the
 * press before the bench can, so a point under a handle is never picked by
 * mistake (orbit a little to reach it). The bench reports where they stand
 * every frame it draws (benchAxes reportHandles); they are moved here without
 * React, as the compass labels are.
 */

import { useEffect, useRef } from 'react'
import { TICKS_PER_UNIT } from 'sno-core/shards'
import { dragHistory } from '../../lib/opacityStep'
import { useWorkshop } from '../../store/useWorkshop'
import { handleSteps, setHandleSink, type HandleFrame } from '../benchAxes'
import { slopFor } from '../deadZone'

/** How far a handle stands from the middle, in CSS pixels. */
export const HANDLE_REACH_PX = 72

const AXES = [
  { axis: 0 as const, label: '+X', cls: 'x' },
  { axis: 1 as const, label: '+Y', cls: 'y' },
  { axis: 2 as const, label: '+Z', cls: 'z' },
]

/**
 * Where a handle stands: `reach` pixels from the middle along the axis as it
 * looks on screen. An axis seen end on has no direction on screen; its
 * handle hides rather than sitting on the middle. Pure.
 */
export function handleAt(frame: HandleFrame, axis: 0 | 1 | 2, reach = HANDLE_REACH_PX): [number, number] | null {
  const [dx, dy] = frame.perUnit[axis]
  const len = Math.hypot(dx, dy)
  if (len < 4) return null
  return [frame.center[0] + (dx / len) * reach, frame.center[1] + (dy / len) * reach]
}

export function MoveHandles(): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const lines = useRef<Array<SVGLineElement | null>>([])
  const knobs = useRef<Array<HTMLButtonElement | null>>([])
  const hub = useRef<HTMLSpanElement>(null)
  const frame = useRef<HandleFrame | null>(null)
  // The drag in flight: which axis, where it began, the steps it has made, and the history to fold it into.
  const drag = useRef<{ axis: 0 | 1 | 2; id: number; x: number; y: number; perUnit: [number, number]; steps: number; travel: number; past: ReturnType<typeof useWorkshop.getState>['past']; before: ReturnType<ReturnType<typeof useWorkshop.getState>['current']>; slop: number } | null>(null)

  useEffect(() => {
    const draw = (f: HandleFrame | null): void => {
      frame.current = f
      const el = root.current
      if (!el) return
      el.hidden = f === null
      if (!f) return
      if (hub.current) hub.current.style.transform = `translate(${f.center[0]}px, ${f.center[1]}px)`
      AXES.forEach(({ axis }) => {
        const at = handleAt(f, axis)
        const line = lines.current[axis]
        const knob = knobs.current[axis]
        if (line) {
          line.style.display = at ? '' : 'none'
          if (at) { line.setAttribute('x1', String(f.center[0])); line.setAttribute('y1', String(f.center[1])); line.setAttribute('x2', String(at[0])); line.setAttribute('y2', String(at[1])) }
        }
        if (knob) {
          knob.style.display = at ? '' : 'none'
          if (at) knob.style.transform = `translate(${at[0]}px, ${at[1]}px)`
        }
      })
    }
    setHandleSink(draw)
    return () => setHandleSink(null)
  }, [])

  const down = (axis: 0 | 1 | 2) => (e: React.PointerEvent<HTMLButtonElement>): void => {
    const f = frame.current
    if (!f || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* followed by the element anyway */ }
    const st = useWorkshop.getState()
    drag.current = { axis, id: e.pointerId, x: e.clientX, y: e.clientY, perUnit: f.perUnit[axis], steps: 0, travel: 0, past: st.past, before: st.current(), slop: slopFor(e.pointerType) }
  }
  const move = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    d.travel = Math.max(d.travel, Math.hypot(dx, dy))
    if (d.travel < d.slop) return
    const w = useWorkshop.getState()
    const step = w.step()
    const steps = handleSteps(dx, dy, d.perUnit, TICKS_PER_UNIT, step)
    if (steps !== d.steps) {
      w.moveSelected(d.axis, (steps - d.steps) * step)
      d.steps = steps
    }
  }
  const up = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    const w = useWorkshop.getState()
    // A tap: one step the handle's way.
    if (d.travel < d.slop && e.type === 'pointerup') { w.moveSelected(d.axis, w.step()); return }
    // A drag: every step it made, one UNDO.
    const now = useWorkshop.getState()
    if (d.before && now.current() !== d.before && now.past.length - d.past.length > 1) useWorkshop.setState({ past: dragHistory(d.past, d.before, now.past) })
  }

  return (
    <div className="ws__handles" ref={root} hidden aria-label="Move handles">
      <svg className="ws__handles-lines" aria-hidden>
        {AXES.map(({ axis, cls }) => <line key={cls} ref={(el) => { lines.current[axis] = el }} className={`ws__handle-line ws__handle-line--${cls}`} />)}
      </svg>
      <span className="ws__handle-hub" ref={hub} aria-hidden />
      {AXES.map(({ axis, label, cls }) => (
        <button
          key={cls}
          ref={(el) => { knobs.current[axis] = el }}
          className={`ws__handle ws__handle--${cls}`}
          aria-label={`Move along ${label.slice(1)}: drag, or tap for one step`}
          title={`Drag to move along ${label.slice(1)} in grid steps; tap for one step`}
          onPointerDown={down(axis)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
