import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments } from 'three'
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

  const trailObject = useMemo(() => {
    if (trailPoints.length < 6) return null // We need at least 2 points (6 values) to draw a line

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(trailPoints, 3))
    
    const material = new LineBasicMaterial({ color: COLORS.RED, linewidth: 1 })
    
    // return new LineSegments(geometry, material)
    return [geometry, material]
  }, [trailPoints])

  if (!trailObject) {
    return null // Don't render anything if there are not enough trail points
  }

  return (
    <line geometry={trailObject[0]} material={trailObject[1]} position={spawnPosition} />
  )
}