import { useCallback, useState } from 'react'
import { Hud } from './hud/Hud'
import { TouchControls } from './hud/TouchControls'
import { ViewMenu } from './hud/ViewMenu'
import { Compass3D } from './scene/Compass3D'
import { Scene } from './scene/Scene'
import { useCanvasTap } from './hooks/useCanvasTap'
import { useKeyboard } from './hooks/useKeyboard'
import { useProofListener } from './hooks/useProofListener'
import { useIsMobile } from './hooks/useIsMobile'

export default function App(): JSX.Element {
  // The keyboard is unconditional. The on-screen controls are a second way in,
  // not a replacement: both call the same store actions, so WASD and the pad
  // cannot drift apart, and nothing about having a pointer takes the keys away.
  useKeyboard()
  useProofListener()
  const isMobile = useIsMobile()

  // Panels start open on a desktop and closed on a phone, and after that the
  // hamburger owns it on both. It used to be derived from the breakpoint, which
  // was necessary while the hamburger only existed on mobile: a stored `false`
  // would have stranded a desktop HUD with no control to bring it back.
  const [panelsOpen, setPanelsOpen] = useState(!isMobile)

  // Only a phone has to choose between reading the panels and driving. On a
  // desktop there is room for both at once.
  const crowded = isMobile && panelsOpen

  const [padOpen, setPadOpen] = useState(true)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const showPad = padOpen && !crowded

  const onSceneTap = useCallback(() => {
    // A tap while the view menu is up dismisses that first, so one gesture never
    // has two meanings.
    setViewMenuOpen((menu) => {
      if (menu) return false
      setPadOpen((open) => !open)
      return false
    })
  }, [])
  useCanvasTap(onSceneTap, !crowded)

  return (
    <div className="app">
      <Scene />
      {panelsOpen && <Hud menuOpen={crowded} />}
      {!crowded && <Compass3D onTap={() => setViewMenuOpen((open) => !open)} />}
      {!crowded && viewMenuOpen && <ViewMenu onClose={() => setViewMenuOpen(false)} />}
      {showPad && <TouchControls onDismiss={() => setPadOpen(false)} />}
      {!crowded && !padOpen && (
        <button
          className="touchhint"
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setPadOpen(true) }}
          aria-label="Show controls"
        >CONTROLS</button>
      )}
      {crowded && <div className="mobile-overlay" />}
      <button
        className="hamburger-menu"
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => setPanelsOpen((open) => !open)}
        aria-label={panelsOpen ? 'Hide panels' : 'Show panels'}
      >
        <span className={`hamburger-icon ${panelsOpen ? 'hamburger-icon--open' : ''}`}>
          <span></span>
          <span></span>
          <span></span>
        </span>
      </button>
    </div>
  )
}
