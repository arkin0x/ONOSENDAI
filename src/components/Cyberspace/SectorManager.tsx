import React, { useContext, useEffect, useReducer, useState } from 'react'
import { IdentityContext } from '../../providers/IdentityProvider'
import { AvatarContext } from '../../providers/AvatarContext'
import { NDKContext } from '../../providers/NDKProvider'
import { CYBERSPACE_SECTOR, extractActionState, relativeSectorPosition } from '../../libraries/Cyberspace'
import { CyberspaceKinds, CyberspaceNDKKinds } from '../../types/CyberspaceNDK'
import NDK, { NDKSubscription } from '@nostr-dev-kit/ndk'
import { Event } from 'nostr-tools'
import Decimal from 'decimal.js'
import { BackSide, BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Vector3 } from 'three'
import { Blocks } from '../Blocks'

// Types
type SectorState = Record<string, { avatars: Set<string>, constructs: Set<string> }>
type SectorAction = 
  | { type: 'MOUNT_SECTOR'; sectorId: string }
  | { type: 'UNMOUNT_SECTOR'; sectorId: string }
  | { type: 'ADD_AVATAR'; sectorId: string; pubkey: string }
  | { type: 'REMOVE_AVATAR'; sectorId: string; pubkey: string }
  | { type: 'ADD_CONSTRUCT'; sectorId: string; eventId: string }

// Reducer
const sectorReducer = (state: SectorState, action: SectorAction): SectorState => {
  switch (action.type) {
    case 'MOUNT_SECTOR':
      return { 
        ...state, 
        [action.sectorId]: { avatars: new Set(), constructs: new Set() } 
      }
    case 'UNMOUNT_SECTOR': {
      const newState = { ...state }
      delete newState[action.sectorId]
      return newState
    }
    case 'ADD_AVATAR': {
      const sectorData = state[action.sectorId]
      return {
        ...state,
        [action.sectorId]: {
          ...sectorData,
          avatars: new Set(sectorData.avatars).add(action.pubkey)
        }
      }
    }
    case 'REMOVE_AVATAR': {
      const sectorData = state[action.sectorId]
      const newAvatars = new Set(sectorData.avatars)
      newAvatars.delete(action.pubkey)
      return {
        ...state,
        [action.sectorId]: { ...sectorData, avatars: newAvatars }
      }
    }
    case 'ADD_CONSTRUCT': {
      const sectorData = state[action.sectorId]
      return {
        ...state,
        [action.sectorId]: {
          ...sectorData,
          constructs: new Set(sectorData.constructs).add(action.eventId)
        }
      }
    }
    default:
      return state
  }
}

interface SectorManagerProps {
  adjacentLayers?: number
}

// Components

export const SectorManager: React.FC<SectorManagerProps> = ({ adjacentLayers = 0 }) => {
  const { ndk } = useContext(NDKContext)
  const { identity } = useContext(IdentityContext)
  const [sectorState, dispatchSector] = useReducer(sectorReducer, {}) // keep track of sectors, avatars, and constructs
  const { actionState } = useContext(AvatarContext)
  const [currentSector, setCurrentSector] = useState<string | null>(null)

  const pubkey = identity?.pubkey


  // Debug

  // Functions 

  const subscribeToSector = (sectorId: string, ndk: NDK): NDKSubscription => {
    const filter = {
      kinds: [CyberspaceKinds.Action, CyberspaceKinds.Construct] as CyberspaceNDKKinds[],
      '#S': [sectorId]
    }
    return ndk.subscribe(filter, { closeOnEose: false })
  }

  const handleEvent = (event: Event, sectorId: string) => {
    if (event.kind === CyberspaceKinds.Action) {
      dispatchSector({ type: 'ADD_AVATAR', sectorId, pubkey: event.pubkey })
    } else if (event.kind === CyberspaceKinds.Construct) {
      dispatchSector({ type: 'ADD_CONSTRUCT', sectorId, eventId: event.id })
    }
  }

  // Effects

  // update currentSector if it changes
  useEffect(() => {
    if (actionState[pubkey] && actionState[pubkey].length > 0) {
      const lastAction = actionState[pubkey][actionState[pubkey].length - 1]
      const { sectorId } = extractActionState(lastAction)
      if (sectorId !== currentSector) setCurrentSector(sectorId)
    }
  }, [actionState, currentSector, identity])

  // handle subscriptions to sectors when current sector changes
  useEffect(() => {
    if (!currentSector || !ndk) return

    const sectorsToLoad = getSectorsToLoad(currentSector, adjacentLayers)
    const subscriptions: NDKSubscription[] = []

    sectorsToLoad.forEach(sectorId => {
      dispatchSector({ type: 'MOUNT_SECTOR', sectorId })
      const subscription = subscribeToSector(sectorId, ndk)
      subscription.on('event', (event: Event) => handleEvent(event, sectorId))
      subscriptions.push(subscription)
    })

    return () => {
      subscriptions.forEach(sub => sub.stop())
      sectorsToLoad.forEach(sectorId => {
        dispatchSector({ type: 'UNMOUNT_SECTOR', sectorId })
      })
    }
  }, [currentSector, adjacentLayers, ndk])

  // Return

  // console.log('sectorState', sectorState)
  if (!currentSector) return null

  return (
    <>
      {Object.keys(sectorState).map(sectorId => (
        <Sector position={relativeSectorPosition(currentSector, sectorId).toVector3()} current={currentSector === sectorId} key={sectorId} id={sectorId} data={sectorState[sectorId]} />
      ))}
    </>
  )
}

const Sector: React.FC<{ position: Vector3, current: boolean, id: string; data: { avatars: Set<string>; constructs: Set<string> } }> = ({ position, current, id, data }) => {
  const sectorSize = CYBERSPACE_SECTOR.toNumber()//(2**10)

  const adjacentScale = 0.9
  const size = current ? sectorSize : sectorSize * adjacentScale

  const centerPosition = position.clone().add(new Vector3(sectorSize / 2, sectorSize / 2, sectorSize / 2))

  return (
    <group position={centerPosition}>
      {/* <mesh position={[sectorSize / 2, sectorSize / 2, sectorSize / 2]}>
        <boxGeometry args={[sectorSize, sectorSize, sectorSize]} />
        <meshBasicMaterial color={current ? 0x062cd : 0x78004e} transparent opacity={0.5} side={BackSide} wireframe/>
      </mesh> */}
      <lineSegments
        geometry={new EdgesGeometry(new BoxGeometry(size, size, size))}
        material={new LineBasicMaterial({ color: current ? 0xff9123 : 0x78004e, linewidth: 1 })}
      />
      {/* Render avatars and constructs here */}
      <Blocks sectorId={id} />
    </group>
  )
}

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