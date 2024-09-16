import { Event } from 'nostr-tools'
import { BufferGeometry, Float32BufferAttribute, PointsMaterial, Vector3 } from 'three'
import { CyberspaceCoordinate, cyberspaceCoordinateFromHexString } from '../../libraries/Cyberspace'
import COLORS from '../../data/Colors'
import { useMemo } from 'react'
import { shardData } from '../../data/ShardData'
import Shard from './Shard'

interface HyperjumpProps {
  event: Event
}

const BLOCK_SIZE = 1

function Hyperjump({event}: HyperjumpProps) {

  const position = getBlockPosition(event)
  const size = 1// BLOCK_SIZE

   const geometry = useMemo(() => {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute([0,0,0], 3))
    return geo
  }, [position])

  const material = useMemo(() => {
    return new PointsMaterial({
      color: 0x000000,//0xff9900,
      size: 1,
      sizeAttenuation: false
    })
  }, [size])

  // return 

  console.log('hyperjump', position)

  return (
    <group position={position}>
      {/* <mesh>
        <boxGeometry args={[size, size, size]} />
        <meshBasicMaterial color={COLORS.YELLOW} />
      </mesh> */}
      <points geometry={geometry} material={material} />
      <Shard shardData={shardData} />
    </group>
  )
}

function getBlockPosition(event: Event): Vector3 {
  const cTag = event.tags.find(tag => tag[0] === 'C')
  if (!cTag || cTag.length < 2) {
    console.error('Block event is missing C tag:', event)
    return new Vector3()
  }

  const coordinate = cTag[1]
  console.log('ctag', coordinate, event)
  const coord: CyberspaceCoordinate = cyberspaceCoordinateFromHexString(coordinate)
  const localVector = coord.local.vector.toVector3()
  console.log('localVector', localVector)
  return localVector
}

export default Hyperjump