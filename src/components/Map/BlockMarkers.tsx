import React, { useEffect, useState, useContext, useMemo } from 'react'
import { NDKContext } from '../../providers/NDKProvider'
import { BufferGeometry, Float32BufferAttribute, PointsMaterial, Vector3 } from 'three'
import { CYBERSPACE_AXIS, decodeHexToCoordinates } from '../../libraries/Cyberspace'
import { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'

interface BlocksProps {
  scale: number
}

export const BlockMarkers: React.FC<BlocksProps> = ({ scale }) => {
  const { ndk } = useContext(NDKContext)
  const [blocks, setBlocks] = useState<NDKEvent[]>([])
  const [fetchCounter, setFetchCounter] = useState(0)

  useEffect(() => {
    if (!ndk) return

    const fetchNextBlock = async () => {
      let filter: NDKFilter

      if (blocks.length === 0) {
        // Fetch the first block
        filter = {
          kinds: [321],
          limit: 1,
          "#P": ["0000000000000000000000000000000000000000000000000000000000000000"]
        }
      } else {
        // Fetch the next block
    const nextBlockHash = blocks[blocks.length - 1].tags.find(tag => tag[0] === 'N')?.[1]
        if (!nextBlockHash) {
          console.error('Block event is missing N tag')
          return
        }
        filter = {
          kinds: [321],
        limit: 1,
        "#H": [nextBlockHash]
        }
      }

      try {
      const event = await ndk.fetchEvent(filter)
        if (event) {
          setBlocks(prevBlocks => [...prevBlocks, event])
          // Trigger next fetch after a short delay
          setTimeout(() => setFetchCounter(prev => prev + 1), 1000)
      } else {
          console.log('No more blocks to fetch. Last block fetched:' , blocks[blocks.length - 1].tags.find(tag => tag[0] === 'H')?.[1])
        }
      } catch (error) {
        console.error('Failed to fetch block:', error)
      }
    }

    fetchNextBlock()
  }, [ndk, blocks, fetchCounter])

  return (
    <>
      {blocks.map((block, index) => (
        <Block key={index} event={block} scale={scale} />
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

  const geometry = useMemo(() => {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute([position.x, position.y, position.z], 3))
    return geo
  }, [position])

  const material = useMemo(() => {
    return new PointsMaterial({
      color: 0xff9900,
      size: 2,
      sizeAttenuation: false
    })
  }, [size])

  return <points geometry={geometry} material={material} />

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