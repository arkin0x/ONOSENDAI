import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { extractActionState, getSectorCoordinatesFromCyberspaceCoordinate } from '../../libraries/Cyberspace'
import COLORS from '../../data/Colors'
import { useAvatarStore } from '../../store/AvatarStore'
import { useSectorStore } from '../../store/SectorStore'

interface ThreeAvatarTrailProps {
  pubkey: string
}

export function ThreeAvatarTrail({ pubkey }: ThreeAvatarTrailProps) {
  const { actionState } = useAvatarStore()
  const { userCurrentSectorId } = useSectorStore()
  // const [simulatedState, setSimulatedState] = useState<ExtractedActionState | null>(null)

  const spawnPosition = getSectorCoordinatesFromCyberspaceCoordinate(pubkey).toVector3()

  const trailPoints = useMemo(() => {
    const actions = actionState[pubkey] || []
    if (actions.length < 2) return [] // We need at least 2 points to draw a line

    const acts = [...actions]

    const lines = acts.map(action => {
      const { sectorPosition, sectorId } = extractActionState(action)
      if (sectorId !== userCurrentSectorId) {
        console.log('omitting action from different sector', sectorId, userCurrentSectorId, action)
        return null
      }
      // I need to subtract the spawn position to get the relative position
      const newVec = sectorPosition.toVector3().sub(spawnPosition)
      return newVec
    }).filter(Boolean) as THREE.Vector3[]
    // if (simulatedState) {
    //   const pos = simulatedState.sectorPosition.toVector3().sub(spawnPosition)
    //   lines.push(pos)
    // }
    return lines
  }, [actionState, pubkey, spawnPosition, userCurrentSectorId])

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