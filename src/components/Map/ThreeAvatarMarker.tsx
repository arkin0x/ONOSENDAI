import { useFrame } from "@react-three/fiber"
import { AvatarGeometryEdges, AvatarMaterialEdges } from "../../data/AvatarModel"
import { useContext, useEffect, useState } from "react"
import { useAvatarStore } from "../../store/AvatarStore"
import { extractCyberspaceActionState } from "../../libraries/Cyberspace"
import { useSectorStore } from "../../store/SectorStore"
import { IdentityContextType } from "../../types/IdentityType"
import { IdentityContext } from "../../providers/IdentityProvider"
import { Vector3 } from "three"

interface ThreeAvatarMarkerProps {
  position: Vector3
}

export function ThreeAvatarMarker({ position }: ThreeAvatarMarkerProps) {
  const { identity } = useContext<IdentityContextType>(IdentityContext)
  const { getSimulatedState } = useAvatarStore()
  const { updateUserCurrentSectorId } = useSectorStore()
  const [frameSectorId, setFrameSectorId] = useState<string>()


  // get simulated sectorPosition and velocity each frame
  useFrame(() => {
    const simulatedEvent = getSimulatedState(identity?.pubkey)
    if (simulatedEvent) {
      const { sector } = extractCyberspaceActionState(simulatedEvent)
      if (frameSectorId !== sector.id) {
        setFrameSectorId(sector.id)
      }
    }
  })

  // update user's current sector id based on simulation for cyberspace map.
  // "Memoize" updateSectorId call so it isn't called every frame.
  useEffect(() => {
    if (frameSectorId) {
      console.log('updating sector id', frameSectorId)
      updateUserCurrentSectorId(frameSectorId)
    }
  }, [frameSectorId, updateUserCurrentSectorId])

  return (
    <group position={position || [0,0,0]}>
      {/* default avatar represented by dodecahedron */}
      <lineSegments scale={[.5,.5,.5]} geometry={AvatarGeometryEdges} material={AvatarMaterialEdges} />
    </group>
  )
}