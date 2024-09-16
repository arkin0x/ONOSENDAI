import React, { useEffect, useState, useContext } from 'react'
import { NDKContext } from '../providers/NDKProvider'
import { Vector3 } from 'three'
import { getSectorCoordinatesFromCyberspaceCoordinate } from '../libraries/Cyberspace'
import { DecimalVector3 } from '../libraries/DecimalVector3'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import COLORS from '../data/Colors'

interface BlocksProps {
  sectorId: string
}

export const Blocks: React.FC<BlocksProps> = ({ sectorId }) => {
  const { ndk } = useNDKStore()
  const [blocks, setBlocks] = useState<NDKEvent[]>([])

  useEffect(() => {
    if (!ndk) return

    const fetchBlocks = async () => {
      const filter = {
        '#S': [sectorId],
        kinds: [321] // Assuming 331 is the kind for blocks, adjust if necessary
      }

      try {
        const events = await ndk.fetchEvents(filter)
        setBlocks(Array.from(events))
      } catch (error) {
        console.error('Error fetching blocks:', error)
      }
    }

    fetchBlocks()
  }, [ndk, sectorId])

  return (
    <>
      {blocks.map((block) => (
        <Block key={block.id} event={block} sectorId={sectorId} />
      ))}
    </>
  )
}

interface BlockProps {
  event: NDKEvent
  sectorId: string
}

const Block: React.FC<BlockProps> = ({ event }) => {
  const position = getBlockPosition(event)
  const size = getBlockSize(event)

  return (
    <mesh position={position}>
      <boxGeometry args={[size, size, size]} />
      <meshBasicMaterial color={COLORS.YELLOW} /> {/* Yellow color */}
    </mesh>
  )
}

function getBlockPosition(event: NDKEvent): Vector3 {
  const cTag = event.tags.find(tag => tag[0] === 'C')
  if (!cTag || cTag.length < 2) {
    console.error('Block event is missing C tag:', event)
    return new Vector3()
  }

  const coordinate = cTag[1]
  const localCoordinates: DecimalVector3 = getSectorCoordinatesFromCyberspaceCoordinate(coordinate)
  return localCoordinates.toVector3()
}

function getBlockSize(event: NDKEvent): number {
  // Extract size from event tags or content
  // This is a placeholder implementation
  // You might want to base this on some property of the event
  return 5 // Fixed size of 5 units
}