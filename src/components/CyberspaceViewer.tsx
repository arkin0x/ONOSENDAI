import { useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from "@react-three/fiber"
import { Cyberspace } from './ThreeCyberspace'
import "../scss/CyberspaceViewer.scss"
import { Euler, PerspectiveCamera, Vector3 } from 'three'
import { DOWNSCALED_CYBERSPACE_AXIS, HALF_DOWNSCALED_CYBERSPACE_AXIS } from '../libraries/Cyberspace'
// import { Avatar } from './Avatar.tsx'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceViewer = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {

  const viewerRef = useRef<HTMLDivElement>(null)

  return (
    <div className="cyberspace-viewer" ref={viewerRef}>
      <Canvas style={style}>
        <CyberspaceCamera />
        <ambientLight intensity={2.0} />
        <mesh position={new Vector3(0, 0, -5)}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={'#ffff00'}/>
        </mesh>
        <Cyberspace>
        </Cyberspace>
      </Canvas>
    </div>
  )
}

export default CyberspaceViewer

const CyberspaceCamera = () => {
  // define camera position and rotation
  const [pos, setPos] = useState<Vector3>(new Vector3(HALF_DOWNSCALED_CYBERSPACE_AXIS, HALF_DOWNSCALED_CYBERSPACE_AXIS, HALF_DOWNSCALED_CYBERSPACE_AXIS))
  const [rot, setRot] = useState<Euler>(new Euler(0, 0, 0))

  // Get the camera and gl object from useThree
  const { camera } = useThree()

  camera.far = DOWNSCALED_CYBERSPACE_AXIS * 2

  useEffect(() => {
    // Set the camera's position and rotation
    camera.position.copy(pos)
    camera.rotation.copy(rot)
    // Update the camera's projection matrix
    camera.updateProjectionMatrix()
    // Force the renderer to render the scene with the updated camera
  }, [pos, rot, camera])

  useFrame(({clock}) => {
    // rotate the camera slowly each frame
    // setRot(new Euler(rot.x + 0.01, 0, 0)) // rotate X
    // setRot(new Euler(0, rot.y + 0.01, 0)) // rotate y
    // setPos(new Vector3(0, 0, Math.sin(clock.elapsedTime) * 10 + 8))
  })

  return null
}