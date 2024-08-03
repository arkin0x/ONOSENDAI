import { useContext, useEffect, useRef, useState } from 'react'
import { Canvas } from "@react-three/fiber"
import "../scss/CyberspaceViewer.scss"
import { Avatar } from '../libraries/Avatar'
import { IdentityContextType } from '../types/IdentityType'
import { IdentityContext } from '../providers/IdentityProvider'
import { SectorManager } from './SectorManager'
import { Controls } from './Controls'
import { Hud } from './Hud/Hud'
import { TelemetryDashboard } from './TelemetryDashboard'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceViewer = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {

  const viewerRef = useRef<HTMLDivElement>(null)
  const { identity } = useContext<IdentityContextType>(IdentityContext)

  // toggle telemetry view
  const [showTelemetry, setShowTelemetry] = useState(false)

  useEffect(() => {
    // set up keyboard listeres to activate telemetry panel
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 't') {
        setShowTelemetry(!showTelemetry)
      }
    }
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [showTelemetry])

  return (
    <div className="cyberspace-viewer" ref={viewerRef}>
      <div id="cyberspace">
        <Canvas style={style}>
          <ambientLight intensity={2.0} />
          <SectorManager adjacentLayers={0} />
          <Avatar pubkey={identity.pubkey} />
          <Controls />
        </Canvas>
      </div>
      <div id="cyberspace-hud">
        <Canvas style={{ position: 'absolute', top: 0 }} camera={{ near: 0.1, far: 1000, fov: 70 }}>
          <Hud/>
        </Canvas>
      </div>
      { showTelemetry ? <TelemetryDashboard/> : null}
    </div>
  )
}

export default CyberspaceViewer
