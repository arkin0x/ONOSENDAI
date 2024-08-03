import { useFrame, useThree } from "@react-three/fiber"
import React, { useRef, useContext, useState } from "react"
import * as THREE from "three"
import { AvatarContext } from "../providers/AvatarContext"
import { CYBERSPACE_SECTOR, extractActionState } from "../libraries/Cyberspace"
import { useRotationStore } from "../store/RotationStore"

const AvatarGeometry = new THREE.IcosahedronGeometry(.5,1)

// Create edges geometry for the golden wireframe
const AvatarGeometryEdges = new THREE.EdgesGeometry(AvatarGeometry)
const AvatarMaterialEdges = new THREE.LineBasicMaterial({ color: 0xff2323 })

// Add the wireframe to your scene

export const ThreeAvatar: React.FC<{ pubkey: string }> = ({ pubkey }) => {
  const { scene, camera } = useThree()
  const { getSimulatedState } = useContext(AvatarContext)
  const { rotation } = useRotationStore()
  const [position, setPosition] = useState(() => new THREE.Vector3(0, 0, 0))
  const [velocity, setVelocity] = useState(() => new THREE.Vector3(0, 0, 0))

  // Set fog on the scene
  const fogColor = 0x000000 // Color of the fog
  const near = 1 // Start distance of the fog
  const far = CYBERSPACE_SECTOR.toNumber() * 2 // End distance of the fog
  scene.fog = new THREE.Fog(fogColor, near, far)

  camera.far = 2**30
  

  useFrame(() => {
    const simulatedEvent = getSimulatedState(pubkey)
    if (simulatedEvent) {
      const { sectorPosition, velocity } = extractActionState(simulatedEvent)
      // console.log('3av',sectorPosition.toArray())//, velocity.toArray(), rotation.toArray())
      
      setPosition(sectorPosition.toVector3())
      setVelocity(velocity.toVector3())
    }

    const radius = 5
    const oppositeRotation = rotation.clone()
    const cameraDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(oppositeRotation)
    const cameraPosition = position.clone().add(cameraDirection.multiplyScalar(radius))
    camera.position.copy(cameraPosition)
    camera.lookAt(position)
    camera.updateProjectionMatrix()
  })

  // Calculate the quaternion for the cone's rotation based on the velocity vector
  const coneQuaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), // Default up vector
    velocity.normalize() // Normalized velocity vector
  )

  // Calculate the offset position for the cone's base
  const velocityMagnitude = velocity.length()
  const coneLength = Math.max(0.2, Math.min(0.8, velocityMagnitude))
  const conePosition = velocity.normalize()

  // console.log(position, camera.position)

  return (
    <group position={position}>
      {/* default avatar represented by dodecahedron */}
      <lineSegments scale={[1,1,1]} geometry={AvatarGeometryEdges} material={AvatarMaterialEdges} />
      <group rotation={[0, 0, 0]}>
        {/* vector represented by cone */}
        <mesh 
          position={conePosition}
          quaternion={coneQuaternion}
        >
          <coneGeometry args={[0.1, coneLength, 8]} />
          <meshBasicMaterial color={0xff9123} wireframe />
          {/* 0xff9123 */}
        </mesh>
        {/* <mesh>
          <boxGeometry args={[1,1,1]} />
          <meshBasicMaterial color={0x00ff00} transparent opacity={0.1} side={THREE.DoubleSide} />
        </mesh> */}
      </group>
    </group>
  )
}