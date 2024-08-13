import React, { useRef, useMemo, useState, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { Raycaster, Vector3, InstancedMesh, Matrix4, Color } from 'three'
import { Text } from "@react-three/drei"
import { useSectorStore } from '../../store/SectorStore'
import { useMapCenterSectorStore } from '../../store/MapCenterSectorStore'
import { CYBERSPACE_SECTOR, getSectorDecimalFromId, getSectorIdFromDecimal } from '../../libraries/Cyberspace'
import COLORS from '../../data/Colors'
import { DecimalVector3 } from '../../libraries/DecimalVector3'

const SECTOR_SIZE = 2**15
const GRID_SIZE = 5 // Number of sectors in each dimension of the grid

export const SectorGrid: React.FC<{ scale: number }> = ({ scale }) => {
  const { sectorState } = useSectorStore()
  const { centerSectorId, setCenter } = useMapCenterSectorStore()
  const { userCurrentSectorId } = useSectorStore()
  const meshRef = useRef<InstancedMesh>()
  const [hovered, setHovered] = useState<number | null>(null)
  const { raycaster, camera, scene } = useThree()

  const sectorPositions = useMemo(() => {
    const positions = []
    const center = getSectorDecimalFromId(centerSectorId || userCurrentSectorId)
    for (let x = -GRID_SIZE / 2; x < GRID_SIZE / 2; x++) {
      for (let y = -GRID_SIZE / 2; y < GRID_SIZE / 2; y++) {
        for (let z = -GRID_SIZE / 2; z < GRID_SIZE / 2; z++) {
          const pos = center.add(new DecimalVector3(x, y, z).multiplyScalar(CYBERSPACE_SECTOR))
          positions.push(pos)
        }
      }
    }
    return positions
  }, [centerSectorId, userCurrentSectorId])

  useEffect(() => {
    if (meshRef.current) {
      sectorPositions.forEach((pos, i) => {
        const matrix = new Matrix4().setPosition(pos.toVector3())
        meshRef.current!.setMatrixAt(i, matrix)
      })
      meshRef.current.instanceMatrix.needsUpdate = true
    }
  }, [sectorPositions])

  useFrame(() => {
    if (meshRef.current) {
      raycaster.setFromCamera(scene.position, camera)
      const intersects = raycaster.intersectObject(meshRef.current)
      if (intersects.length > 0) {
        setHovered(intersects[0].instanceId)
      } else {
        setHovered(null)
      }
    }
  })

  const handleClick = (event) => {
    if (hovered !== null) {
      const newCenterSectorId = getSectorIdFromDecimal(sectorPositions[hovered])
      setCenter(newCenterSectorId)
    }
  }

  return (
    <instancedMesh
      ref={meshRef}
      args={[null, null, sectorPositions.length]}
      onClick={handleClick}
    >
      <boxGeometry args={[SECTOR_SIZE, SECTOR_SIZE, SECTOR_SIZE]} />
      <meshBasicMaterial wireframe color={COLORS.BLUE} />
      {sectorPositions.map((pos, i) => (
        <SectorMarker
          key={i}
          position={pos.toVector3()}
          color={getSectorColor(getSectorIdFromDecimal(pos), sectorState)}
          isHovered={i === hovered}
        />
      ))}
    </instancedMesh>
  )
}

const SectorMarker: React.FC<{ position: Vector3, color: Color, isHovered: boolean }> = ({ position, color, isHovered }) => {
  return (
    <>
      <lineSegments position={position}>
        <edgesGeometry args={[new BoxGeometry(SECTOR_SIZE, SECTOR_SIZE, SECTOR_SIZE)]} />
        <lineBasicMaterial color={isHovered ? COLORS.WHITE : color} linewidth={isHovered ? 2 : 1} />
      </lineSegments>
      <Text 
        position={position.clone().add(new Vector3(-SECTOR_SIZE/2, 0, 0))}
        fontSize={SECTOR_SIZE/10}
        color={color}
        anchorX="right"
      >
        {getSectorIdFromDecimal(position)}
      </Text>
    </>
  )
}

function getSectorColor(sectorId: string, sectorState: Record<string, any>): Color {
  if (sectorState[sectorId]?.isGenesis) return new Color(COLORS.YELLOW)
  if (sectorState[sectorId]?.avatars.length > 0) return new Color(COLORS.ORANGE)
  if (sectorState[sectorId]) return new Color(COLORS.BLUE)
  return new Color(COLORS.DARK_PURPLE)
}

export default SectorGrid