import React, { useContext, useEffect, useReducer, useState } from 'react'
import { IdentityContext } from '../../providers/IdentityProvider'
import { NDKContext } from '../../providers/NDKProvider'
import { useAvatarStore } from '../../store/AvatarStore'
import { CYBERSPACE_SECTOR, relativeSectorPosition } from '../../libraries/Cyberspace'
import { CyberspaceKinds, CyberspaceNDKKinds } from '../../types/CyberspaceNDK'
import NDK, { NDKSubscription } from '@nostr-dev-kit/ndk'
import { Event } from 'nostr-tools'
import Decimal from 'decimal.js'
import { BoxGeometry, EdgesGeometry, LineBasicMaterial, Vector3 } from 'three'
import { Blocks } from '../Blocks'
import { useSectorStore } from '../../store/SectorStore'
import COLORS from '../../data/Colors'
import { SpawnModel } from './Spawn'

// Types
type SectorState = Record<string, { avatars: Set<string>, constructs: Set<string>, hyperjumps: Set<string> }>
type SectorAction = 
  | { type: 'MOUNT_SECTOR'; sectorId: string }
  | { type: 'UNMOUNT_SECTOR'; sectorId: string }
  | { type: 'ADD_AVATAR'; sectorId: string; pubkey: string }
  | { type: 'REMOVE_AVATAR'; sectorId: string; pubkey: string }
  | { type: 'ADD_CONSTRUCT'; sectorId: string; eventId: string }
  | { type: 'ADD_HYPERJUMP'; sectorId: string; eventId: string }

// Reducer
const sectorReducer = (state: SectorState, action: SectorAction): SectorState => {
  switch (action.type) {
    case 'MOUNT_SECTOR':
      return { 
        ...state, 
        [action.sectorId]: { avatars: new Set(), constructs: new Set(), hyperjumps: new Set() } 
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
    case 'ADD_HYPERJUMP': {
      const sectorData = state[action.sectorId]
      return {
        ...state,
        [action.sectorId]: {
          ...sectorData,
          hyperjumps: new Set(sectorData.hyperjumps).add(action.eventId)
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
  const [sectorState, dispatchSector] = useReducer(sectorReducer, {}) // keep track of sectors, avatars, and constructs
  const { currentSectorId } = useSectorStore()

  // Debug

  // Functions 

  const subscribeToSectorObjects = (sectorId: string, ndk: NDK): NDKSubscription => {
    const filter = {
      kinds: [CyberspaceKinds.Action, CyberspaceKinds.Construct, CyberspaceKinds.Hyperjump] as CyberspaceNDKKinds[],
      '#S': [sectorId]
    }
    return ndk.subscribe(filter, { closeOnEose: false })
  }

  const handleEvent = (event: Event, sectorId: string) => {
    if (event.kind === CyberspaceKinds.Action) {
      dispatchSector({ type: 'ADD_AVATAR', sectorId, pubkey: event.pubkey })
    } else if (event.kind === CyberspaceKinds.Construct) {
      dispatchSector({ type: 'ADD_CONSTRUCT', sectorId, eventId: event.id })
    } else if (event.kind === CyberspaceKinds.Hyperjump) {
      dispatchSector({ type: 'ADD_HYPERJUMP', sectorId, eventId: event.id })
    }
  }

  // Effects

  // handle subscriptions to sectors when current sector changes
  useEffect(() => {
    if (!currentSectorId || !ndk) return

    const sectorsToLoad = getSectorsToLoad(currentSectorId, adjacentLayers)
    const subscriptions: NDKSubscription[] = []

    sectorsToLoad.forEach(sectorId => {
      dispatchSector({ type: 'MOUNT_SECTOR', sectorId })
      const subscription = subscribeToSectorObjects(sectorId, ndk)
      subscription.on('event', (event: Event) => handleEvent(event, sectorId))
      subscriptions.push(subscription)
    })

    return () => {
      subscriptions.forEach(sub => sub.stop())
      sectorsToLoad.forEach(sectorId => {
        dispatchSector({ type: 'UNMOUNT_SECTOR', sectorId })
      })
    }
  }, [currentSectorId, adjacentLayers, ndk])

  // Return

  if (!currentSectorId) return null

  return (
    <>
      {Object.keys(sectorState).map( groupSectorId => (
        <Sector 
          position={relativeSectorPosition(currentSectorId, groupSectorId).toVector3()} 
          current={currentSectorId === groupSectorId} 
          key={groupSectorId} 
          id={groupSectorId} 
          data={sectorState[groupSectorId]} />
      ))}
    </>
  )
}

const Sector: React.FC<{ position: Vector3, current: boolean, id: string; data: { avatars: Set<string>; constructs: Set<string>, hyperjumps: Set<string> } }> = ({ position, current, id, data }) => {
  const sectorSize = CYBERSPACE_SECTOR.toNumber()//(2**10)

  const adjacentScale = 0.9
  const size = current ? sectorSize : sectorSize * adjacentScale

  const centerPosition = position.clone().add(new Vector3(sectorSize / 2, sectorSize / 2, sectorSize / 2))

  return (
    <group position={centerPosition}>
      <lineSegments
        geometry={new EdgesGeometry(new BoxGeometry(size, size, size))}
        material={new LineBasicMaterial({ color: current ? COLORS.ORANGE : COLORS.DARK_PURPLE, linewidth: 1 })}
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