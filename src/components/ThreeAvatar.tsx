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

  // update camera
  // useFrame(() => {
  //   // camera.position.copy(position.toVector3())
  //   // camera.quaternion.copy(rotation)
  //   // camera.updateProjectionMatrix()
  //   const clock = useRef<THREE.Clock>(new THREE.Clock())

  //   camera.position.copy(position.toVector3().add(new THREE.Vector3(1, 1, -1)))
  //   camera.lookAt(position.toVector3())
  //   camera.updateProjectionMatrix()
  //   console.log('playerv3', position.toVector3())
  // })
  const positionVec = position.toVector3()
    useFrame(({clock}) => {

      const elapsedTime = clock.getElapsedTime()
      const radius = 200
      const angle = 0//Math.PI//elapsedTime * 0.5 // adjust the rotation speed as desired
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      camera.position.set(positionVec.x + x, positionVec.y + 0, positionVec.z + z)
      camera.lookAt(position.toVector3())
      camera.updateProjectionMatrix()
    })

  return (
    <group position={position.toVector3()}>
      <lineSegments scale={[1,1,1]} geometry={AvatarGeometryEdges} material={AvatarMaterialEdges} />
      {/* <mesh geometry={AvatarGeometry} material={AvatarMaterial} /> */}
    </group>
  )
}
