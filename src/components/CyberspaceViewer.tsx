import { useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from "@react-three/fiber"
import { Cyberspace } from './ThreeCyberspace'
import "../scss/CyberspaceViewer.scss"
import { Euler, PerspectiveCamera, Vector3 } from 'three'
import { DOWNSCALED_CYBERSPACE_AXIS } from '../libraries/Cyberspace'
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
        <ambientLight intensity={0.8} />
        <mesh position={new Vector3(0, 0, -5)}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={'orange'}/>
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
  const [pos, setPos] = useState<Vector3>(new Vector3(0, 0, 0))
  const [rot, setRot] = useState<Euler>(new Euler(0, 0, 0))

  // Get the camera and gl object from useThree
  const { camera } = useThree()

  useEffect(() => {
    // Set the camera's position and rotation
    camera.position.copy(pos)
    camera.rotation.copy(rot)
    // Update the camera's projection matrix
    camera.updateProjectionMatrix()
    // Force the renderer to render the scene with the updated camera
  }, [pos, rot, camera])

  useFrame( () => {
    // rotate the camera slowly each frame
    // setRot(new Euler(0, rot.y + 0.001, 0))
    setPos(new Vector3(0, 0, pos.z + 0.01))
  })

  return null
}