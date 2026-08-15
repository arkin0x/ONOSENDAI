/**
 * TouchControls.tsx — cyberspace operations for touch, as an overlay.
 *
 * The camera is untouched: OrbitControls already handles touch on the canvas,
 * and orbiting is the one thing that already worked on a phone. What was
 * missing is everything else, because every other control was a key. Without
 * these you can look around a phone screen and do nothing at all.
 *
 * These are DOM buttons sitting above the canvas, so a press here never reaches
 * OrbitControls and a drag on open space still orbits. `touch-action: none`
 * stops the browser treating a press as a scroll or a double-tap zoom.
 *
 * Directions resolve through `moveDirection` against the axes currently on
 * screen, exactly as the keyboard does, so the pad obeys a free orbit the same
 * way WASD does and the two can never disagree about which way is up.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import { moveDirection, type MoveName } from '../lib/moves'

/** Delay before a held button starts repeating, then the repeat period. */
const HOLD_DELAY = 380
const REPEAT_MS = 110

/**
 * Fire on press, then repeat while held.
 *
 * Crossing a lot of gibsons one tap at a time would be miserable, and holding
 * is what the keyboard gives you for free through key repeat.
 */
function useRepeatable(): (action: () => void) => {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onPointerLeave: () => void
} {
  const timers = useRef<{ delay?: number; repeat?: number }>({})

  const stop = useCallback(() => {
    if (timers.current.delay) clearTimeout(timers.current.delay)
    if (timers.current.repeat) clearInterval(timers.current.repeat)
    timers.current = {}
  }, [])

  useEffect(() => stop, [stop])

  return useCallback((action: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      // Keeps the press off the canvas and stops it becoming a scroll or a
      // synthetic click that would fire the action twice.
      e.preventDefault()
      e.stopPropagation()
      stop()
      action()
      timers.current.delay = window.setTimeout(() => {
        timers.current.repeat = window.setInterval(action, REPEAT_MS)
      }, HOLD_DELAY)
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
  }), [stop])
}

export function TouchControls({ onDismiss }: { onDismiss: () => void }): JSX.Element {
  const proof = useCyberspace((s) => s.proof)
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const bind = useRepeatable()

  const computing = proof.status === 'computing'
  const armed = !(position.x === cursor.x && position.y === cursor.y && position.z === cursor.z)

  const move = (name: MoveName) => () => {
    const s = useCyberspace.getState()
    s.moveCursor(moveDirection(s.screenAxes ?? s.axes(), name))
  }
  const scale = (delta: number) => () => useCyberspace.getState().adjustScale(delta)

  // Six directions plus the two scale steps: exactly nine things, which is
  // exactly how many cells a 3x3 pad has.
  const pad: Array<{ cell: string; glyph: string; title: string; act: () => void }> = [
    // The physics convention for a vector through the page: a tail seen from
    // behind going in, an arrow tip seen head-on coming out. Nothing else reads
    // as depth on a flat pad.
    { cell: 'away', glyph: '⊗', title: 'Away from camera (R)', act: move('away') },
    { cell: 'up', glyph: '▲', title: 'Up (W)', act: move('up') },
    { cell: 'toward', glyph: '⊙', title: 'Toward camera (F)', act: move('toward') },
    { cell: 'left', glyph: '◀', title: 'Left (A)', act: move('left') },
    { cell: 'right', glyph: '▶', title: 'Right (D)', act: move('right') },
    { cell: 'sdown', glyph: '−', title: 'Finer scale (E)', act: scale(-1) },
    { cell: 'down', glyph: '▼', title: 'Down (S)', act: move('down') },
    { cell: 'sup', glyph: '+', title: 'Coarser scale (Q)', act: scale(1) },
  ]

  return (
    <>
      <div className="touchpad" role="group" aria-label="Move cursor and change scale">
        {pad.map((b) => (
          <button
            key={b.cell}
            className={`touchpad__key touchpad__key--${b.cell}`}
            title={b.title}
            aria-label={b.title}
            {...bind(b.act)}
          >
            {b.glyph}
          </button>
        ))}
        <button
          className="touchpad__hub"
          aria-label={`Scale 2^${scaleExp}. Tap to hide controls.`}
          title="Hide controls"
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss() }}
        >2^{scaleExp}</button>
      </div>

      <div className="touchops">
        <button
          className="touchops__cancel"
          title={computing ? 'Cancel proof (X)' : 'Recall cursor (X)'}
          onPointerDown={(e) => {
            e.preventDefault(); e.stopPropagation()
            useCyberspace.getState().cancel()
          }}
        >
          {computing ? 'STOP' : 'RECALL'}
        </button>
        <button
          className={`touchops__commit ${computing ? 'is-busy' : armed ? 'is-armed' : ''}`}
          disabled={!armed && !computing}
          title="Commit hop (Space)"
          onPointerDown={(e) => {
            e.preventDefault(); e.stopPropagation()
            useCyberspace.getState().commit()
          }}
        >
          {computing ? `${Math.round(proof.progress * 100)}%` : 'COMMIT'}
        </button>
      </div>
    </>
  )
}
