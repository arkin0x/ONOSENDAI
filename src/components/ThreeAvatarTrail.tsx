import { useContext, useMemo } from 'react'
import { Vector3, Color } from 'three'
import { Line } from '@react-three/drei'
import { AvatarContext } from '../providers/AvatarContext'
import { extractActionState, getSectorCoordinatesFromCyberspaceCoordinates } from '../libraries/Cyberspace'
import { spawn } from 'child_process'

interface ThreeAvatarTrailProps {
  pubkey: string
}

export function ThreeAvatarTrail({ pubkey }: ThreeAvatarTrailProps) {
  const { actionState } = useContext(AvatarContext)

  const spawnPosition = getSectorCoordinatesFromCyberspaceCoordinates(pubkey).toVector3()

  const trailPoints = useMemo(() => {
    const actions = actionState[pubkey] || []
    if (actions.length < 2) return [] // We need at least 2 points to draw a line

    return actions.map(action => {
      const { sectorPosition } = extractActionState(action)
      // I need to subtract the spawn position to get the relative position
      const newVec = sectorPosition.toVector3().sub(spawnPosition)
      return newVec
    })
  }, [actionState, pubkey])

  if (trailPoints.length < 2) {
    return null // Don't render anything if there are not enough trail points
  }

  return (
    <group position={spawnPosition}>
      <Line
        points={trailPoints}
        color={new Color(0xff2323)}
        lineWidth={1}
      />
    </group>
  )
}