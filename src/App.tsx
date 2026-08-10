import { useState } from 'react'
import { Hud } from './hud/Hud'
import { ScaleBar } from './hud/ScaleBar'
import { Compass3D } from './scene/Compass3D'
import { Scene } from './scene/Scene'
import { PrototypeScene } from './scene/prototype/Variants'
import { PrototypeSwitcher } from './scene/prototype/PrototypeSwitcher'
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

  // PROTOTYPE (ticket 03): ?variant= swaps the spatial model in dev only.
  const proto = import.meta.env.DEV && new URLSearchParams(window.location.search).has('variant')

  return (
    <div className="app">
      {proto ? <PrototypeScene /> : <Scene />}
      {showPanels && <Hud hideTerrainLegend={hideOverlays} menuOpen={hideOverlays} />}
      {!hideOverlays && <ScaleBar />}
      {!hideOverlays && <Compass3D />}
      {isMobile && showPanels && <div className="mobile-overlay" />}
      {proto && <PrototypeSwitcher />}
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
