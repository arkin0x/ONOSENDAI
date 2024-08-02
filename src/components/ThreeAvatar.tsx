import { useFrame, useThree } from "@react-three/fiber"
import React, { useRef, useContext, useState } from "react"
import * as THREE from "three"
import { AvatarContext } from "../providers/AvatarContext"
import { extractActionState } from "../libraries/Cyberspace"
import { useRotationStore } from "../store/RotationStore"

const AvatarGeometry = new THREE.IcosahedronGeometry(.5,1)

// Create edges geometry for the golden wireframe
const AvatarGeometryEdges = new THREE.EdgesGeometry(AvatarGeometry)
const AvatarMaterialEdges = new THREE.LineBasicMaterial({ color: 0xff2323 })

// Add the wireframe to your scene

export const ThreeAvatar: React.FC<{ pubkey: string }> = ({ pubkey }) => {
  const { camera } = useThree()
  const { getSimulatedState } = useContext(AvatarContext)
  const { rotation } = useRotationStore()
  const [position, setPosition] = useState(() => new THREE.Vector3(0, 0, 0))
  const [velocity, setVelocity] = useState(() => new THREE.Vector3(0, 0, 0))


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
      <lineSegments scale={[1,1,1]} geometry={AvatarGeometryEdges} material={AvatarMaterialEdges} />
      <group rotation={[0, 0, 0]}>
        <mesh
          position={conePosition}
          quaternion={coneQuaternion}
        >
          <coneGeometry args={[0.1, coneLength, 8]} />
          <meshBasicMaterial color={0xff2323} wireframe />
          {/* <meshStandardMaterial 
            wireframe 
            color={0xff2323} 
            metalness={0.8}
            roughness={0.4}
            emissive={0xff2323}
            emissiveIntensity={0.2}
          /> */}
        </mesh>
      </group>
    </group>
  )
}