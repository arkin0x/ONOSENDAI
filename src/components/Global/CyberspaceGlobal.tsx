import { useEffect, useState } from 'react'
import { Canvas, useThree } from "@react-three/fiber"
import "../../scss/CyberspaceViewer.scss"
import { Fog, Vector3 } from 'three'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { OrbitControls } from '@react-three/drei'
import { Grid } from '../Map/Grid'
import { Hyperjumps } from '../Map/Hyperjumps'
import { ThreeAvatarMarker } from '../Map/ThreeAvatarMarker'
import { useAvatarStore } from '../../store/AvatarStore'
import { CYBERSPACE_AXIS, CyberspacePlane, extractCyberspaceActionState } from '../../libraries/Cyberspace'
import useNDKStore from '../../store/NDKStore'
import { SimpleHud } from '../Hud/SimpleHud'

const MAP_SIZE = 100

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceGlobal = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {
  const { getUser } = useNDKStore()
  const identity = getUser()
  const { getSimulatedState } = useAvatarStore()
  const [avatarPosition, setAvatarPosition] = useState(new Vector3(0,0,0))
  const [avatarPlane, setAvatarPlane] = useState<CyberspacePlane>(CyberspacePlane.DSpace)

  const pubkey = identity!.pubkey

  useEffect(() => {
    const simulatedEvent = getSimulatedState(pubkey)
    if (!simulatedEvent) return
    const { coordinate, plane } = extractCyberspaceActionState(simulatedEvent)
    setAvatarPlane(plane)
    const avatarPosition = coordinate.vector.divideScalar(CYBERSPACE_AXIS).multiplyScalar(MAP_SIZE).toVector3()
    setAvatarPosition(avatarPosition)
  }, [pubkey, getSimulatedState])

  return (
    <div className="cyberspace-global">
      <div id="global">
        <Canvas style={style} camera={{position: [MAP_SIZE/2,MAP_SIZE*.9,MAP_SIZE]}}>
          <ambientLight intensity={2.0} />
          <Grid scale={MAP_SIZE} plane={avatarPlane}>
            <ThreeAvatarMarker position={avatarPosition} />
            <Hyperjumps scale={MAP_SIZE} />
          </Grid>
          <OrbitControls target={avatarPosition} />
          <SimpleHud showSectorInfo={true} />
          <EffectComposer>
            <Bloom mipmapBlur levels={9} intensity={20} luminanceThreshold={0.001} luminanceSmoothing={0} />
          </EffectComposer>
          <MapCamera />
        </Canvas>
      </div>
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
  }, [camera, scene])
  return null
}