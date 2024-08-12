import { ReactNode } from "react"
import { Euler } from "three"
import COLORS from "../../data/Colors"

const GRIDLINES = 8

export function Grid({children, scale}: {children?: ReactNode, scale: number}) {
  return (
    <group
      rotation={new Euler(0, 0, 0)}
      position={[0, 0, 0]}
    >
      <gridHelper // Top Grid
        args={[scale, GRIDLINES, COLORS.GRID_CROSS, COLORS.SKY]}
        position={[scale/2, scale, scale/2]} // all coordinates are positive, so the top left corner of the grid should be x0 z0.
      />
      <gridHelper // Bottom Grid
        args={[scale, GRIDLINES, COLORS.GRID_CROSS, COLORS.GROUND]}
        position={[scale/2, 0, scale/2]} // all coordinates are positive, so the top left corner of the grid should be x0 z0.
      />
      <mesh // Black Sun
        position={[scale/2, scale/2, -scale/2]}
        renderOrder={-1}
      >
        <circleGeometry args={[scale/4]} />
        <meshBasicMaterial color={COLORS.BLACK_SUN} />
      </mesh>
      {children}
    </group>
  )
}