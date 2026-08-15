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
  useKeyboard()
  useProofListener()
  const isMobile = useIsMobile()

  // Only the mobile toggle is state. Deriving visibility from it keeps the
  // panels reachable across the breakpoint: the hamburger unmounts on desktop,
  // so a stored `false` would strand the HUD with no control to restore it.
  const [mobilePanelsOpen, setMobilePanelsOpen] = useState(false)
  const showPanels = !isMobile || mobilePanelsOpen

  // On mobile, hide ScaleBar, Compass3D, and TerrainLegend when panels are visible
  const hideOverlays = isMobile && showPanels

  // The touch controls are summoned rather than permanent. They start visible so
  // they can be found at all, and a tap on the scene puts them away, because a
  // phone screen is mostly view and the view is the point.
  const [padOpen, setPadOpen] = useState(true)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)

  const onSceneTap = useCallback(() => {
    // A tap while the view menu is up dismisses that first, so one gesture never
    // has two meanings.
    setViewMenuOpen((menu) => {
      if (menu) return false
      setPadOpen((open) => !open)
      return false
    })
  }, [])
  useCanvasTap(onSceneTap, isMobile && !showPanels)

  return (
    <div className="app">
      <Scene />
      {showPanels && <Hud hideTerrainLegend={hideOverlays} menuOpen={hideOverlays} />}
      {!hideOverlays && (
        <Compass3D
          onTap={isMobile ? () => setViewMenuOpen((open) => !open) : undefined}
        />
      )}
      {isMobile && !showPanels && viewMenuOpen && (
        <ViewMenu onClose={() => setViewMenuOpen(false)} />
      )}
      {isMobile && !showPanels && padOpen && (
        <TouchControls onDismiss={() => setPadOpen(false)} />
      )}
      {isMobile && !showPanels && !padOpen && (
        <button
          className="touchhint"
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setPadOpen(true) }}
          aria-label="Show controls"
        >CONTROLS</button>
      )}
      {isMobile && showPanels && <div className="mobile-overlay" />}
      {isMobile && (
        <button
          className="hamburger-menu"
          onClick={() => setMobilePanelsOpen((open) => !open)}
          aria-label={showPanels ? 'Hide panels' : 'Show panels'}
        >
          <span className={`hamburger-icon ${showPanels ? 'hamburger-icon--open' : ''}`}>
            <span></span>
            <span></span>
            <span></span>
          </span>
        </button>
      )}
    </div>
  )
}
