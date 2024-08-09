
//create a component that takes the pubkey as a prop and renders a dot in the correct position for the avatar's pubkey coordinate

import { useContext, useEffect, useState } from "react"
import { AvatarContext } from "../../providers/AvatarContext"
import { CYBERSPACE_AXIS, extractActionState } from "../../libraries/Cyberspace"
import { AvatarGeometryEdges, AvatarMaterialEdges } from "../Avatar/AvatarModel"
import * as THREE from "three"
import { useActionChain } from "../../hooks/cyberspace/useActionChain"
import { useFrame, useThree } from "@react-three/fiber"
import { useRotationStore } from "../../store/RotationStore"
import { useZoomStore } from "../../store/ZoomStore"

export function AvatarMarker({pubkey, scale}: {pubkey: string, scale: number}) {
  const { rotation } = useRotationStore()
  const { zoom } = useZoomStore()

  const [position, setPosition] = useState(new THREE.Vector3(0, 0, 0))

  const { getSimulatedState } = useContext(AvatarContext)

  const { camera } = useThree()

  camera.far = scale ** 2

  useActionChain(pubkey)

  const DOWNSCALE = CYBERSPACE_AXIS.div(scale)

  const latestAction = getSimulatedState(pubkey)

  useEffect(() => {
    if (!latestAction) return

    const { position } = extractActionState(latestAction)

    const mapPosition = position.divideScalar(DOWNSCALE).toVector3()

    setPosition(mapPosition)

  }, [latestAction])

  useFrame(() => {

    const radius = scale * 2 - (zoom/64) * scale

    // camera.position.set(scale/2, scale*3, scale/2)
    // camera.rotation.set(-Math.PI/2, 0, 0)
    const oppositeRotation = rotation.clone()
    const cameraDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(oppositeRotation)
    const cameraPosition = position.clone().add(cameraDirection.multiplyScalar(radius))
    camera.position.copy(cameraPosition)
    camera.lookAt(new THREE.Vector3(scale/2,scale/2,scale/2))
    camera.updateProjectionMatrix()
    
  })
  // console.log(position)

  return (
    <group position={position}>
      {/* default avatar represented by dodecahedron */}
      <lineSegments scale={[1,1,1]} geometry={AvatarGeometryEdges} material={AvatarMaterialEdges} />
      {/* <axesHelper position={[0,0,0]} scale={512}/> */}
    </group>
  )
}