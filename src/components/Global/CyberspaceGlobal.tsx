import { useContext, useEffect, useState } from 'react'
import { Canvas, useThree } from "@react-three/fiber"
import "../../scss/CyberspaceViewer.scss"
import { IdentityContextType } from '../../types/IdentityType'
import { IdentityContext } from '../../providers/IdentityProvider'
import { MapControls } from './MapControls'
import { Fog, Vector3 } from 'three'
// import { BlockMarkers } from './BlockMarkers'
// import { Constructs } from './Constructs'
// import { ObjectMarkers } from './ObjectMarkers'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import SectorGrid from './SectorGrid'
import { OrbitControls, Text } from '@react-three/drei'
import { useMapCenterSectorStore } from '../../store/MapCenterSectorStore'
import { Grid } from '../Map/Grid'
import { BlockMarkers } from '../Map/BlockMarkers'
import SectorMarkers from '../Map/SectorMarkers'
import { ThreeAvatarMarker } from '../Map/ThreeAvatarMarker'
import { ObjectMarkers } from '../Map/ObjectMarkers'
import { useAvatarStore } from '../../store/AvatarStore'
import { CYBERSPACE_AXIS, extractCyberspaceActionState } from '../../libraries/Cyberspace'
// import SectorCrawler from './SectorCrawler'

const MAP_SIZE = 100

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceGlobal = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {
  const { identity } = useContext<IdentityContextType>(IdentityContext)
  const { getSimulatedState } = useAvatarStore()
  const { centerSectorId } = useMapCenterSectorStore()

  const [avatarPosition, setAvatarPosition] = useState(new Vector3(0,0,0))

  const pubkey = identity?.pubkey

  useEffect(() => {
    const simulatedEvent = getSimulatedState(pubkey)
    if (!simulatedEvent) return
    const { coordinate } = extractCyberspaceActionState(simulatedEvent)
    const avatarPosition = coordinate.vector.divideScalar(CYBERSPACE_AXIS).multiplyScalar(MAP_SIZE).toVector3()
    setAvatarPosition(avatarPosition)
  }, [pubkey, getSimulatedState])

  return (
    <div className="cyberspace-global">
      <div id="global">
        <Canvas style={style}>
          <ambientLight intensity={2.0} />
          <Grid scale={MAP_SIZE}>
            <ThreeAvatarMarker position={avatarPosition} />
            <BlockMarkers scale={MAP_SIZE} />
            {/* <Constructs scale={MAP_SIZE} /> */}
            {/* <SectorMarkers pubkey={identity?.pubkey} scale={MAP_SIZE} /> */}
          </Grid>
          <OrbitControls target={avatarPosition} />
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

export default CyberspaceGlobal 

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