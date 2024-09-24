import { Line } from '@react-three/drei'
import { cyberspaceCoordinateFromHexString } from '../../libraries/Cyberspace'
import COLORS from '../../data/Colors'
import { useAsyncTrailPoints } from '../../hooks/useAsyncTrailPoints'

interface ThreeAvatarTrailProps {
  pubkey: string
}

export function ThreeAvatarTrail({ pubkey }: ThreeAvatarTrailProps) {
  const trailPoints = useAsyncTrailPoints(pubkey)

  const coord = cyberspaceCoordinateFromHexString(pubkey)
  const spawnPosition = coord.local.vector.toVector3()

  if (trailPoints.length < 2) {
    return null // Don't render anything if there are not enough trail points
  }

  return (
    <group position={spawnPosition}>
      <Line
        points={trailPoints}
        color={COLORS.RED}
        lineWidth={1}
      />
    </group>
  )
}