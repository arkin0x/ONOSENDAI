import React, { useEffect, useState, useContext } from 'react'
import { NDKContext } from '../../providers/NDKProvider'
import { Vector3 } from 'three'
import { CYBERSPACE_AXIS, cyberspaceCoordinateFromHexString } from '../../libraries/Cyberspace'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ConstructGeometryEdges, ConstructMaterialEdges } from '../../data/ConstructModel'

interface ConstructsProps {
  scale: number
}

export const Constructs: React.FC<ConstructsProps> = ({ scale }) => {
  const { ndk } = useNDKStore()
  const [constructs, setConstructs] = useState<NDKEvent[]>([])

  // TODO: 
  useEffect(() => {
    if (!ndk) return

    const fetchConstructs = async () => {
      const filter = {
        kinds: [331], // Assuming 331 is the kind for constructs, adjust if necessary
        limit: 500
      }

      try {
        const events = await ndk.subscribe(filter)
        events.on('event', (event: NDKEvent) => {
          setConstructs((constructs) => [...constructs, event])
        })
      } catch (error) {
        console.error('Error fetching constructs:', error)
      }
    }

    fetchConstructs()
  }, [ndk])

  // console.log('Constructs:', constructs.length)

  return (
    <>
      {constructs.map((construct, x) => (
        <Construct key={x} event={construct} scale={scale} />
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
  const position = cyberspaceCoordinateFromHexString(coordinate)
  const scaledPosition = position.vector.divideScalar(CYBERSPACE_AXIS.div(scale))
  return scaledPosition.toVector3()
}

function getConstructSize(event: NDKEvent): number {
  // Extract size from event tags or content
  // This is a placeholder implementation
  // You might want to base this on some property of the event
  return 3 // Fixed size of 5 units
}