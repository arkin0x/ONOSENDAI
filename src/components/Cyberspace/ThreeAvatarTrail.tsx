import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial } from 'three'
import { cyberspaceCoordinateFromHexString } from '../../libraries/Cyberspace'
import COLORS from '../../data/Colors'
import { useAsyncTrailPoints } from '../../hooks/useAsyncTrailPoints'

interface ThreeAvatarTrailProps {
  pubkey: string
}

export function ThreeAvatarTrail({ pubkey }: ThreeAvatarTrailProps) {
  const { trailPoints, isReady } = useAsyncTrailPoints(pubkey)

  const coord = cyberspaceCoordinateFromHexString(pubkey)
  const spawnPosition = coord.local.vector.toVector3()

  const trailObject = useMemo<[BufferGeometry, LineBasicMaterial] | null>(() => {
    if (!isReady || trailPoints.length < 6) return null // We need at least 2 points (6 values) to draw a line

    const startTime = performance.now()
    console.log('gonna make a buffer')

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(trailPoints, 3))

    const endTime = performance.now()
    console.log('made a buffer', `Elapsed time: ${endTime - startTime} ms`)
    
    
    const material = new LineBasicMaterial({ color: COLORS.RED, linewidth: 1 })
    
    return [geometry, material]
  }, [trailPoints, isReady])

  if (!trailObject) {
    return null // Don't render anything if there are not enough trail points or if it's not ready
  }

  return (
    <primitive object={new Line(trailObject[0], trailObject[1])} position={spawnPosition} />
  )
}