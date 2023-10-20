import React, { useMemo, useRef } from "react"
import * as THREE from "three"
import { UNIVERSE_SIZE_HALF, UNIVERSE_SIZE } from "../libraries/Cyberspace.js"

// const LOGO_TEAL = 0x06a4a4
const LOGO_PURPLE = 0x78004e
const LOGO_BLUE = 0x0062cd

// const TealLineMaterial = new THREE.LineBasicMaterial({
//   color: LOGO_TEAL,
// })
const PurpleLineMaterial = new THREE.LineBasicMaterial({
  color: LOGO_PURPLE,
})

const BlueLineMaterial = new THREE.LineBasicMaterial({
  color: LOGO_BLUE,
})

const SunMaterial = new THREE.MeshBasicMaterial({
 color: 0x2b0c40,
 side: THREE.DoubleSide,
})

interface CyberspaceProps {
  children: React.ReactNode,
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
        args={[UNIVERSE_SIZE, 32]}
        position={[UNIVERSE_SIZE_HALF, UNIVERSE_SIZE, UNIVERSE_SIZE_HALF]}
        material={BlueLineMaterial}
        renderOrder={1}
      />,
      <gridHelper
        key="y-"
        args={[UNIVERSE_SIZE, 32]}
        position={[UNIVERSE_SIZE_HALF, 0, UNIVERSE_SIZE_HALF]}
        material={PurpleLineMaterial}
        renderOrder={1}
      />,
    ]

    const blacksun = (
      <mesh geometry={new THREE.CircleGeometry(UNIVERSE_SIZE_HALF/2, 64)} material={SunMaterial} position={[UNIVERSE_SIZE_HALF,UNIVERSE_SIZE_HALF,-UNIVERSE_SIZE_HALF]} renderOrder={-1}/>
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
