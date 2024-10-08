import { memo, useMemo } from 'react'
import { CYBERSPACE_SECTOR, relativeSectorIndex } from '../../libraries/Cyberspace'
import Decimal from 'decimal.js'
import { BoxGeometry, EdgesGeometry, LineBasicMaterial, Vector3 } from 'three'
import { Text } from "@react-three/drei"
import { useSectorStore } from '../../store/SectorStore'
import COLORS from '../../data/Colors'
import { Avatar } from './Avatar'
import Hyperjump from './Hyperjump'
import { generateSectorName } from '../../libraries/SectorName'
import ShardRenderer from '../ShardRenderer'

interface SectorManagerProps {
  pubkey: string
  adjacentLayers?: number
}

function SectorManager({ adjacentLayers = 0, pubkey }: SectorManagerProps): JSX.Element|null {
  const { 
    userCurrentSectorId, 
    sectorState, 
  } = useSectorStore()

  // Effects

  const sectorsToLoad: string[] = useMemo(() => {
    if (!userCurrentSectorId) return []
    return getSectorsToLoad(userCurrentSectorId, adjacentLayers)
  }, [userCurrentSectorId, adjacentLayers])

  const sectorsToRender = useMemo(() => {
    if (!userCurrentSectorId) return null
    if (sectorsToLoad.length === 0) return null
    return sectorsToLoad.map(groupSectorId => {
      const idx = relativeSectorIndex(userCurrentSectorId, groupSectorId).toVector3()
      return (
        <Sector 
          position={idx} 
          current={userCurrentSectorId === groupSectorId} 
          key={groupSectorId} 
          id={groupSectorId} 
        />
      )
    })
  }, [sectorsToLoad, userCurrentSectorId])

  // Functions

  function renderShards() {
    return sectorsToLoad.map( (sectorId) => {
      if (!sectorState[sectorId]) return null
      if (!sectorState[sectorId].shards) return null
      return sectorState[sectorId].shards.map((event, index) => 
        <ShardRenderer key={`${event.id}-${index}`} event={event} />
      )
    })
  }

  const renderAvatars = () => {
    return sectorsToLoad.map( (sectorId) => {
      if (!sectorState[sectorId]) return null
      if (!sectorState[sectorId].avatars) return null
      return sectorState[sectorId].avatars.map((avatarPubkey, index) => { 
        if (avatarPubkey === pubkey) return null
        return <Avatar key={`${avatarPubkey}-${index}`} pubkey={avatarPubkey} showHistory={false} /> 
      }).filter(Boolean)
    })
  }

  const renderConstructs = () => {
    // TODO:
    // render construct with the highest POW
    // keep in mind the minimum size of a construct is 1 sector
    // how to visualize it when you're in it?
    return null
  }

  const renderHyperjumps = () => {
    return sectorsToLoad.map( (sectorId) => {
      if (!sectorState[sectorId]) return null
      if (!sectorState[sectorId].hyperjumps) return null
      return sectorState[sectorId].hyperjumps.map((event, index) => 
        <Hyperjump key={`${event.id}-${index}`} event={event} />
      )
    })
  }

  return (
    <>
      {sectorsToRender}
      {renderAvatars()}
      {renderConstructs()}
      {renderHyperjumps()}
      {renderShards()}
    </>
  )
}

interface SectorProps {
  position: Vector3
  current: boolean
  id: string
  // data: { avatars: string[]; constructs: Event[], hyperjumps: Event[] }
}

// SECTOR COMPONENT
const Sector = memo(({ 
  position, 
  current, 
  id, 
}: SectorProps): JSX.Element => {
  const sectorSize = CYBERSPACE_SECTOR.toNumber()

  const adjacentScale = 0.9
  const size = current ? sectorSize : sectorSize * adjacentScale

  const centerPosition = position.clone().multiplyScalar(sectorSize).addScalar(sectorSize / 2)

  const halfSize = sectorSize/2

  return (
    <group position={centerPosition}>
      <lineSegments
        geometry={new EdgesGeometry(new BoxGeometry(size, size, size))}
        material={new LineBasicMaterial({ color: current ? COLORS.ORANGE : COLORS.DARK_PURPLE, linewidth: 1, fog: current ? false : true })}
      />
      { current ? <Text 
        textAlign='center'
        fontSize={2**24 + 2**23}
        font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}
        anchorX={'center'}
        position={[0, 0, halfSize]} 
        // position={[0, -halfSize - 2**25, halfSize]} 
        rotation={[0,-Math.PI,0]} 
        frustumCulled={true}
        color={COLORS.DARK_PURPLE} >
        SECTOR {generateSectorName(id).toUpperCase()}
      </Text> : null }
    </group>
  )
})

// Functions

function getSectorsToLoad(currentSector: string, adjacentLayers: number): string[] {
  const MAX_SECTOR_ID = new Decimal('36028797018963968')
  const MIN_SECTOR_ID = new Decimal('0')

  // Validate inputs
  if (!currentSector || typeof currentSector !== 'string' || !currentSector.match(/^\d+-\d+-\d+$/)) {
    throw new Error('Invalid sector ID')
  }
  if (adjacentLayers < 0) {
    throw new Error('adjacentLayers must be non-negative')
  }

  const sectors = [currentSector]
  if (adjacentLayers > 0) {
    const radius = Math.abs(adjacentLayers) // radius for adjacent layers

    // Split the current sector ID into its x, y, z components and convert to Decimal
    const [x0, y0, z0] = currentSector.split('-').map(coord => new Decimal(coord))

    // Check if the current sector is within bounds
    if (x0.gt(MAX_SECTOR_ID) || x0.lt(MIN_SECTOR_ID) || y0.gt(MAX_SECTOR_ID) || y0.lt(MIN_SECTOR_ID) || z0.gt(MAX_SECTOR_ID) || z0.lt(MIN_SECTOR_ID)) {
      throw new Error('Sector ID out of bounds')
    }

    // Iterate through the cubic radius around the current sector
    for (let x = -radius; x <= radius; x++) {
      for (let y = -radius; y <= radius; y++) {
        for (let z = -radius; z <= radius; z++) {
          // Skip the current sector itself
          if (x === 0 && y === 0 && z === 0) continue

          // Calculate the adjacent sector ID using Decimal arithmetic
          const adjacentX = x0.plus(x)
          const adjacentY = y0.plus(y)
          const adjacentZ = z0.plus(z)

          // Check if the adjacent sector is within bounds
          if (adjacentX.lte(MAX_SECTOR_ID) && adjacentX.gte(MIN_SECTOR_ID) &&
              adjacentY.lte(MAX_SECTOR_ID) && adjacentY.gte(MIN_SECTOR_ID) &&
              adjacentZ.lte(MAX_SECTOR_ID) && adjacentZ.gte(MIN_SECTOR_ID)) {
            const adjacentSector = `${adjacentX.toString()}-${adjacentY.toString()}-${adjacentZ.toString()}`
            sectors.push(adjacentSector)
          }
        }
      }
    }
  }

  return sectors
}

export default SectorManager