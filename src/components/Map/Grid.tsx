import { ReactNode } from "react"
import { Euler } from "three"
import COLORS from "../../data/Colors"

const GRIDLINES = 8
const EARTH_SCALE = 0.13264 // Proportion of Earth's diameter to D-Space axis

export function Grid({children, scale}: {children?: ReactNode, scale: number}) {
  const earthRadius = (scale * EARTH_SCALE) / 2
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
      <mesh position={[scale/2, scale/2, scale/2]}>
        <sphereGeometry args={[earthRadius, 64, 64]} />
        <meshPhongMaterial color={COLORS.BLUE} opacity={.8} transparent={true} />
      </mesh>

      <lineSegments position={[scale/2, scale/2, scale/2]}>
        <icosahedronGeometry args={[earthRadius, 1]} />
        <lineBasicMaterial color={COLORS.BLUE } />
      </lineSegments>
      {children}
    </group>
  )
}