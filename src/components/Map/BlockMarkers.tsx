import React, { useEffect, useState, useContext, useMemo } from 'react'
import { NDKContext } from '../../providers/NDKProvider'
import { BufferGeometry, Vector3, LineBasicMaterial } from 'three'
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
    if (blocks.length > 200) return // abritrary limit that should be replaced with good caching.

    const fetchNextBlock = async () => {
      let filter: NDKFilter

      if (blocks.length === 0) {
        filter = {
          kinds: [321],
          limit: 1,
          "#P": ["0000000000000000000000000000000000000000000000000000000000000000"]
        }
      } else {
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
          setTimeout(() => setFetchCounter(prev => prev + 1), 100)
        } else {
          console.log('No more blocks to fetch')
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
        <BlockLine 
          key={index} 
          currentBlock={block} 
          nextBlock={blocks[index + 1]} 
          scale={scale} 
        />
      ))}
    </>
  )
}

interface BlockLineProps {
  currentBlock: NDKEvent
  nextBlock?: NDKEvent
  scale: number
}

const BlockLine: React.FC<BlockLineProps> = ({ currentBlock, nextBlock, scale }) => {
  const startPosition = useMemo(() => getBlockPosition(currentBlock, scale), [currentBlock, scale])
  const endPosition = useMemo(() => nextBlock ? getBlockPosition(nextBlock, scale) : null, [nextBlock, scale])

  const geometry = useMemo(() => {
    const geo = new BufferGeometry()
    if (endPosition) {
      const points = [startPosition, endPosition]
      geo.setFromPoints(points)
    } else {
      // If there's no end position, just create a point at the start
      geo.setFromPoints([startPosition])
    }
    return geo
  }, [startPosition, endPosition])

  const material = useMemo(() => {
    return new LineBasicMaterial({
      color: 0xff9900,
      opacity: 0.5,
      linewidth: 1,
    })
  }, [])

  if (!endPosition) {
    // If there's no end position, don't render anything
    return null
  }

  return (
    <mesh>
      <line geometry={geometry} material={material} />
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