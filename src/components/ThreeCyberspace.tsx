import React, { useMemo, useRef, useState, useEffect } from "react"
import { useThree, useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { BigCoords, downscaleCoords } from "../libraries/Constructs.js"
import { UNIVERSE_SIZE_HALF, UNIVERSE_DOWNSCALE, UNIVERSE_SIZE } from "../libraries/Cyberspace.js"

const INTERACTION_RESET_DELAY = 5_000

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
  // assert parentRef.current is not null
  parentRef: React.RefObject<HTMLDivElement>,
  targetSize: number, // size of construct to determine camera orbit radius
  targetCoord: BigCoords, // for camera orbit
  children: React.ReactNode,
}

const centerVec = new THREE.Vector3(UNIVERSE_SIZE_HALF, UNIVERSE_SIZE_HALF, UNIVERSE_SIZE_HALF) // The center of cyberspace

export const Cyberspace: React.FC<CyberspaceProps> = ({ parentRef, targetSize, targetCoord, children }) => {
  const groupRef = useRef<THREE.Group>(null)

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const parent = parentRef.current!

  // Attach pointerdown and pointerup event listeners
  useEffect(() => {
    setLerpAlpha(1)
    const handleInteractionStart = () => {
      setLerpAlpha(0.05) // permanent
      setInteractionResetDelay(INTERACTION_RESET_DELAY)
      clearTimeout(defaultViewTimeoutRef.current)
      // setInteractionActive(true)
      setDefaultView(false)
    }
    const handleInteractionEnd = () => {
      setLerpAlpha(0.05)
      setInteractionResetDelay(0)
      // setInteractionActive(false)
      defaultViewTimeoutRef.current = setTimeout(() => {
          // LERP camera back to default orbit
          setDefaultView(true)
        }, interactionResetDelay)
    }

    parent.addEventListener('pointerdown', handleInteractionStart)
    parent.addEventListener('pointerup', handleInteractionEnd)
    parent.addEventListener('wheel', handleInteractionStart)

    // Cleanup event listeners on unmount
    return () => {
      parent.removeEventListener('pointerdown', handleInteractionStart)
      parent.removeEventListener('pointerup', handleInteractionEnd)
      parent.addEventListener('wheel', handleInteractionStart)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSize, targetCoord])

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
