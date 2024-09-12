import { useRef, useMemo, useState, useEffect, useContext } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { Vector3, InstancedMesh, Matrix4, Color, BoxGeometry, BackSide, RGBA_ASTC_10x10_Format, FrontSide } from 'three'
import { Text } from "@react-three/drei"
import { SectorState, useSectorStore } from '../../store/SectorStore'
import { useMapCenterSectorStore } from '../../store/MapCenterSectorStore'
import { relativeSectorIndex } from '../../libraries/Cyberspace'
import COLORS from '../../data/Colors'
import { MAP_SECTOR_SIZE } from '../../libraries/CyberspaceMap'
import { ThreeAvatarMarker } from './ThreeAvatarMarker'
import { IdentityContextType } from '../../types/IdentityType'
import { IdentityContext } from '../../providers/IdentityProvider'
import { generateSectorName } from '../../libraries/SectorName'

interface SectorData {
  sectorId: string
  position: Vector3
  color: Color
  genesis?: boolean
}

function getSectorColor(sectorId: string, userCurrentSectorId: string|null, sectorState: SectorState, pubkey: string): Color {
  // console.log('getSectorColor', sectorState[sectorId], sectorState)
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

export const SectorGrid = () => {
  const { identity } = useContext<IdentityContextType>(IdentityContext)
  const { sectorState, userCurrentSectorId } = useSectorStore()
  const { centerSectorId, setCenter } = useMapCenterSectorStore()
  const [follow, setFollow] = useState<"user"|"roam">("user")
  const meshRef = useRef<InstancedMesh>(null)
  const edgesRef = useRef<InstancedMesh>(null)
  const [hovered, setHovered] = useState<number>()
  const { raycaster, camera, pointer } = useThree()

  const pubkey = identity?.pubkey

  useEffect(() => {
    if (follow === "user" && userCurrentSectorId) {
      setCenter(userCurrentSectorId)
    }
    if (follow === "roam" && centerSectorId) {
      setCenter(centerSectorId)
    }
  }, [userCurrentSectorId, centerSectorId, setCenter, follow])

  const sectorData: SectorData[] = useMemo(() => {
    return Object.entries(sectorState).map(([sectorId]) => {
      if (!centerSectorId) return false // no focus sector, can't do diff
      const diff = relativeSectorIndex(centerSectorId, sectorId)
      // console.log('diff', diff.toArray(0), centerSectorId, sectorId)
      const position = diff.multiplyScalar(MAP_SECTOR_SIZE).toVector3()
      const color = getSectorColor(sectorId, userCurrentSectorId, sectorState, pubkey)
      return { sectorId, position, color, genesis: sectorState[sectorId]?.isGenesis }
    }).filter(Boolean) as SectorData[]
  }, [centerSectorId, pubkey, sectorState, userCurrentSectorId])

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
  
  // const handleClick = () => {
  //   if (hovered !== null) {
  //     // @TODO: this is broken
  //     // const newCenterSectorId = new DecimalVector3().fromArray(sectorData[hovered].position.toArray())
  //     setCenter(newCenterSectorId)
  //   }
  // }

  return (
    <>
      {sectorData.map(({ sectorId, position, color, genesis }, i) => (
        <SectorMarker key={sectorId} sectorId={sectorId} selected={sectorId === centerSectorId} position={position} color={color} avatar={sectorId === userCurrentSectorId} genesis={genesis} />
      ))}
    </>
  )
}

export default SectorGrid

function SectorMarker({ sectorId, selected, avatar, position, color, genesis }: { sectorId: string, selected: boolean, avatar: boolean, position: Vector3, color: Color, genesis?: boolean }) {

  const textPosition = new Vector3().fromArray(position.toArray()).add(new Vector3(0.6, 0, 0))
  const genesisTextPosition = new Vector3(-0.6, 0, 0)

  // FIXME: using the colors like this is a bit of a hack
  const visited = color.getHex() === COLORS.LIGHT_PURPLE
  const hyperjump = color.getHex() === COLORS.YELLOW

  const solid = avatar || genesis || visited || hyperjump

  const opacity = solid ? 1 : 0.2
  
  return (
    <group position={position}>
      { <lineSegments renderOrder={selected ? -1 : 0}>
        <edgesGeometry args={[new BoxGeometry(1,1,1)]} />
        <lineBasicMaterial color={color} linewidth={1} transparent={true} opacity={opacity}/>
      </lineSegments> }
      { solid ? <mesh>
        <boxGeometry args={[1,1,1]} />
        <meshLambertMaterial side={FrontSide} color={color} opacity={0.1} transparent/>
      </mesh> : null }
      { avatar ? <ThreeAvatarMarker /> : null }
      { selected ? 
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
      : null }
      { genesis ?
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
      : null}
      { hyperjump ?
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
      : null}
    </group>
  )

}