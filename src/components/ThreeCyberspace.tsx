import React, { useMemo, useRef } from "react"
import * as THREE from "three"
import { HALF_DOWNSCALED_CYBERSPACE_AXIS, DOWNSCALED_CYBERSPACE_AXIS} from "../libraries/Cyberspace.js"
import COLORS from "../data/Colors.js"

// const TealLineMaterial = new THREE.LineBasicMaterial({
//   color: LOGO_TEAL,
// })
const PurpleLineMaterial = new THREE.LineBasicMaterial({
  color: COLORS.LOGO_PURPLE,
})

const BlueLineMaterial = new THREE.LineBasicMaterial({
  color: COLORS.LOGO_BLUE,
})

const SunMaterial = new THREE.MeshBasicMaterial({
 color: COLORS.BLACK_SUN, 
 side: THREE.DoubleSide,
})

interface CyberspaceProps {
  children?: React.ReactNode,
}

/**
 * The Cyberspace component is the root of the 3D scene. It contains the grids, black sun, and the children THREE elements like the Avatar
 * @param param0 children
 * @returns 
 */
export const Cyberspace: React.FC<CyberspaceProps> = ({ children }) => {
  const groupRef = useRef<THREE.Group>(null)

  // Compute the lines and grids only once
  const { grids, blacksun } = useMemo(() => {
    const grids = [
      <gridHelper
        key="y+"
        args={[DOWNSCALED_CYBERSPACE_AXIS, 32]}
        position={[HALF_DOWNSCALED_CYBERSPACE_AXIS, DOWNSCALED_CYBERSPACE_AXIS, HALF_DOWNSCALED_CYBERSPACE_AXIS]}
        material={BlueLineMaterial}
        renderOrder={1}
      />,
      <gridHelper
        key="y-"
        args={[DOWNSCALED_CYBERSPACE_AXIS, 32]}
        position={[HALF_DOWNSCALED_CYBERSPACE_AXIS, 0, HALF_DOWNSCALED_CYBERSPACE_AXIS]}
        material={PurpleLineMaterial}
        renderOrder={1}
      />,
    ]

    const blacksun = (
      <mesh geometry={new THREE.CircleGeometry(HALF_DOWNSCALED_CYBERSPACE_AXIS/2, 64)} material={SunMaterial} position={[HALF_DOWNSCALED_CYBERSPACE_AXIS,HALF_DOWNSCALED_CYBERSPACE_AXIS,-HALF_DOWNSCALED_CYBERSPACE_AXIS]} renderOrder={-1}/>
    )

    return { grids, blacksun }
  }, [])
  
  return (
    <group ref={groupRef}>
      {blacksun}
      {grids}
      {children}
    </group>
  )
}
