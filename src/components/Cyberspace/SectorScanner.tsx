import React, { useEffect, useRef } from 'react'
import { useAvatarStore } from '../../store/AvatarStore'
import { useSectorStore } from '../../store/SectorStore'
import useNDKStore from '../../store/NDKStore'
import { Event } from 'nostr-tools'
import { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { CyberspaceKinds } from '../../libraries/Cyberspace'
import { CyberspaceNDKKinds } from '../../types/CyberspaceNDK'

const SCAN_INTERVAL = 10000 // 5 seconds

const getAdjacentSectorIds = (sectorId: string, radius: number): string[] => {
  const [x, y, z] = sectorId.split('-').map(Number)
  const sectorIds: string[] = []
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        sectorIds.push(`${x + dx}-${y + dy}-${z + dz}`)
      }
    }
  }
  return sectorIds
}

const SectorScanner: React.FC = () => {
  const getSimulatedSectorId = useAvatarStore((state) => state.getSimulatedSectorId)
  const { 
    mountSector, 
    scanSector, 
    addConstruct, 
    addHyperjump, 
    addAvatar,
    sectorState
  } = useSectorStore()
  const { fetchEvents, getUser } = useNDKStore()
  const identity = getUser()
  const pubkey = identity?.pubkey

  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const scanSectors = async () => {
    if (!pubkey) return
    const currentSectorId = getSimulatedSectorId(pubkey) // Assuming 'self' is the current user's pubkey
    if (!currentSectorId) return

    const radius = 2 // This gives us a 5x5x5 cube (125 sectors)
    const sectorIds = getAdjacentSectorIds(currentSectorId, radius)

    console.log('Scanning sectors:', sectorIds)

    // Mount sectors that aren't already in the store
    sectorIds.forEach(sectorId => {
      if (!sectorState[sectorId]) {
        mountSector(sectorId)
      }
    })

    const filter: NDKFilter = {
      kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds, CyberspaceKinds.Shard as CyberspaceNDKKinds, CyberspaceKinds.Construct as CyberspaceNDKKinds, CyberspaceKinds.Hyperjump as CyberspaceNDKKinds], // Avatar action, Construct, Hyperjump
      '#S': sectorIds,
    }

    try {
      const events = await fetchEvents(filter)

      events.forEach((event: NDKEvent) => {
        const sectorId = event.tags.find(tag => tag[0] === 'S')?.[1]
        if (sectorId) {
          // Determine the event type and add it to the appropriate store
          if (event.kind === CyberspaceKinds.Action) {
            addAvatar(sectorId, event.pubkey)
          } else if (event.kind === CyberspaceKinds.Construct) {
            addConstruct(sectorId, event.rawEvent() as Event)
          } else if (event.kind === CyberspaceKinds.Hyperjump) {
            addHyperjump(sectorId, event.rawEvent() as Event)
          }

          // Mark the sector as scanned
          scanSector(sectorId)
        }
      })
    } catch (error) {
      console.error('Error scanning sectors:', error)
    }
  }

  useEffect(() => {
    scanIntervalRef.current = setInterval(scanSectors, SCAN_INTERVAL)

    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current)
      }
    }
  }, [])

  return null // This component doesn't render anything
}

export default SectorScanner