import { ReactNode } from "react"
import { Euler } from "three"

const purple = '#78004e'
const blue = '#0062cd'
const teal = '#06a4a4'

const GRIDLINES = 8

export function Grid({children, scale}: {children?: ReactNode, scale: number}) {
  return (
    <group
      rotation={new Euler(0, 0, 0)}
      position={[0, 0, 0]}
    >
      <gridHelper // Top Grid
        args={[scale, GRIDLINES, 0x682db5, blue]}
        position={[scale/2, scale, scale/2]} // all coordinates are positive, so the top left corner of the grid should be x0 z0.
      />
      <gridHelper // Bottom Grid
        args={[scale, GRIDLINES, 0x682db5, purple]}
        position={[scale/2, 0, scale/2]} // all coordinates are positive, so the top left corner of the grid should be x0 z0.
      />
      <mesh // Black Sun
        position={[scale/2, scale/2, -scale/2]}>
        <circleGeometry args={[scale/4]} />
        <meshBasicMaterial color={0x2b0c40} />
      </mesh>
      {/* // HALF_DOWNSCALED_CYBERSPACE_AXIS/2, 64)} material={SunMaterial} position={[HALF_DOWNSCALED_CYBERSPACE_AXIS,HALF_DOWNSCALED_CYBERSPACE_AXIS,-HALF_DOWNSCALED_CYBERSPACE_AXIS]} renderOrder={-1}/> */}
      {children}
    </group>
  )
}