
//create a component that takes the pubkey as a prop and renders a dot in the correct position for the avatar's pubkey coordinate

import { useContext, useEffect, useRef } from "react"
import { AvatarContext } from "../../providers/AvatarContext"
import { CYBERSPACE_DOWNSCALE, extractActionState } from "../../libraries/Cyberspace"
import { AvatarGeometryEdges, AvatarMaterialEdges } from "../Avatar/AvatarModel"
import * as THREE from "three"

export function AvatarMarker({pubkey}: {pubkey: string}) {

  const { getSimulatedState } = useContext(AvatarContext)

  const latestAction = getSimulatedState(pubkey)

  const lineSegmentsRef = useRef<THREE.LineSegments>(null)

  useEffect(() => {
    if (!latestAction) return

    const { position } = extractActionState(latestAction)

    const mapPosition = position.divideScalar(2**76).toVector3()

    console.log('mapPosition', mapPosition)

    if (lineSegmentsRef.current) {
      lineSegmentsRef.current.position.set(mapPosition.x, mapPosition.y, mapPosition.z)
    }
  }, [latestAction])

  useEffect(() => {
    if (lineSegmentsRef.current) {
      const worldPosition = new THREE.Vector3()
      lineSegmentsRef.current.getWorldPosition(worldPosition)
      console.log(worldPosition) // Logs the global position of the lineSegments object
    }
  }, [])

  return (
    <group position={[0,0,0]}>
      {/* default avatar represented by dodecahedron */}
      <lineSegments ref={lineSegmentsRef} scale={[10, 10, 10]} geometry={AvatarGeometryEdges} material={AvatarMaterialEdges} />
    </group>
  )
}