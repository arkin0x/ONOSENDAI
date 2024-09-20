import React, { useEffect, useRef } from 'react'
import { useAvatarStore } from '../../store/AvatarStore'
import { useSectorStore } from '../../store/SectorStore'
import useNDKStore from '../../store/NDKStore'
import { Event } from 'nostr-tools'
import { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { CyberspaceKinds } from '../../libraries/Cyberspace'
import { CyberspaceNDKKinds } from '../../types/CyberspaceNDK'

const SCAN_INTERVAL = 10000 // 10 seconds

const getShellSectorIds = (sectorId: string, radius: number): string[] => {
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
    sectorState,
    scannedSectors,
    lastScanRadius,
    updateLastScanRadius
  } = useSectorStore()
  const { fetchEvents, getUser } = useNDKStore()
  const identity = getUser()
  const pubkey = identity?.pubkey

  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const scanSectors = async () => {
    if (!pubkey) return
    const currentSectorId = getSimulatedSectorId(pubkey)
    if (!currentSectorId) return

    const nextRadius = lastScanRadius + 1
    const sectorIds = getShellSectorIds(currentSectorId, nextRadius)
    
    console.log(`Scanning sectors at radius ${nextRadius}:`, sectorIds)

    // Mount sectors that aren't already in the store
    sectorIds.forEach(sectorId => {
      if (!sectorState[sectorId]) {
        mountSector(sectorId)
      }
    })

    // Ensure scannedSectors is always a Set
    const scannedSectorsSet = scannedSectors instanceof Set ? scannedSectors : new Set(scannedSectors)

    const unscannedSectorIds = sectorIds.filter(id => !scannedSectorsSet.has(id))

    if (unscannedSectorIds.length === 0) {
      console.log(`All sectors at radius ${nextRadius} have been scanned. Moving to next radius.`)
      updateLastScanRadius(nextRadius)
      return
    }

    const filter: NDKFilter = {
      kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds, CyberspaceKinds.Shard as CyberspaceNDKKinds, CyberspaceKinds.Construct as CyberspaceNDKKinds, CyberspaceKinds.Hyperjump as CyberspaceNDKKinds],
      '#S': unscannedSectorIds,
    }

    try {
      const events = await fetchEvents(filter)

      events.forEach((event: NDKEvent) => {
        const sectorId = event.tags.find(tag => tag[0] === 'S')?.[1]
        if (sectorId) {
          if (event.kind === CyberspaceKinds.Action) {
            addAvatar(sectorId, event.pubkey)
          } else if (event.kind === CyberspaceKinds.Construct) {
            addConstruct(sectorId, event.rawEvent() as Event)
          } else if (event.kind === CyberspaceKinds.Hyperjump) {
            addHyperjump(sectorId, event.rawEvent() as Event)
          }

          scanSector(sectorId)
        }
      })

      // Mark all sectors in this shell as scanned, even if no events were found
      unscannedSectorIds.forEach(sectorId => scanSector(sectorId))

      updateLastScanRadius(nextRadius)
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