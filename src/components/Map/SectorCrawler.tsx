import React, { useEffect, useRef, useContext, useCallback } from 'react'
import { useSectorStore } from "../../store/SectorStore"
import { useMapCenterSectorStore } from "../../store/MapCenterSectorStore"
import { NDKContext } from '../../providers/NDKProvider'
import { CyberspaceKinds } from "../../libraries/Cyberspace"
import { Event } from 'nostr-tools'
import { NDKFilter } from '@nostr-dev-kit/ndk'
import { CyberspaceNDKKinds } from '../../types/CyberspaceNDK'

// Worker setup
const workerCode = `
  self.onmessage = function(e) {
    const { action, data } = e.data
    if (action === 'calculateNextSectors') {
      // Implement spiral pattern calculation here
      const nextSectors = calculateSpiralSectors(data.centerSector, data.currentRadius)
      self.postMessage({ action: 'nextSectors', data: nextSectors })
    }
  }

  function calculateSpiralSectors(centerSector, radius) {
    const [centerX, centerY, centerZ] = centerSector.split('-').map(Number);
    const sectors = [];
    
    const directions = [
      [1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1]
    ];
    
    let x = 0, y = 0, z = 0;
    let dx = 1, dy = 0, dz = 0;
    let segment_length = 1;
    let segment_passed = 0;
    let direction_changes = 0;
    
    for (let i = 0; i < radius * radius * 6; i++) {
      const sectorX = centerX + x;
      const sectorY = centerY + y;
      const sectorZ = centerZ + z;
      sectors.push(sectorX + '-' + sectorY + '-' + sectorZ);
      
      x += dx;
      y += dy;
      z += dz;
      segment_passed++;
      
      if (segment_passed == segment_length) {
        segment_passed = 0;
        direction_changes++;
        
        if (direction_changes % 2 == 0) {
          segment_length++;
        }
        
        const dirIndex = Math.floor(direction_changes / 2) % 6;
        [dx, dy, dz] = directions[dirIndex];
      }
      
      if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) >= radius) {
        break;
      }
    }
    
    return sectors;
  }

`

const workerBlob = new Blob([workerCode], { type: 'application/javascript' })
const workerUrl = URL.createObjectURL(workerBlob)

const SectorCrawler: React.FC = () => {
  const { sectorState, mountSector, addAvatar, addConstruct, addHyperjump } = useSectorStore()
  const { centerSectorId } = useMapCenterSectorStore()
  const { ndk } = useNDKStore()
  
  const workerRef = useRef<Worker | null>(null)
  const queueRef = useRef<string[]>([])
  const currentRadiusRef = useRef(1)
  const processingRef = useRef(false)

  useEffect(() => {
    workerRef.current = new Worker(workerUrl)
    workerRef.current.onmessage = handleWorkerMessage

    return () => {
      workerRef.current?.terminate()
      URL.revokeObjectURL(workerUrl)
    }
  }, [])

  const requestNextSectors = useCallback(() => {
    workerRef.current?.postMessage({
      action: 'calculateNextSectors',
      data: { centerSector: centerSectorId, currentRadius: currentRadiusRef.current }
    })
    currentRadiusRef.current++
  }, [centerSectorId])

  useEffect(() => {
    if (centerSectorId) {
      // Reset and start scanning from new center
      queueRef.current = []
      currentRadiusRef.current = 1
      requestNextSectors()
    }
  }, [centerSectorId, requestNextSectors])

  const handleWorkerMessage = (e: MessageEvent) => {
    const { action, data } = e.data
    if (action === 'nextSectors') {
      queueRef.current.push(...data)
      processQueue()
    }
  }

  const processQueue = async () => {
    if (processingRef.current || queueRef.current.length === 0) return
    
    processingRef.current = true
    const sectorToProcess = queueRef.current.shift()

    if (sectorToProcess && !sectorState[sectorToProcess]) {
      await scanSector(sectorToProcess)
    }

    processingRef.current = false
    processQueue()

    if (queueRef.current.length < 10) {
      requestNextSectors()
    }
  }

  const scanSector = async (sectorId: string) => {
    if (!ndk) return

    mountSector(sectorId)

    const filter = {
      kinds: [CyberspaceKinds.Action, CyberspaceKinds.Construct, CyberspaceKinds.Hyperjump] as CyberspaceNDKKinds[],
      '#S': [sectorId]
    } as NDKFilter

    const subscription = ndk.subscribe([filter], { closeOnEose: false })

    subscription.on('event', (event: Event) => {
      switch (event.kind) {
        case CyberspaceKinds.Action:
          addAvatar(sectorId, event.pubkey)
          break
        case CyberspaceKinds.Construct:
          addConstruct(sectorId, event)
          break
        case CyberspaceKinds.Hyperjump:
          addHyperjump(sectorId, event)
          break
      }
    })

    // Wait for initial data load
    await new Promise<void>(resolve => {
      subscription.on('eose', () => {
        console.log('eose', sectorId)
        subscription.stop()
        resolve()
      })
    })

  }

  return null
}

export default SectorCrawler