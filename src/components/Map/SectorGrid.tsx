import React, { useRef, useMemo } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { Vector3, InstancedMesh, Matrix4, Color, BoxGeometry, FrontSide } from 'three'
import { Text } from "@react-three/drei"
import { useSectorStore, SectorId } from '../../store/SectorStore'
import { useMapCenterSectorStore } from '../../store/MapCenterSectorStore'
import { relativeSectorIndex } from '../../libraries/Cyberspace'
import COLORS from '../../data/Colors'
import { MAP_SECTOR_SIZE } from '../../libraries/CyberspaceMap'
import { ThreeAvatarMarker } from './ThreeAvatarMarker'
import { generateSectorName } from '../../libraries/SectorName'
import useNDKStore from '../../store/NDKStore'

interface SectorData {
  sectorId: SectorId;
  position: Vector3;
  color: Color;
  genesis?: boolean;
}

export const SectorGrid: React.FC = () => {
  const { getUser } = useNDKStore()
  const identity = getUser()
  const { sectorState, userCurrentSectorId, currentScanArea } = useSectorStore()
  const { centerSectorId, setCenter } = useMapCenterSectorStore()
  const meshRef = useRef<InstancedMesh>(null)
  const edgesRef = useRef<InstancedMesh>(null)
  const { raycaster, camera, pointer } = useThree()

  const pubkey = identity!.pubkey

  const sectorData: SectorData[] = useMemo(() => {
    if (!centerSectorId || !currentScanArea) return []

    return Array.from(currentScanArea.sectors).map((sectorId) => {
      const diff = relativeSectorIndex(centerSectorId, sectorId)
      const position = diff.multiplyScalar(MAP_SECTOR_SIZE).toVector3()
      const color = getSectorColor(sectorId, userCurrentSectorId, sectorState, pubkey)
      return { 
        sectorId, 
        position, 
        color, 
        genesis: sectorState[sectorId]?.isGenesis,
      }
    })
  }, [centerSectorId, currentScanArea, sectorState, userCurrentSectorId, pubkey])

  useFrame(() => {
    if (meshRef.current) {
      raycaster.setFromCamera(pointer, camera)
      raycaster.intersectObject(meshRef.current)
    }
  })

  const scanAreaBox = useMemo(() => {
    if (!currentScanArea || !centerSectorId) return null

    const { anchorSectorId, boundaries } = currentScanArea
    const [ax, ay, az] = anchorSectorId.split('-').map(Number)
    const { xMin, xMax, yMin, yMax, zMin, zMax } = boundaries

    const center = new Vector3(
      (xMin + xMax) / 2 * MAP_SECTOR_SIZE,
      (yMin + yMax) / 2 * MAP_SECTOR_SIZE,
      (zMin + zMax) / 2 * MAP_SECTOR_SIZE
    )

    const size = new Vector3(
      (xMax - xMin + 1) * MAP_SECTOR_SIZE,
      (yMax - yMin + 1) * MAP_SECTOR_SIZE,
      (zMax - zMin + 1) * MAP_SECTOR_SIZE
    )

    const anchorDiff = relativeSectorIndex(centerSectorId, anchorSectorId)
    const anchorPosition = anchorDiff.multiplyScalar(MAP_SECTOR_SIZE).toVector3()

    return (
      <mesh position={anchorPosition.add(center)}>
        <boxGeometry args={[size.x, size.y, size.z]} />
        <meshBasicMaterial color={COLORS.LIGHT_BLUE} transparent opacity={0.1} />
      </mesh>
    )
  }, [currentScanArea, centerSectorId])

  return (
    <>
      {scanAreaBox}
      {sectorData.map(({ sectorId, position, color, genesis }) => (
        <SectorMarker 
          key={sectorId} 
          sectorId={sectorId} 
          selected={sectorId === centerSectorId} 
          position={position} 
          color={color} 
          avatar={sectorId === userCurrentSectorId} 
          genesis={genesis}
        />
      ))}
    </>
  )
}

const SectorMarker: React.FC<{ 
  sectorId: SectorId, 
  selected: boolean, 
  avatar: boolean, 
  position: Vector3, 
  color: Color, 
  genesis?: boolean,
}> = ({ sectorId, selected, avatar, position, color, genesis }) => {
  const textPosition = position.clone().add(new Vector3(0.6, 0, 0))
  const genesisTextPosition = new Vector3(-0.6, 0, 0)

  const visited = color.getHex() === COLORS.LIGHT_PURPLE
  const hyperjump = color.getHex() === COLORS.YELLOW

  const solid = avatar || genesis || visited || hyperjump

  const opacity = solid ? 1 : 0.2
  
  return (
    <group position={position}>
      <lineSegments renderOrder={selected ? -1 : 0}>
        <edgesGeometry args={[new BoxGeometry(1,1,1)]} />
        <lineBasicMaterial color={COLORS.ORANGE} linewidth={1} transparent opacity={opacity}/>
      </lineSegments>
      { solid && (
        <mesh>
          <boxGeometry args={[1,1,1]} />
          <meshLambertMaterial side={FrontSide} color={color} opacity={0.1} transparent/>
        </mesh>
      )}
      { avatar && <ThreeAvatarMarker /> }
      { selected && (
        <Text 
          textAlign='left'
          fontSize={0.15}
          font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}
          anchorX={'left'}
          position={textPosition} 
          rotation={[0,0,0]} 
          frustumCulled={true}
          renderOrder={-1}
          color={color} >
          SECTOR {generateSectorName(sectorId).toUpperCase()}
        </Text>
      )}
      { genesis && (
        <Text 
          textAlign='right'
          fontSize={0.15}
          font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}
          anchorX={'right'}
          position={genesisTextPosition} 
          rotation={[0,0,0]} 
          frustumCulled={true}
          renderOrder={-1}
          color={COLORS.GENESIS} >
          GENESIS
        </Text>
      )}
      { hyperjump && (
        <Text 
          textAlign='right'
          fontSize={0.15}
          font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}
          anchorX={'right'}
          position={genesisTextPosition} 
          rotation={[0,0,0]} 
          frustumCulled={true}
          renderOrder={-1}
          color={COLORS.HYPERJUMP} >
          HYPERJUMP 
        </Text>
      )}
    </group>
  )
}

function getSectorColor(
  sectorId: SectorId, 
  userCurrentSectorId: SectorId | null, 
  sectorState: Record<SectorId, { avatars: string[], hyperjumps: any[], isGenesis: boolean }>, 
  pubkey: string
): Color {
  if (sectorId === userCurrentSectorId) return new Color(COLORS.ORANGE)
  if (sectorState[sectorId]?.isGenesis) return new Color(COLORS.GENESIS)
  if (sectorState[sectorId]?.hyperjumps.length > 0) return new Color(COLORS.YELLOW)
  if (sectorState[sectorId]?.avatars.length > 0) {
    if (sectorState[sectorId]?.avatars.length === 1 && !sectorState[sectorId].avatars.includes(pubkey) || sectorState[sectorId]?.avatars.length > 1) {
      // there are other avatars in this sector
      return new Color(COLORS.RED)
    }
    // it's just our trail in this sector
    return new Color(COLORS.LIGHT_PURPLE)
  }
  return new Color(COLORS.DARK_PURPLE)
}

export default SectorGrid
