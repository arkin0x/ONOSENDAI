import { useContext, useRef } from 'react'
import { Canvas } from "@react-three/fiber"
import "../scss/CyberspaceViewer.scss"
import { Avatar } from '../libraries/Avatar'
import { IdentityContextType } from '../types/IdentityType'
import { IdentityContext } from '../providers/IdentityProvider'
import { SectorManager } from './SectorManager'
import { Controls } from './Controls'
import { Vector3 } from 'three'
import { useFrame } from '@react-three/fiber'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceViewer = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {

  const viewerRef = useRef<HTMLDivElement>(null)
  const { identity } = useContext<IdentityContextType>(IdentityContext)

  return (
    <div className="cyberspace-viewer" ref={viewerRef}>
      <Canvas style={style}>
        <ambientLight intensity={2.0} />
        <SectorManager />
        <Avatar pubkey={identity.pubkey} />
        {/* <Controls /> */}
        <TestMesh />
      </Canvas>
    </div>
  )
}

export default CyberspaceViewer

const TestMesh = () => {

  const testRef = useRef<THREE.Mesh>(null)

  useFrame(() => {
    if (testRef.current) {
      testRef.current.rotation.x += 0.01
      testRef.current.rotation.y += 0.01
    }
  })

  return (
    <mesh ref={testRef}
      position={new Vector3(0, 0, -1)}
    >
      <coneGeometry args={[1, 4, 16]}/>
      <meshNormalMaterial />
    </mesh>
  )
}