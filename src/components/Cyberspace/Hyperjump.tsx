import { Event } from 'nostr-tools'
import { Vector3 } from 'three'
import { getSectorCoordinatesFromCyberspaceCoordinate } from '../../libraries/Cyberspace'
import { DecimalVector3 } from '../../libraries/DecimalVector3'
import COLORS from '../../data/Colors'

interface HyperjumpProps {
  event: Event
}

const BLOCK_SIZE = 3

function Hyperjump({event}: HyperjumpProps) {

  const position = getBlockPosition(event)
  const size = BLOCK_SIZE

  return (
    <mesh position={position}>
      <boxGeometry args={[size, size, size]} />
      <meshBasicMaterial color={COLORS.YELLOW} /> {/* Yellow color */}
    </mesh>
  )
}

function getBlockPosition(event: Event): Vector3 {
  const cTag = event.tags.find(tag => tag[0] === 'C')
  if (!cTag || cTag.length < 2) {
    console.error('Block event is missing C tag:', event)
    return new Vector3()
  }

  const coordinate = cTag[1]
  const localCoordinates: DecimalVector3 = getSectorCoordinatesFromCyberspaceCoordinate(coordinate)
  return localCoordinates.toVector3()
}

export default Hyperjump