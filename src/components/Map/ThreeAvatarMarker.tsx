import { useFrame } from "@react-three/fiber"
import { AvatarGeometryEdges, AvatarMaterialEdges } from "../../data/AvatarModel"
import { useEffect, useState } from "react"
import { useAvatarStore } from "../../store/AvatarStore"
import { extractCyberspaceActionState } from "../../libraries/Cyberspace"
import { useSectorStore } from "../../store/SectorStore"

export function ThreeAvatarMarker({pubkey}: {pubkey: string}) {
  const { getSimulatedState } = useAvatarStore()
  const { updateUserCurrentSectorId } = useSectorStore()
  const [frameSectorId, setFrameSectorId] = useState<string>()


  // get simulated sectorPosition and velocity each frame
  useFrame(() => {
    const simulatedEvent = getSimulatedState(pubkey)
    console.log('sim', simulatedEvent)
    if (simulatedEvent) {
      const { sector } = extractCyberspaceActionState(simulatedEvent)
      setFrameSectorId(sector.id)
    }
  })

  // "Memoize" updateSectorId call
  useEffect(() => {
    if (frameSectorId) {
      updateUserCurrentSectorId(frameSectorId)
    }
  }, [frameSectorId, updateUserCurrentSectorId])

  return (
    <group position={[0,0,0]}>
      {/* default avatar represented by dodecahedron */}
      <lineSegments scale={[.5,.5,.5]} geometry={AvatarGeometryEdges} material={AvatarMaterialEdges} />
      {/* <axesHelper position={[0,0,0]} scale={512}/> */}
    </group>
  )
}