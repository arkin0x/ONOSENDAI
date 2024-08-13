// SectorMarkers.tsx

import React, { useEffect, useMemo } from 'react'
import { Text } from "@react-three/drei"
import { useAvatarStore } from "../../store/AvatarStore"
import { Vector3, BoxGeometry } from 'three'
import { CYBERSPACE_AXIS, CYBERSPACE_SECTOR, getSectorDecimalFromId } from '../../libraries/Cyberspace'
import COLORS from '../../data/Colors'
import { getTag } from '../../libraries/Nostr'
import { useSectorStore } from '../../store/SectorStore'
import { useMapCenterSectorStore } from '../../store/MapCenterSectorStore'

interface SectorMarkersProps {
  pubkey: string
  scale: number
}

const SECTOR_SIZE = 2**15

export const SectorMarkers: React.FC<SectorMarkersProps> = ({ pubkey, scale }) => {
  const SCALE = scale / SECTOR_SIZE
  const { centerSectorId, setCenter } = useMapCenterSectorStore()
  const { userCurrentSectorId } = useSectorStore()

  // default center to user's current sector
  useEffect(() => {
    setCenter(userCurrentSectorId)
  },[])

  // render sector markers
  // we want to render a marker for each sector the user has visited in their action chain
  // we want to render sectors that have been scanned


  const { actionState } = useAvatarStore()

  const actions = actionState[pubkey]

  const sectorMarkers = useMemo(() => {
    if (!actions || !actions.length) return []

    const visitedSectors = new Set<string>()
    const markers: JSX.Element[] = []

    actions.forEach((action, index) => {
      const sectorId = action.tags.find(getTag('S'))?.[1]
      if (sectorId && !visitedSectors.has(sectorId)) {
        visitedSectors.add(sectorId)
        const position = getSectorPosition(sectorId, scale)
        const isGenesis = index === 0
        const isCurrent = sectorId === userCurrentSectorId

        markers.push(
          <SectorMarker
            key={sectorId}
            id={sectorId}
            position={position}
            isGenesis={isGenesis}
            isCurrent={isCurrent}
          />
        )
      }
    })

    return markers
  }, [actions, scale, userCurrentSectorId])

  return <>{sectorMarkers}</>
}

interface SectorMarkerProps {
  id: string
  position: Vector3
  isGenesis: boolean
  isCurrent: boolean
}

const SectorMarker: React.FC<SectorMarkerProps> = ({ id, position, isGenesis, isCurrent }) => {

  const size = 1//.001
  const lineColor = COLORS.ORANGE//isGenesis ? COLORS.YELLOW : isCurrent ? COLORS.ORANGE : COLORS.BLUE

  const textPosition = new Vector3().fromArray(position.toArray()).add(new Vector3(-1, 0, 0))

  return (
    <>
      <lineSegments position={position}>
        <edgesGeometry args={[new BoxGeometry(size, size, size)]} />
        <lineBasicMaterial color={lineColor} linewidth={0.01} />
      </lineSegments>
      <Text 
        textAlign='left'
        fontSize={0.5}
        font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}
        anchorX={'left'}
        position={textPosition} 
        rotation={[0,Math.PI,0]} 
        frustumCulled={true}
        color={lineColor} >
        SECTOR {id}
      </Text>
    </>
  )
}

function getSectorPosition(sectorId: string, scale: number): Vector3 {
  const DOWNSCALE = CYBERSPACE_AXIS.div(scale)
  const sectorDecimal = getSectorDecimalFromId(sectorId).multiplyScalar(CYBERSPACE_SECTOR).divideScalar(DOWNSCALE)
  const v3 = sectorDecimal.toVector3()
  console.log('Sector position:', sectorId, sectorDecimal.toArray(32) )
  return v3
}

export default SectorMarkers