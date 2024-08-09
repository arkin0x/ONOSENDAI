import React, { useEffect, useState, useContext } from 'react'
import { NDKContext } from '../../providers/NDKProvider'
import { Vector3 } from 'three'
import { CYBERSPACE_AXIS, decodeHexToCoordinates } from '../../libraries/Cyberspace'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ConstructGeometryEdges, ConstructMaterialEdges } from '../../data/ConstructModel'
import { Event, SimplePool } from 'nostr-tools'
import { defaultRelays, getRelayList } from '../../libraries/Nostr'

interface ConstructsProps {
  scale: number
}

export const ObjectMarkers: React.FC<ConstructsProps> = ({ scale }) => {
  const { ndk } = useContext(NDKContext)
  const [constructs, setConstructs] = useState<NDKEvent[]>([])
  const [blocks, setBlocks] = useState<NDKEvent[]>([])

  const limit = 1000

  // TODO: figure out why 321 and 331 can't be in the same filter, and why NDK merges filters when two separate components are doing separate subscriptions.
  useEffect(() => {
    if (!ndk) return

    const fetchObjects = async () => {
      const filter = [{
        kinds: [331],
        limit
      },
      {
        kinds: [321], 
        limit
      }]
      const pool = new SimplePool()
      const sub = pool.sub(getRelayList(defaultRelays), filter)

      try {
        sub.on('event', (event: Event) => {
          if (event.kind === 331) {
            setConstructs((constructs) => [...constructs, event as NDKEvent])
          } else if (event.kind === 321) {
            setBlocks((blocks) => [...blocks, event as NDKEvent])
          }
        })
      } catch (error) {
        console.error('Error fetching constructs:', error)
      }
    }

    fetchObjects()
  }, [ndk])

  // console.log('Constructs:', constructs.length)

  return (
    <>
      {constructs.map((construct, x) => (
        <Construct key={`construct${x}`} event={construct} scale={scale} />
      ))}
      {blocks.map((block, x) => (
        <Block key={`block-${x}`} event={block} scale={scale} />
      ))}
    </>
  )
}

interface ConstructProps {
  event: NDKEvent
  scale: number
}

const Construct: React.FC<ConstructProps> = ({ event, scale }) => {
  const position = getConstructPosition(event, scale)
  const size = getConstructSize(event)

  return (
    <mesh position={position}>
      <lineSegments scale={size} geometry={ConstructGeometryEdges} material={ConstructMaterialEdges} />
    </mesh>
  )
}

function getConstructPosition(event: NDKEvent, scale: number): Vector3 {
  const cTag = event.id
  if (!cTag || cTag.length < 2) {
    console.error('Construct event is missing C tag:', event)
    return new Vector3()
  }

  const coordinate = cTag
  const position = decodeHexToCoordinates(coordinate)
  const scaledPosition = position.vector.divideScalar(CYBERSPACE_AXIS.div(scale))
  return scaledPosition.toVector3()
}

function getConstructSize(event: NDKEvent): number {
  // Extract size from event tags or content
  // This is a placeholder implementation
  // You might want to base this on some property of the event
  return 3 // Fixed size of 5 units
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
      <meshBasicMaterial color={0xff9900} />
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
  return 1 // Fixed size of 5 units
}