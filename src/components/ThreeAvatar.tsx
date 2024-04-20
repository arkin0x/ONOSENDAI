import { useFrame, useThree } from "@react-three/fiber"
import React, { useRef } from "react"
import * as THREE from "three"
import { DecimalVector3 } from "../libraries/DecimalVector3"
import { Text } from "@react-three/drei"

const AvatarMaterial = new THREE.MeshStandardMaterial({
  color: 0xff2323,
  metalness: 0.8,
  roughness: 0.4,
  emissive: 0xff2323,
  emissiveIntensity: 0.2,
})

const AvatarGeometry = new THREE.IcosahedronGeometry(.5,1)

// Create edges geometry for the golden wireframe
const AvatarGeometryEdges = new THREE.EdgesGeometry(AvatarGeometry)
const AvatarMaterialEdges = new THREE.LineBasicMaterial({ color: 0xff2323 })

// Add the wireframe to your scene

export const ThreeAvatar: React.FC<{ position: DecimalVector3, rotation: THREE.Quaternion|undefined}> = ({position, rotation}) => {
  if (!rotation) {
    rotation = new THREE.Quaternion()
  }
  const { camera } = useThree()
  const currentRotation = useRef<THREE.Quaternion|null>(null)

  // update camera
  useFrame(() => {
    if (!currentRotation.current) {
      currentRotation.current = rotation.clone()
    }
    camera.position.copy(position.toVector3())
    camera.quaternion.copy(currentRotation.current)
    camera.updateProjectionMatrix()
  })

  return (
    <group position={position.toVector3()}>
      <lineSegments scale={[1,1,1]} geometry={AvatarGeometryEdges} material={AvatarMaterialEdges} />
      <mesh geometry={AvatarGeometry} material={AvatarMaterial} />
    </group>
  )
}
