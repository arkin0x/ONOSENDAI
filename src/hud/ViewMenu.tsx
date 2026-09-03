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

import { Box, Earth } from 'lucide-react'
import { useCyberspace } from '../store/useCyberspace'
import { viewCyberspace, viewEarth } from './HyperspacePanel'
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
  // Same reasoning as the movement pad: a held press must not raise a callout.
  const noCallout = { onContextMenu: (e: React.MouseEvent) => e.preventDefault() }
  const rotate = (dir: RotateDirection) => () => useCyberspace.getState().rotate(dir)

  return (
    <div className="viewmenu" role="dialog" aria-label="View controls">
      {/* Each arrow fires the OPPOSITE rotation: the pad steers the scene,
          not the camera. Pressing right should bring the world's right side
          around to face you, which is what dragging the camera LEFT does;
          wiring the arrows like the drag made every press feel mirrored. */}
      <div className="viewmenu__pad">
        <button className="viewmenu__key viewmenu__key--up" onContextMenu={noCallout.onContextMenu} onPointerDown={press(rotate('down'))} aria-label="Rotate up">▲</button>
        <button className="viewmenu__key viewmenu__key--left" onContextMenu={noCallout.onContextMenu} onPointerDown={press(rotate('right'))} aria-label="Rotate left">◀</button>
        <span className="viewmenu__hub" aria-hidden="true">ROT</span>
        <button className="viewmenu__key viewmenu__key--right" onContextMenu={noCallout.onContextMenu} onPointerDown={press(rotate('left'))} aria-label="Rotate right">▶</button>
        <button className="viewmenu__key viewmenu__key--down" onContextMenu={noCallout.onContextMenu} onPointerDown={press(rotate('up'))} aria-label="Rotate down">▼</button>
      </div>

      <div className="viewmenu__row">
        <button
          className="viewmenu__op"
          disabled={!canGoBack}
          onContextMenu={noCallout.onContextMenu} onPointerDown={press(() => useCyberspace.getState().popView())}
        >BACK</button>
        <button
          className="viewmenu__op"
          onContextMenu={noCallout.onContextMenu} onPointerDown={press(() => useCyberspace.getState().resetView())}
        >TOP</button>
      </div>
      <div className="viewmenu__row">
        <button
          className="viewmenu__op"
          onContextMenu={noCallout.onContextMenu} onPointerDown={press(() => useCyberspace.getState().canonicalView())}
        >SUN</button>
        <button
          className="viewmenu__op"
          onContextMenu={noCallout.onContextMenu} onPointerDown={press(() => useCyberspace.getState().togglePlane())}
        >{plane === 0 ? 'D-SPACE' : 'I-SPACE'}</button>
      </div>

      {/* EARTH replaces CLOSE: the menu already dismisses on a canvas tap
          or a second compass tap, and going to the planet is worth a seat
          this prominent. Same styling and behaviour as the panel's button;
          navigating away also folds the menu. */}
      <button
        className="hyper__btn hyper__btn--earth"
        onContextMenu={noCallout.onContextMenu}
        onPointerDown={press(() => { onClose(); viewEarth() })}
      ><Earth size={12} strokeWidth={2.25} aria-hidden /> EARTH</button>
      {/* The whole cube, centre tracked, with v1's top and bottom lattices. */}
      <button
        className="hyper__btn hyper__btn--cyberspace"
        onContextMenu={noCallout.onContextMenu}
        onPointerDown={press(() => { onClose(); viewCyberspace() })}
      ><Box size={12} strokeWidth={2.25} aria-hidden /> CYBERSPACE</button>
    </div>
  )
}
