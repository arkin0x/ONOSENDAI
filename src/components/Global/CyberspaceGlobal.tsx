import { useContext, useEffect, useState } from 'react'
import { Canvas, useThree } from "@react-three/fiber"
import "../../scss/CyberspaceViewer.scss"
import { Fog, Vector3 } from 'three'
// import { BlockMarkers } from './BlockMarkers'
// import { Constructs } from './Constructs'
// import { ObjectMarkers } from './ObjectMarkers'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { OrbitControls, Text } from '@react-three/drei'
import { useMapCenterSectorStore } from '../../store/MapCenterSectorStore'
import { Grid } from '../Map/Grid'
import { BlockMarkers } from '../Map/BlockMarkers'
import { ThreeAvatarMarker } from '../Map/ThreeAvatarMarker'
import { useAvatarStore } from '../../store/AvatarStore'
import { CYBERSPACE_AXIS, extractCyberspaceActionState } from '../../libraries/Cyberspace'
import useNDKStore from '../../store/NDKStore'
// import SectorCrawler from './SectorCrawler'

const MAP_SIZE = 100

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceGlobal = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {
  const { getUser } = useNDKStore()
  const identity = getUser()
  const { getSimulatedState } = useAvatarStore()
  const { centerSectorId } = useMapCenterSectorStore()

  const [avatarPosition, setAvatarPosition] = useState(new Vector3(0,0,0))

  const pubkey = identity!.pubkey

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
        <Canvas style={style} camera={{position: [MAP_SIZE/2,MAP_SIZE*.9,MAP_SIZE]}}>
          <ambientLight intensity={2.0} />
          <Grid scale={MAP_SIZE}>
            <ThreeAvatarMarker position={avatarPosition} />
            <BlockMarkers scale={MAP_SIZE} />
            {/* <Constructs scale={MAP_SIZE} /> */}
            {/* <ObjectMarkers scale={MAP_SIZE} /> */}
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