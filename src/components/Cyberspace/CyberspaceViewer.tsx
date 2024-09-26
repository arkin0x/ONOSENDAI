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
import COLORS from '../../data/Colors'
import { NavText } from '../Interface'

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
          <SectorManager adjacentLayers={1} />
          <Avatar pubkey={identity!.pubkey} />
          <Controls />
          <EffectComposer>
            <Bloom mipmapBlur levels={9} intensity={20} luminanceThreshold={0.001} luminanceSmoothing={0} />
          </EffectComposer>
        </Canvas>
      </div>
      <div id="cyberspace-hud">
        <Canvas style={{ position: 'absolute', top: 0 }} camera={{ near: 0.1, far: 1000, fov: 70 }}>
          <ambientLight intensity={2.0} />
          <group position={[0,-150,-180]}>
            <NavText text={"SHARDS"} position={{x: -11, y: 0}} align="center" color={showShardList ? COLORS.ORANGE : COLORS.PURPLE} onClick={() => setShowShardList(!showShardList)}/> 
            <NavText text={"TELEMETRY"} position={{x: 25, y: 0}} align="center" color={showTelemetry ? COLORS.ORANGE : COLORS.DARK_PURPLE} onClick={() => setShowTelemetry(!showTelemetry)} customWidth={2}/> 
          </group>
          <Hud/>
          { showShardList ? <ShardList deploy/> : null}
          <EffectComposer>
            <Bloom mipmapBlur levels={9} intensity={5} luminanceThreshold={0} luminanceSmoothing={0} />
          </EffectComposer>
        </Canvas>
      </div>
      { showTelemetry ? <TelemetryDashboard/> : null}
    </div>
  )
}

export default CyberspaceViewer
