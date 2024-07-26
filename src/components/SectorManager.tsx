import React, { useContext, useEffect, useMemo, useReducer, useState } from 'react'
import { IdentityContext } from '../providers/IdentityProvider'
import { AvatarContext } from '../providers/AvatarContext'
import { NDKContext } from '../providers/NDKProvider'
import { DecimalVector3 } from '../libraries/DecimalVector3'
import { CYBERSPACE_SECTOR, extractActionState, getSectorFromCoordinate, getSectorId } from '../libraries/Cyberspace'
import { CyberspaceKinds, CyberspaceNDKKinds } from '../types/CyberspaceNDK'
import NDK, { NDKSubscription } from '@nostr-dev-kit/ndk'
import { Event } from 'nostr-tools'
import { Vector3 } from 'three'

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

export const SectorManager: React.FC<SectorManagerProps> = ({ adjacentLayers = 0 }) => {
  const { ndk } = useContext(NDKContext)
  const { identity } = useContext(IdentityContext)
  const [sectorState, dispatchSector] = useReducer(sectorReducer, {}) // keep track of sectors, avatars, and constructs
  const [currentSector, setCurrentSector] = useState<string | null>(null)
  const { actionState } = useContext(AvatarContext)

  // Debug

  // Effects

  // update currentSector
  useEffect(() => {
    const pubkey = identity?.pubkey
    const lastAction = [...actionState[pubkey]].reverse()[0]
  console.log('try extract action state')
    const { sectorId } = extractActionState(lastAction)
  console.log('done extract action state')
    // only update currentSector if it changes
    if (sectorId !== currentSector) setCurrentSector(sectorId)
  }, [actionState, currentSector, identity])

  // handle subscriptions to sectors
  useEffect(() => {
    if (!currentSector || !ndk) return

    const subscribeToSector = (sectorCoord: DecimalVector3): NDKSubscription => {
      const filter = {
        kinds: [CyberspaceKinds.Action, CyberspaceKinds.Construct] as CyberspaceNDKKinds[],
        '#S': [getSectorId(sectorCoord)]
      }
      return ndk.subscribe(filter, { closeOnEose: false })
    }

    const sectorsToLoad = getSectorsToLoad(currentSector, adjacentLayers)
    const subscriptions: NDKSubscription[] = []

    sectorsToLoad.forEach(sectorId => {
      dispatchSector({ type: 'MOUNT_SECTOR', sectorId })
      const sectorCoord = getSectorFromCoordinate(sectorId)
      const subscription = subscribeToSector(sectorCoord)
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

  // Functions 

  const handleEvent = (event: Event, sectorId: string) => {
    if (event.kind === CyberspaceKinds.Action) {
      dispatchSector({ type: 'ADD_AVATAR', sectorId, pubkey: event.pubkey })
    } else if (event.kind === CyberspaceKinds.Construct) {
      dispatchSector({ type: 'ADD_CONSTRUCT', sectorId, eventId: event.id })
    }
  }

  // Return

  return (
    <>
      {Object.keys(sectorState).map(sectorId => (
        <Sector key={sectorId} id={sectorId} data={sectorState[sectorId]} />
      ))}
    </>
  )
}

const Sector: React.FC<{ id: string; data: { avatars: Set<string>; constructs: Set<string> } }> = ({ id, data }) => {
  const sectorSize = CYBERSPACE_SECTOR.toNumber()
  const position = getSectorFromCoordinate(id).toVector3().multiplyScalar(sectorSize)

  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[sectorSize, sectorSize, sectorSize]} />
        <meshBasicMaterial color={0x00ff00} transparent opacity={0.1} wireframe={true} />
      </mesh>
      {/* Render avatars and constructs here */}
    </group>
  )
}

function getSectorsToLoad(currentSector: string, adjacentLayers: number): string[] {
  const sectors = [currentSector]
  if (adjacentLayers > 0) {
    // Add logic to get adjacent sector IDs
    // This is a placeholder and needs to be implemented based on your sector structure
  }
  return sectors
}