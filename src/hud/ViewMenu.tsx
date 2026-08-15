/**
 * ViewMenu.tsx — the view controls, summoned by tapping the compass.
 *
 * These are the keys that change how you are looking rather than where you are:
 * Shift+WASD to snap the axes ninety degrees, Tab for the previous view, Esc for
 * top-down, C for the canonical orientation facing the black sun, P for the
 * plane. On a phone they have no home, and they do not deserve permanent screen
 * space either, because you reach for them once and then navigate for a while.
 *
 * The compass is the right handle for them: it is already the thing that tells
 * you which way you are facing, so it is where you look when that is the
 * question. Tapping what shows your orientation to change your orientation
 * needs no label.
 */

import { useCyberspace } from '../store/useCyberspace'
import type { RotateDirection } from '../lib/space'

interface Props {
  onClose: () => void
}

export function ViewMenu({ onClose }: Props): JSX.Element {
  const plane = useCyberspace((s) => s.plane)
  const canGoBack = useCyberspace((s) => s.viewHistory.length > 0)

  const press = (fn: () => void) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    fn()
  }
  const rotate = (dir: RotateDirection) => () => useCyberspace.getState().rotate(dir)

  return (
    <div className="viewmenu" role="dialog" aria-label="View controls">
      <div className="viewmenu__pad">
        <button className="viewmenu__key viewmenu__key--up" onPointerDown={press(rotate('up'))} aria-label="Rotate up">▲</button>
        <button className="viewmenu__key viewmenu__key--left" onPointerDown={press(rotate('left'))} aria-label="Rotate left">◀</button>
        <span className="viewmenu__hub" aria-hidden="true">ROT</span>
        <button className="viewmenu__key viewmenu__key--right" onPointerDown={press(rotate('right'))} aria-label="Rotate right">▶</button>
        <button className="viewmenu__key viewmenu__key--down" onPointerDown={press(rotate('down'))} aria-label="Rotate down">▼</button>
      </div>

      <div className="viewmenu__row">
        <button
          className="viewmenu__op"
          disabled={!canGoBack}
          onPointerDown={press(() => useCyberspace.getState().popView())}
        >BACK</button>
        <button
          className="viewmenu__op"
          onPointerDown={press(() => useCyberspace.getState().resetView())}
        >TOP</button>
      </div>
      <div className="viewmenu__row">
        <button
          className="viewmenu__op"
          onPointerDown={press(() => useCyberspace.getState().canonicalView())}
        >SUN</button>
        <button
          className="viewmenu__op"
          onPointerDown={press(() => useCyberspace.getState().togglePlane())}
        >{plane === 0 ? 'D-SPACE' : 'C-SPACE'}</button>
      </div>

      <button className="viewmenu__close" onPointerDown={press(onClose)} aria-label="Close view controls">CLOSE</button>
    </div>
  )
}
