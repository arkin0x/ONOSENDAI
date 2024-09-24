import { useFrame, useThree } from "@react-three/fiber"
import React, { useEffect, useState } from "react"
import { CYBERSPACE_SECTOR, extractCyberspaceActionState } from "../../libraries/Cyberspace"
import { useRotationStore } from "../../store/RotationStore"
import { AvatarGeometryEdges, AvatarMaterialEdges } from "../../data/AvatarModel"
import { useSectorStore } from "../../store/SectorStore"
import COLORS from "../../data/Colors"
import { useAvatarStore } from "../../store/AvatarStore"
import { Fog, LineBasicMaterial, Quaternion, Vector3 } from "three"

export const ThreeAvatar: React.FC<{ pubkey: string }> = ({ pubkey }) => {
  const { scene, camera } = useThree()
  const { getSimulatedState } = useAvatarStore()
  const { rotation } = useRotationStore()
  const { updateUserCurrentSectorId } = useSectorStore()
  const [position, setPosition] = useState(() => new Vector3(0, 0, 0))
  const [velocity, setVelocity] = useState(() => new Vector3(0, 0, 0))
  const [frameSectorId, setFrameSectorId] = useState<string>()

  // Set fog on the scene
  const fogColor = 0x000000 // Color of the fog
  const near = 1 // Start distance of the fog
  const far = CYBERSPACE_SECTOR.toNumber() * 2 // End distance of the fog
  scene.fog = new Fog(fogColor, near, far)

  camera.far = 2**30

  // get simulated sectorPosition and velocity each frame
  useFrame(() => {
    const simulatedEvent = getSimulatedState(pubkey, true)
    if (simulatedEvent) {
      const { localCoordinate, velocity, sector } = extractCyberspaceActionState(simulatedEvent)
      
      setPosition(localCoordinate.vector.toVector3())
      setVelocity(velocity.toVector3())
      setFrameSectorId(sector.id)
    }
  })

  // "Memoize" updateSectorId call
  useEffect(() => {
    if (frameSectorId) {
      updateUserCurrentSectorId(frameSectorId)
    }
  }, [frameSectorId, updateUserCurrentSectorId])

  // update camera each frame
  useFrame(() => {
    const radius = 5
    const oppositeRotation = rotation.clone()
    const cameraDirection = new Vector3(0, 0, -1).applyQuaternion(oppositeRotation)
    const cameraPosition = position.clone().add(cameraDirection.multiplyScalar(radius))
    camera.position.copy(cameraPosition)
    camera.lookAt(position)
    camera.updateProjectionMatrix()
  })

  // Calculate the quaternion for the cone's rotation based on the velocity vector
  const coneQuaternion = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0), // Default up vector
    velocity.normalize() // Normalized velocity vector
  )

  // Calculate the offset position for the cone's base
  const velocityMagnitude = velocity.length()
  const coneLength = Math.max(0.2, Math.min(0.8, velocityMagnitude))
  const conePosition = velocity.normalize()

  function renderGrid () {
    const gridCount = 1
    const grids = []
    for (let i = 0; i < gridCount; i++) {
      const gridPos = new Vector3().fromArray(position.clone().toArray().map((v) => Math.floor(v) + 0.5))
      gridPos.setY(gridPos.y - Math.floor(gridCount/2) + i)
      // gridPos.setY(position.y)
      const gridMaterial = new LineBasicMaterial({
        color: COLORS.DARK_PURPLE,
        transparent: true,
        opacity: 1 * Math.abs(i - gridCount/2)
      })
      grids.push(<gridHelper position={gridPos} args={[13, 13]} material={gridMaterial} />)
    }

    return grids
  }


  return (
    <>
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
          <meshBasicMaterial color={COLORS.ORANGE} wireframe />
        </mesh>
      </group>
    </group>
    <group>
      {renderGrid()}
    </group>
    </>
  )
}