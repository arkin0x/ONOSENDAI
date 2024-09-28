import React, { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Group, Vector3 } from 'three'
import COLORS from '../../data/Colors'

interface VertexSelectionIndicatorProps {
  selectedVertices: string[];
  faceCreated: boolean;
}

const VertexSelectionIndicator: React.FC<VertexSelectionIndicatorProps> = ({ selectedVertices, faceCreated }) => {
  const groupRef = useRef<Group>(null)
  const { camera } = useThree()

  useFrame(() => {
    if (groupRef.current) {
      const cameraPosition = camera.position.clone()
      const offset = new Vector3(.07, -.09, -.2)
      offset.applyQuaternion(camera.quaternion)
      groupRef.current.position.copy(cameraPosition.add(offset))
      groupRef.current.quaternion.copy(camera.quaternion)
      const SCALAR = 0.03
      const scale = new Vector3(SCALAR, SCALAR, SCALAR)
      groupRef.current.scale.copy(scale)
    }
  })

  return (
    <group ref={groupRef}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[
          Math.cos(i * (2 * Math.PI / 3)) * 0.3,
          Math.sin(i * (2 * Math.PI / 3)) * 0.3,
          0
        ]}>
          <sphereGeometry args={[0.1, 32, 32]} />
          <meshBasicMaterial color={(i < selectedVertices.length || (faceCreated && selectedVertices.length === 3)) ? COLORS.ORANGE : COLORS.BLACK} />
        </mesh>
      ))}
    </group>
  )
}

export default VertexSelectionIndicator