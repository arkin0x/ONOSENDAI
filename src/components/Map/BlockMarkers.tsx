import React, { useEffect, useState, useContext } from 'react'
import { NDKContext } from '../../providers/NDKProvider'
import { Vector3 } from 'three'
import { CYBERSPACE_AXIS, decodeHexToCoordinates } from '../../libraries/Cyberspace'
import { NDKEvent } from '@nostr-dev-kit/ndk'

interface BlocksProps {
  scale: number
}

export const BlockMarkers: React.FC<BlocksProps> = ({ scale }) => {
  const { ndk } = useContext(NDKContext)
  const [blocks, setBlocks] = useState<NDKEvent[]>([])

  // TODO: 
  useEffect(() => {
    if (!ndk) return

    const fetchBlocks = async () => {
      const filter = {
        kinds: [321], // Assuming 331 is the kind for blocks, adjust if necessary
        limit: 100
      }

      try {
        const events = await ndk.subscribe(filter)
        events.on('event', (event: NDKEvent) => {
          setBlocks((blocks) => [...blocks, event])
        })
      } catch (error) {
        console.error('Error fetching blocks:', error)
      }
    }

    fetchBlocks()
  }, [ndk])

  // console.log('Blocks:', blocks.length)

  return (
    <>
      {blocks.map((block, x) => (
        <Block key={x} event={block} scale={scale} />
      ))}
    </>
  )
}

interface BlockProps {
  event: NDKEvent
  scale: number
}

const Block: React.FC<BlockProps> = ({ event, scale }) => {
  const position = getBlockPosition(event, scale)
  const size = getBlockSize(event)

  return (
    <mesh position={position}>
      <boxGeometry args={[size, size, size]} />
      <meshBasicMaterial color={0xffff00} />
    </mesh>
  )
}

function getBlockPosition(event: NDKEvent, scale: number): Vector3 {
  const cTag = event.tags.find(tag => tag[0] === 'C')
  if (!cTag || cTag.length < 2) {
    console.error('Block event is missing C tag:', event)
    return new Vector3()
  }

  const coordinate = cTag[1]
  const position = decodeHexToCoordinates(coordinate)
  const scaledPosition = position.vector.divideScalar(CYBERSPACE_AXIS.div(scale))
  return scaledPosition.toVector3()
}

function getBlockSize(event: NDKEvent): number {
  // Extract size from event tags or content
  // This is a placeholder implementation
  // You might want to base this on some property of the event
  return 3 // Fixed size of 5 units
}