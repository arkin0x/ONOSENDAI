import React, { useRef, useMemo, useState, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { Vector3, InstancedMesh, Matrix4, Color, BoxGeometry, EdgesGeometry, LineSegments, LineBasicMaterial } from 'three'
import { Text } from "@react-three/drei"
import { SectorState, useSectorStore } from '../../store/SectorStore'
import { useMapCenterSectorStore } from '../../store/MapCenterSectorStore'
import { getSectorDecimalFromId, getSectorIdFromDecimal } from '../../libraries/Cyberspace'
import COLORS from '../../data/Colors'
import { DecimalVector3 } from '../../libraries/DecimalVector3'

const SECTOR_SIZE = 2**15

export const SectorGrid: React.FC<{ scale: number }> = ({ scale }) => {
  const { sectorState } = useSectorStore()
  const { setCenter } = useMapCenterSectorStore()
  const meshRef = useRef<InstancedMesh>(null)
  const edgesRef = useRef<InstancedMesh>(null)
  const [hovered, setHovered] = useState<number>()
  const { raycaster, camera, pointer } = useThree()

  const sectorData = useMemo(() => {
    return Object.entries(sectorState).map(([sectorId]) => {
      const xyz = getSectorDecimalFromId(sectorId)
      const position = xyz.multiplyScalar(SECTOR_SIZE).toVector3()
      const color = getSectorColor(sectorId, sectorState)
      return { sectorId, position, color }
    })
  }, [sectorState])

  useEffect(() => {
    if (meshRef.current && edgesRef.current) {
      sectorData.forEach(({ position, color }, i) => {
        const matrix = new Matrix4().setPosition(position)
        meshRef.current!.setMatrixAt(i, matrix)
        meshRef.current!.setColorAt(i, color)
        edgesRef.current!.setMatrixAt(i, matrix)
      })
      meshRef.current.instanceMatrix.needsUpdate = true
      meshRef.current.instanceColor!.needsUpdate = true
      edgesRef.current.instanceMatrix.needsUpdate = true
    }
  }, [sectorData])

  useFrame(() => {
    if (meshRef.current) {
      raycaster.setFromCamera(pointer, camera)
      const intersects = raycaster.intersectObject(meshRef.current)
      setHovered(intersects.length > 0 ? intersects[0].instanceId : undefined)
    }
  })

  const handleClick = () => {
    if (hovered !== null) {
      const newCenterSectorId = getSectorIdFromDecimal(new DecimalVector3().fromArray(sectorData[hovered].position.toArray()))
      setCenter(newCenterSectorId)
    }
  }

  const boxGeometry = useMemo(() => new BoxGeometry(SECTOR_SIZE, SECTOR_SIZE, SECTOR_SIZE), [])
  const edgesGeometry = useMemo(() => new EdgesGeometry(boxGeometry), [boxGeometry])

  return (
    <group scale={scale}>
      <instancedMesh
        ref={meshRef}
        args={[boxGeometry, null, sectorData.length]}
        onClick={handleClick}
      >
        <meshBasicMaterial transparent opacity={0.1} />
      </instancedMesh>
      <instancedMesh
        ref={edgesRef}
        args={[edgesGeometry, null, sectorData.length]}
      >
        <lineBasicMaterial color={0xffffff} />
      </instancedMesh>
      {sectorData.map(({ sectorId, position }, i) => (
        <Text
          key={sectorId}
          position={position.clone().add(new Vector3(-SECTOR_SIZE/2, 0, 0))}
          fontSize={SECTOR_SIZE/10}
          color={hovered === i ? 0xffffff : 0xaaaaaa}
          anchorX="right"
        >
          {sectorId}
        </Text>
      ))}
    </group>
  )
}

function getSectorColor(sectorId: string, sectorState: SectorState): Color {
  if (sectorState[sectorId]?.isGenesis) return new Color(COLORS.YELLOW)
  if (sectorState[sectorId]?.avatars.length > 0) return new Color(COLORS.RED)
  if (sectorState[sectorId]) return new Color(COLORS.ORANGE)
  return new Color(COLORS.DARK_PURPLE)
}

export default SectorGrid