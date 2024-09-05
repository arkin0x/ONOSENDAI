import { memo, useContext, useEffect, useMemo } from 'react'
import { NDKContext } from '../../providers/NDKProvider'
import { CYBERSPACE_SECTOR, cyberspaceCoordinateFromHexString, relativeSectorIndex } from '../../libraries/Cyberspace'
import { CyberspaceNDKKinds } from '../../types/CyberspaceNDK'
import { CyberspaceKinds } from "../../libraries/Cyberspace"
import NDK, { NDKSubscription } from '@nostr-dev-kit/ndk'
import { Event } from 'nostr-tools'
import Decimal from 'decimal.js'
import { BoxGeometry, EdgesGeometry, LineBasicMaterial, Vector3 } from 'three'
import { Text } from "@react-three/drei"
import { Blocks } from '../Blocks'
import { useSectorStore } from '../../store/SectorStore'
import COLORS from '../../data/Colors'
import { Avatar } from './Avatar'
import Hyperjump from './Hyperjump'
import { IdentityContextType } from '../../types/IdentityType'
import { IdentityContext } from '../../providers/IdentityProvider'

interface SectorManagerProps {
  adjacentLayers?: number
}

function SectorManager({ adjacentLayers = 0 }: SectorManagerProps): JSX.Element|null {
  const { ndk } = useContext(NDKContext)
  const { identity } = useContext<IdentityContextType>(IdentityContext)
  const { 
    userCurrentSectorId, 
    sectorState, 
    mountSector, 
    unmountSector, 
    addAvatar, 
    addConstruct, 
    addHyperjump 
  } = useSectorStore()

  // Functions 

  const subscribeToSectorObjects = (sectorId: string, ndk: NDK): NDKSubscription => {
    const filter = {
      kinds: [CyberspaceKinds.Action, CyberspaceKinds.Construct, CyberspaceKinds.Hyperjump] as CyberspaceNDKKinds[],
      '#S': [sectorId]
    }
    return ndk.subscribe(filter, { closeOnEose: false })
  }

  // Effects

  // determine the user's genesis sector
  useEffect(() => {
    if (!identity.pubkey) return
    const coord = cyberspaceCoordinateFromHexString(identity.pubkey)
    const genesisSector = coord.sector.id
    if (genesisSector) {
      mountSector(genesisSector, true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handleEvent = (event: Event, sectorId: string) => {
      if (event.kind === CyberspaceKinds.Action) {
        addAvatar(sectorId, event.pubkey)
      } else if (event.kind === CyberspaceKinds.Construct) {
        addConstruct(sectorId, event)
      } else if (event.kind === CyberspaceKinds.Hyperjump) {
        addHyperjump(sectorId, event)
      }
    }

    if (!userCurrentSectorId || !ndk) return

    const sectorsToLoad = getSectorsToLoad(userCurrentSectorId, adjacentLayers)
    const subscriptions: NDKSubscription[] = []

    sectorsToLoad.forEach(sectorId => {
      if (!sectorState[sectorId]) {
        mountSector(sectorId)
      }
      const subscription = subscribeToSectorObjects(sectorId, ndk)
      subscription.on('event', (event: Event) => handleEvent(event, sectorId))
      subscriptions.push(subscription)
    })

    return () => {
      subscriptions.forEach(sub => sub.stop())
      Object.keys(sectorState).forEach(sectorId => {
        if (!sectorsToLoad.includes(sectorId)) {
          // unmountSector(sectorId)
        }
      })
    }
  // }, [userCurrentSectorId, adjacentLayers, ndk, mountSector, unmountSector, sectorState])
  }, [userCurrentSectorId, adjacentLayers, ndk, mountSector, unmountSector, sectorState, addAvatar, addConstruct, addHyperjump])

  const sectorsToRender = useMemo(() => {
    if (!userCurrentSectorId) return null
    return getSectorsToLoad(userCurrentSectorId, adjacentLayers).map(groupSectorId => {
      if (!sectorState[groupSectorId]) return null
      const idx = relativeSectorIndex(userCurrentSectorId, groupSectorId).toVector3()
      return (
        <Sector 
          position={idx} 
          current={userCurrentSectorId === groupSectorId} 
          key={groupSectorId} 
          id={groupSectorId} 
          data={sectorState[groupSectorId]} />
      )
    })
  }, [userCurrentSectorId, sectorState])

  console.log('sectorsToRender', sectorsToRender?.length)

  return (
    <>{sectorsToRender}</>
  )
}

interface SectorProps {
  position: Vector3
  current: boolean
  id: string
  data: { avatars: string[]; constructs: Event[], hyperjumps: Event[] }
}

// SECTOR COMPONENT
const Sector = memo(({ 
  position, 
  current, 
  id, 
  data 
}: SectorProps): JSX.Element => {
  const sectorSize = CYBERSPACE_SECTOR.toNumber()

  const adjacentScale = 0.9
  const size = current ? sectorSize : sectorSize * adjacentScale

  const centerPosition = position.clone().multiplyScalar(sectorSize).addScalar(sectorSize / 2)

  const halfSize = sectorSize/2

  const renderAvatars = () => {
    return null
    return data.avatars.map(pubkey => <Avatar key={pubkey} pubkey={pubkey} /> )
  }

  const renderConstructs = () => {
    // TODO:
    // render construct with the highest POW
    // keep in mind the minimum size of a construct is 1 sector
    // how to visualize it when you're in it?
    return null
  }

  const renderHyperjumps = () => {
    return data.hyperjumps.map(event => <Hyperjump key={event.id} event={event} /> )
  }

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
        color={COLORS.ORANGE} >
        SECTOR {id}
      </Text> : null }
      {/* { current ? <Text 
        textAlign='center'
        fontSize={2**28}
        font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}
        anchorX={'center'}
        position={[0, 0, halfSize]} 
        rotation={[0,-Math.PI,0]} 
        frustumCulled={true}
        color={COLORS.ORANGE} >
        //////
      </Text> : null } */}
      {renderAvatars()}
      {renderConstructs()}
      {renderHyperjumps()}
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