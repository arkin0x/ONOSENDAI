import { useEffect } from 'react'
import { Canvas, useThree } from "@react-three/fiber"
import "../../scss/CyberspaceViewer.scss"
import { MapControls } from './MapControls'
import { Fog } from 'three'
// import { BlockMarkers } from './BlockMarkers'
// import { Constructs } from './Constructs'
// import { ObjectMarkers } from './ObjectMarkers'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import SectorGrid from './SectorGrid'
import { OrbitControls } from '@react-three/drei'
import { useMapCenterSectorStore } from '../../store/MapCenterSectorStore'
// import SectorCrawler from './SectorCrawler'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceMap = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {
  const { centerSectorId } = useMapCenterSectorStore()

  // const orbitCameraTarget = sectorIdToMapCoord(centerSectorId).toVector3()

  return (
    <div className="cyberspace-map">
      <div id="map">
        <Canvas style={style}>
          <ambientLight intensity={2.0} />
          <MapControls />
          {/* <ObjectMarkers scale={MAP_SIZE} /> */}
          {/* <BlockMarkers scale={MAP_SIZE} /> */}
          {/* <Constructs scale={MAP_SIZE} /> */}
          <SectorGrid />
          <OrbitControls target={[0,0,0]} />
          <MapCamera />
          <EffectComposer>
            <Bloom mipmapBlur levels={9} intensity={20} luminanceThreshold={0.001} luminanceSmoothing={0} />
          </EffectComposer>
        </Canvas>
      </div>
      {/* <div id="map-hud">
        <Canvas style={{ position: 'absolute', top: 0 }} camera={{ near: 0.1, far: 1000, fov: 70 }} children={undefined}>
          <Text fontSize={0.07}>{orbitCameraTarget.toArray().toString()}</Text>
        </Canvas>
      </div> */}
    </div>
  )
}

export default CyberspaceMap 

function MapCamera() {
  const { camera, scene } = useThree()
  useEffect(() => {
    const fogColor = 0x000000 // Color of the fog
    const far = 1000
    scene.fog = new Fog(fogColor, 1, far / 2)
    camera.far = far
    camera.updateProjectionMatrix()
  }, [camera])
  return null
}