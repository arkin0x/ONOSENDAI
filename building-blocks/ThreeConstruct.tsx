import React, { useMemo, useRef } from "react"
import * as THREE from "three"
import { Line } from "three"
import { InverseConstructLineData, getCubeWireframeVertices } from "../src/data/ConstructLineData.js"
import { BigCoords, downscaleCoords } from "../src/libraries/Constructs.js"
import { UNIVERSE_DOWNSCALE } from "../src/libraries/Cyberspace.js"

const LOGO_TEAL = 0x06a4a4
const LOGO_PURPLE = 0x78004e
// const LOGO_BLUE = 0x0062cd

const TealLineMaterial = new THREE.LineBasicMaterial({
  color: LOGO_TEAL,
})
const PurpleLineMaterial = new THREE.LineBasicMaterial({
  color: LOGO_PURPLE,
})

// const BlueLineMaterial = new THREE.LineBasicMaterial({
//   color: LOGO_BLUE,
// })

export const Construct: React.FC<{ coord: BigCoords, size?: number  }> = ({ coord, size = 1 }) => {
  const groupRef = useRef<THREE.Group>(null)

  const downscaledCoord = downscaleCoords(coord, UNIVERSE_DOWNSCALE)

  let count = 0

  // Compute the lines and grids only once
  const { lines, cube } = useMemo(() => {
    const lines = InverseConstructLineData.map(([start, end]) => {
      const points = [new THREE.Vector3(...start), new THREE.Vector3(...end)]
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      return (
        <primitive
          key={"line"+JSON.stringify({ start, end })}
          object={new Line(geometry, TealLineMaterial)}
        />
      )
    })

    const cube = getCubeWireframeVertices(1).map(([start, end]) => {
      const points = [new THREE.Vector3(...start), new THREE.Vector3(...end)]
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      count++
      return (
        <primitive
          key={`cube${count}`}
          object={new Line(geometry, PurpleLineMaterial)}
        />
      )
    })

    return { lines, cube }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <group scale={[size, size, size]} ref={groupRef} position={[downscaledCoord.x, downscaledCoord.y, downscaledCoord.z]} renderOrder={2}>
      {lines}
      {cube}
    </group>
  )
}
