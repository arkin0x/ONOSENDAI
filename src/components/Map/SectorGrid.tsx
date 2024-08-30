import { useRef, useMemo, useState, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { Vector3, InstancedMesh, Matrix4, Color, BoxGeometry } from 'three'
import { Text } from "@react-three/drei"
import { SectorState, useSectorStore } from '../../store/SectorStore'
import { useMapCenterSectorStore } from '../../store/MapCenterSectorStore'
import { relativeSectorIndex } from '../../libraries/Cyberspace'
import COLORS from '../../data/Colors'
import { MAP_SECTOR_SIZE } from '../../libraries/CyberspaceMap'
import { AvatarMarker } from './AvatarMarker'

interface SectorData {
  sectorId: string
  position: Vector3
  color: Color
}

export const SectorGrid = () => {
  const { sectorState, userCurrentSectorId } = useSectorStore()
  const { centerSectorId, setCenter } = useMapCenterSectorStore()
  const meshRef = useRef<InstancedMesh>(null)
  const edgesRef = useRef<InstancedMesh>(null)
  const [hovered, setHovered] = useState<number>()
  const { raycaster, camera, pointer } = useThree()

  const focusSectorId = centerSectorId || userCurrentSectorId

  const sectorData: SectorData[] = useMemo(() => {
    return Object.entries(sectorState).map(([sectorId]) => {
      if (!focusSectorId) return false // no focus sector, can't do diff
      const diff = relativeSectorIndex(focusSectorId, sectorId)
      console.log('diff', diff.toArray(0), focusSectorId, sectorId)
      const position = diff.multiplyScalar(MAP_SECTOR_SIZE).toVector3()
      const color = getSectorColor(sectorId, sectorState)
      return { sectorId, position, color }
    }).filter(Boolean) as SectorData[]
  }, [focusSectorId, sectorState])

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
      // @TODO: this is broken
      // const newCenterSectorId = new DecimalVector3().fromArray(sectorData[hovered].position.toArray())
      setCenter(newCenterSectorId)
    }
  }

  console.log(sectorData)

  return (
    <>
      {sectorData.map(({ sectorId, position, color }, i) => (
        <SectorMarker key={sectorId} sectorId={sectorId} selected={sectorId === centerSectorId} position={position} color={color} />
      ))}
    </>
  )
}

export default SectorGrid

function getSectorColor(sectorId: string, sectorState: SectorState): Color {
  console.log('getSectorColor', sectorState[sectorId], sectorState)
  if (sectorState[sectorId]?.isGenesis) return new Color(COLORS.YELLOW)
  if (sectorState[sectorId]?.avatars.length > 0) return new Color(COLORS.RED)
  if (sectorState[sectorId]) return new Color(COLORS.ORANGE)
  return new Color(COLORS.DARK_PURPLE)
}

function SectorMarker({ sectorId, selected, avatar, position, color }: { sectorId: string, selected: boolean, avatar: boolean, position: Vector3, color: Color }) {

  return (
    <group position={position}>
      <lineSegments renderOrder={selected ? -1 : 0}>
        <edgesGeometry args={[new BoxGeometry(1,1,1)]} />
        <lineBasicMaterial color={color} linewidth={0.5} />
      </lineSegments>
      { avatar ? <AvatarMarker /> : null }
      { selected ? <Text 
        position={position.clone().add(new Vector3(-MAP_SECTOR_SIZE/2, 0, 0))}
        fontSize={MAP_SECTOR_SIZE/10}
        color={color}
        anchorX="right"
      >
        {sectorId}
      </Text> : null }
    </group>
  )

}