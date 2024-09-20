import React, { useEffect, useRef } from 'react'
import { useAvatarStore } from '../../store/AvatarStore'
import { useSectorStore } from '../../store/SectorStore'
import useNDKStore from '../../store/NDKStore'
import { Event } from 'nostr-tools'
import { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { CyberspaceKinds } from '../../libraries/Cyberspace'
import { CyberspaceNDKKinds } from '../../types/CyberspaceNDK'
import Decimal from 'decimal.js'
import { reference } from 'three/examples/jsm/nodes/Nodes.js'

const SCAN_INTERVAL = 5000 // 10 seconds
const SCAN_RADIUS = 3 // Scan a 11x11x11 cube centered on the user

const getSurroundingSectorIds = (centerSectorId: string): string[] => {
  console.log('Getting surrounding sector ids for', centerSectorId)
  const [cx, cy, cz] = centerSectorId.split('-').map(x => new Decimal(x))
  const sectorIds: string[] = []

  for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx++) {
    for (let dy = -SCAN_RADIUS; dy <= SCAN_RADIUS; dy++) {
      for (let dz = -SCAN_RADIUS; dz <= SCAN_RADIUS; dz++) {
        sectorIds.push(`${cx.add(dx).toString()}-${cy.add(dy).toString()}-${cz.add(dz).toString()}`)
      }
    }
  }

  return sectorIds
}

const SectorScanner: React.FC = () => {
  const getSimulatedSectorId = useAvatarStore((state) => state.getSimulatedSectorId)
  const { 
    mountSector, 
    addConstruct, 
    addHyperjump, 
    addAvatar,
    sectorState,
  } = useSectorStore()
  const { fetchEvents, getUser } = useNDKStore()
  const identity = getUser()
  const pubkey = identity?.pubkey

  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const currentCenterRef = useRef<string | null>(null)

  function pickNextCenter(referencePoint?: string) {
    if (!currentCenterRef.current) return
    if (!referencePoint) referencePoint = currentCenterRef.current

    console.log('Picking next center', referencePoint)

    const components: Decimal[] = referencePoint.split('-').map(x => new Decimal(x))
    const selection = Math.floor(Math.random() * 3)
    const selectedComponent = components[selection]
    const decimalComponent = new Decimal(selectedComponent)
    const direction = Math.floor(Math.random() * 2) === 0 ? -1 : 1
    const newLocation = decimalComponent.add(direction * SCAN_RADIUS * 2)
    components[selection] = newLocation
    const [cx, cy, cz] = components.map(x => x.toString())
    const nextCenter = `${cx}-${cy}-${cz}`

    // check if the new center has already been mounted
    if (!sectorState[nextCenter]) {
      currentCenterRef.current = nextCenter
    } else {
      pickNextCenter(nextCenter)
    }
  }

  async function scanSectors() {
    if (!pubkey) return
    if (!currentCenterRef.current) return

    const sectorIds = getSurroundingSectorIds(currentCenterRef.current)

    console.log('Scan', sectorIds.length, 'sectors')
    
    // Mount all sectors that aren't already in the store
    sectorIds.forEach(sectorId => {
      if (!sectorState[sectorId]) {
        console.log('add sector', sectorId)
        mountSector(sectorId)
      }
    })

    const filter: NDKFilter = {
      kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds, CyberspaceKinds.Shard as CyberspaceNDKKinds, CyberspaceKinds.Construct as CyberspaceNDKKinds, CyberspaceKinds.Hyperjump as CyberspaceNDKKinds],
      '#S': sectorIds,
    }

    try {
      console.log('activating filter', filter)
      const events = await fetchEvents(filter)
      console.log('filter complete')

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

      console.log(`Received ${events.size} events for ${sectorIds.length} sectors`)
    } catch (error) {
      console.error('Error scanning sectors:', error)
    }

    // Update the current center sector
    pickNextCenter()

  }

  useEffect(() => {
    console.log('sector scanner: pubkey', pubkey)
    if (!pubkey) return
    if (!currentCenterRef.current) {
      currentCenterRef.current = getSimulatedSectorId(pubkey!)
    }

    console.log('Starting sector scanner', currentCenterRef.current)

    scanSectors() // Initial scan
    scanIntervalRef.current = setInterval(scanSectors, SCAN_INTERVAL)

    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current)
      }
    }
  }, [pubkey, getSimulatedSectorId])

  return null // This component doesn't render anything
}

export default SectorScanner