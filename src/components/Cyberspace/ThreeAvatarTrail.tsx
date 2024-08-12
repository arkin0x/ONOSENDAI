import { useContext, useMemo, useState } from 'react'
import { Color, Vector3 } from 'three'
import { Line } from '@react-three/drei'
import { AvatarContext } from '../../providers/AvatarContext'
import { extractActionState, ExtractedActionState, getSectorCoordinatesFromCyberspaceCoordinate } from '../../libraries/Cyberspace'
import { useFrame } from '@react-three/fiber'
import COLORS from '../../data/Colors'

interface ThreeAvatarTrailProps {
  pubkey: string
}

export function ThreeAvatarTrail({ pubkey }: ThreeAvatarTrailProps) {
  const { actionState } = useContext(AvatarContext)
  // const [simulatedState, setSimulatedState] = useState<ExtractedActionState | null>(null)

  const spawnPosition = getSectorCoordinatesFromCyberspaceCoordinate(pubkey).toVector3()

  const trailPoints = useMemo(() => {
    const actions = actionState[pubkey] || []
    if (actions.length < 2) return [] // We need at least 2 points to draw a line

    const acts = [...actions]

    const lines = acts.map(action => {
      const { sectorPosition } = extractActionState(action)
      // I need to subtract the spawn position to get the relative position
      const newVec = sectorPosition.toVector3().sub(spawnPosition)
      return newVec
    })
    // if (simulatedState) {
    //   const pos = simulatedState.sectorPosition.toVector3().sub(spawnPosition)
    //   lines.push(pos)
    // }
    return lines
  }, [actionState, pubkey, /*simulatedState*/])

  // uncomment this for trail to current position
  // useFrame(() => {
  // const simulated = getSimulatedState(pubkey)
  //   if (simulated) {
  //     setSimulatedState(extractActionState(simulated))
  //   }
  // })

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