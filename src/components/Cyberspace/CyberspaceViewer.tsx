import { useEffect, useRef, useState } from 'react'
import { Canvas } from "@react-three/fiber"
import "../../scss/CyberspaceViewer.scss"
import { Avatar } from './Avatar'
import SectorManager from './SectorManager'
import { Controls } from './Controls'
import { Hud } from '../Hud/Hud'
import { TelemetryDashboard } from './TelemetryDashboard'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import useNDKStore from '../../store/NDKStore'
import ShardList from '../Build/ShardList'
import { Button3D } from '../Button3D'
import COLORS from '../../data/Colors'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceViewer = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {
  const { getUser } = useNDKStore()
  const identity = getUser()
  const viewerRef = useRef<HTMLDivElement>(null)

  // toggle telemetry view
  const [showTelemetry, setShowTelemetry] = useState(false)
  const [showShardList, setShowShardList] = useState(false)

  useEffect(() => {
    // set up keyboard listeners to activate telemetry panel
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
          <SectorManager adjacentLayers={1} />
          <Avatar pubkey={identity!.pubkey} />
          <Controls />
          <Hud showFullHud={true} />
          <Button3D 
            text={"SHARDS"} 
            buttonColor={showShardList ? COLORS.ORANGE : COLORS.PURPLE} 
            display='wireframe' 
            position={[0, -3.25, 0]} 
            rotation={[-Math.PI/4,0,0]} 
            onClick={() => setShowShardList(!showShardList)} 
          />
          { showShardList ? <ShardList deploy/> : null}
          <EffectComposer>
            <Bloom mipmapBlur levels={9} intensity={20} luminanceThreshold={0.001} luminanceSmoothing={0} />
          </EffectComposer>
        </Canvas>
      </div>
      { showTelemetry ? <TelemetryDashboard/> : null}
    </div>
  )
}

export default CyberspaceViewer
