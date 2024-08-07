import { useContext, useEffect, useState } from 'react'
import { Canvas } from "@react-three/fiber"
import "../scss/CyberspaceViewer.scss"
import { IdentityContextType } from '../types/IdentityType'
import { IdentityContext } from '../providers/IdentityProvider'
import { Grid } from './Map/Grid'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const MAP_SIZE = 2**9

const CyberspaceMap = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {

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
    <div className="cyberspace-map">
      <div id="map">
        <Canvas style={style}>
          <ambientLight intensity={2.0} />
          <Grid size={MAP_SIZE}>
            {/* <AvatarMarker pubkey={identity.pubkey} /> */}
          </Grid>
        </Canvas>
      </div>
      {/* <div id="map-hud">
        <Canvas style={{ position: 'absolute', top: 0 }} camera={{ near: 0.1, far: 1000, fov: 70 }} children={undefined}>
        </Canvas>
      </div> */}
    </div>
  )
}

export default CyberspaceMap 
