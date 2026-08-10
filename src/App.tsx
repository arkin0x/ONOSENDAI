import { useState } from 'react'
import { Hud } from './hud/Hud'
import { ScaleBar } from './hud/ScaleBar'
import { Compass3D } from './scene/Compass3D'
import { Scene } from './scene/Scene'
import { useKeyboard } from './hooks/useKeyboard'
import { useProofListener } from './hooks/useProofListener'
import { useIsMobile } from './hooks/useIsMobile'

export default function App(): JSX.Element {
  useKeyboard()
  useProofListener()
  const isMobile = useIsMobile()
  const [showPanels, setShowPanels] = useState(!isMobile)

  // On mobile, hide ScaleBar, Compass3D, and TerrainLegend when panels are visible
  const hideOverlays = isMobile && showPanels

  return (
    <div className="app">
      <Scene />
      {showPanels && <Hud hideTerrainLegend={hideOverlays} />}
      {!hideOverlays && <ScaleBar />}
      {!hideOverlays && <Compass3D />}
      {isMobile && showPanels && <div className="mobile-overlay" />}
      {isMobile && (
        <button
          className="hamburger-menu"
          onClick={() => setShowPanels(!showPanels)}
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
