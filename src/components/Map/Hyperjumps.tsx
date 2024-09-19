import React, { useEffect, useState, useMemo } from 'react'
import { BufferGeometry, Vector3, LineBasicMaterial, Float32BufferAttribute, PointsMaterial } from 'three'
import { CYBERSPACE_AXIS, cyberspaceCoordinateFromHexString } from '../../libraries/Cyberspace'
import COLORS from '../../data/Colors'
import { useSectorStore } from '../../store/SectorStore'
import { Event } from 'nostr-tools'

interface HyperjumpsProps {
  scale: number
}

export const Hyperjumps: React.FC<HyperjumpsProps> = ({ scale }) => {
  const { getGlobalHyperjumps } = useSectorStore()
  const hyperjumpsSize = useSectorStore(state => state.globalHyperjumps.size)
  const [hyperjumps, setHyperjumps] = useState<Event[]>([])

  useEffect(() => {
    setHyperjumps(getGlobalHyperjumps())
  }, [getGlobalHyperjumps, hyperjumpsSize])

  return (
    <>
      {hyperjumps.map((hyperjump, index) => (
        <React.Fragment key={hyperjump.id}>
          <Block 
            event={hyperjump} 
            scale={scale} 
          />
          <BlockConnection 
            currentBlock={hyperjump} 
            nextBlock={hyperjumps[index + 1]} 
            scale={scale} 
          />
        </React.Fragment>
      ))}
    </>
  )
}

interface BlockProps {
  event: Event
  scale: number
}

const Block: React.FC<BlockProps> = ({ event, scale }) => {
  const position = getBlockPosition(event, scale)
  const size = 2

  const geometry = useMemo(() => {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute([position.x, position.y, position.z], 3))
    return geo
  }, [position])

  const material = useMemo(() => {
    return new PointsMaterial({
      color: 0xff9900,
      size: size,
      sizeAttenuation: false
    })
  }, [size])

  return (
    <>
      <mesh position={position}>
        <boxGeometry args={[0.1,0.1,0.1]} />
        <meshBasicMaterial color={COLORS.ORANGE} />
      </mesh>
      <points geometry={geometry} material={material} />
    </>
  )
}

interface BlockConnectionProps {
  currentBlock: Event
  nextBlock?: Event
  scale: number
}

const BlockConnection: React.FC<BlockConnectionProps> = ({ currentBlock, nextBlock, scale }) => {
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
      color: COLORS.ORANGE,
      opacity: 0.5,
      linewidth: 0.1,
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

function getBlockPosition(event: Event, scale: number): Vector3 {
  const cTag = event.tags.find(tag => tag[0] === 'C')
  if (!cTag || cTag.length < 2) {
    console.error('Block event is missing C tag:', event)
    return new Vector3()
  }

  const coordinate = cTag[1]
  const position = cyberspaceCoordinateFromHexString(coordinate)
  const scaledPosition = position.vector.divideScalar(CYBERSPACE_AXIS.div(scale))
  return scaledPosition.toVector3()
}