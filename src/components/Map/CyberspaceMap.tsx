import { useEffect } from 'react'
import { Canvas, useThree } from "@react-three/fiber"
import "../../scss/CyberspaceViewer.scss"
import { MapControls } from './MapControls'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import SectorGrid from './SectorGrid'
import { OrbitControls } from '@react-three/drei'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceMap = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {
  return (
    <div className="cyberspace-map">
      <div id="map">
        <Canvas style={style}>
          <ambientLight intensity={2.0} />
          <MapControls />
          <SectorGrid />
          <OrbitControls target={[0,0,0]} />
          <MapCamera />
          <EffectComposer>
            <Bloom mipmapBlur levels={9} intensity={20} luminanceThreshold={0.001} luminanceSmoothing={0} />
          </EffectComposer>
        </Canvas>
      </div>
    </div>
  )
}

export default CyberspaceMap 

function MapCamera() {
  const { camera } = useThree()
  useEffect(() => {
    const far = 1_000_000_000
    camera.far = far
    camera.updateProjectionMatrix()
  }, [camera])
  return null
}