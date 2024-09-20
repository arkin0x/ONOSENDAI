import React, { useEffect, useRef } from 'react'
import { useAvatarStore } from '../../store/AvatarStore'
import { useSectorStore } from '../../store/SectorStore'
import useNDKStore from '../../store/NDKStore'
import { Event } from 'nostr-tools'
import { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { cyberspaceCoordinateFromHexString, CyberspaceKinds } from '../../libraries/Cyberspace'
import { CyberspaceNDKKinds } from '../../types/CyberspaceNDK'

const SCAN_INTERVAL = 10000 // 10 seconds

const SectorScanner: React.FC = () => {
  const getSimulatedSectorId = useAvatarStore((state) => state.getSimulatedSectorId)
  const { 
    mountSector, 
    addConstruct, 
    addHyperjump, 
    addAvatar,
    getNextScanSet,
    updateScanArea,
    currentScanArea
  } = useSectorStore()
  const { fetchEvents, getUser } = useNDKStore()
  const identity = getUser()
  const pubkey = identity?.pubkey

  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const scanSectors = async () => {
    if (!pubkey) return
    const currentSectorId = getSimulatedSectorId(pubkey)
    if (!currentSectorId) return

    const sectorIds = getNextScanSet()
    
    if (sectorIds.length === 0) return

    const filter: NDKFilter = {
      kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds, CyberspaceKinds.Shard as CyberspaceNDKKinds, CyberspaceKinds.Construct as CyberspaceNDKKinds, CyberspaceKinds.Hyperjump as CyberspaceNDKKinds],
      '#S': sectorIds,
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
        }
      })

      updateScanArea(sectorIds)

      console.log(`Scanned ${events.size} events for ${sectorIds.length} sectors`)
      console.log('Current scan area:', currentScanArea)
    } catch (error) {
      console.error('Error scanning sectors:', error)
    }
  }

  // bootstrap the user's genesis sector
  useEffect(() => {
    const coord = cyberspaceCoordinateFromHexString(identity!.pubkey)
    const genesisSector = coord.sector.id
    if (genesisSector) {
      mountSector(genesisSector, true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    scanSectors() // Initial scan
    scanIntervalRef.current = setInterval(scanSectors, SCAN_INTERVAL)

    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current)
      }
    }
  }, [pubkey])

  return null // This component doesn't render anything
}

export default SectorScanner