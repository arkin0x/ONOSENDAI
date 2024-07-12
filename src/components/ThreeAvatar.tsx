import { useFrame, useThree } from "@react-three/fiber"
import React, { useRef } from "react"
import * as THREE from "three"
import { DecimalVector3 } from "../libraries/DecimalVector3"
import { Plane, Text } from "@react-three/drei"

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

  camera.far = 2**30

  // console.log(rotation.toArray().map((x) => x.toFixed(2)))

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
      const radius = 5
      const angle = -Math.PI/2//Math.PI//elapsedTime * 0.5 // adjust the rotation speed as desired
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const oppositeRotation = rotation.clone()//.invert()
      const cameraDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(oppositeRotation)
      const cameraPosition = positionVec.clone().add(cameraDirection.multiplyScalar(radius))
      camera.position.copy(cameraPosition)
      camera.lookAt(position.toVector3())
      camera.updateProjectionMatrix()
    })

  return (
    <group position={position.toVector3()}>
      <lineSegments scale={[1,1,1]} geometry={AvatarGeometryEdges} material={AvatarMaterialEdges} />
      {/* <mesh geometry={AvatarGeometry} material={AvatarMaterial} /> */}
      <mesh 
        position={new THREE.Vector3(0, 0, 0)}
        rotation={new THREE.Euler().setFromVector3(new THREE.Vector3(Math.PI/2,0,0))}
      >
        <coneGeometry args={[.1, 1, 16]}/>
        <meshNormalMaterial />
      </mesh>
      <Plane args={[1, 1]} position={[0, -0.5, 0]} rotation={new THREE.Euler(Math.PI/2, 0, 0, 'XYZ')} material={new THREE.MeshBasicMaterial({color: 0xff0000, side: THREE.DoubleSide})}/>
    </group>
  )
}
