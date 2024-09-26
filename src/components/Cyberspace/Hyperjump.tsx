import { Event } from 'nostr-tools'
import { BufferGeometry, Float32BufferAttribute, Mesh, PointsMaterial, Vector3, Group } from 'three'
import { CyberspaceCoordinate, cyberspaceCoordinateFromHexString } from '../../libraries/Cyberspace'
import COLORS from '../../data/Colors'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'

interface HyperjumpProps {
  event: Event
}

function Hyperjump({event}: HyperjumpProps) {
  const hyperjumpRef = useRef<Group>(null)

  const position = getBlockPosition(event)
  const size = 1// BLOCK_SIZE

   const geometry = useMemo(() => {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute([0,0,0], 3))
    return geo
  }, [position])

  const material = useMemo(() => {
    return new PointsMaterial({
      color: COLORS.HYPERJUMP,
      size: 3,
      sizeAttenuation: false
    })
  }, [])

  useFrame(() => {
    if (hyperjumpRef.current) {
      hyperjumpRef.current.rotation.y += 0.01
      hyperjumpRef.current.rotation.x += 0.01
    }
  })

  return (
    <group ref={hyperjumpRef} position={position}>
      <mesh>
        <boxGeometry args={[size, size, size]} />
        <meshBasicMaterial color={COLORS.YELLOW} />
      </mesh>
      <points geometry={geometry} material={material} />
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
  // console.log('ctag', coordinate, event)
  const coord: CyberspaceCoordinate = cyberspaceCoordinateFromHexString(coordinate)
  const localVector = coord.local.vector.toVector3()
  // console.log('localVector', localVector)
  return localVector
}

export default Hyperjump