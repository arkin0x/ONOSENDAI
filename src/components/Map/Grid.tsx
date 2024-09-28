import { ReactNode } from "react"
import { Euler, LineBasicMaterial, RingGeometry } from "three"
import COLORS from "../../data/Colors"
import { CyberspacePlane } from "../../libraries/Cyberspace"
import { Text } from "@react-three/drei"

const GRIDLINES = 8
const EARTH_SCALE = 0.13264 // Proportion of Earth's diameter to D-Space axis

export function Grid({children, scale, plane = CyberspacePlane.DSpace}: {children?: ReactNode, scale: number, plane: CyberspacePlane}) {
  const earthRadius = (scale * EARTH_SCALE) / 2

  // Create the ring geometry
  const equatorGeometry = new RingGeometry(earthRadius * 1.1, earthRadius * 1.1, 64)
  const meridianGeometry = new RingGeometry(earthRadius * 1.1, earthRadius * 1.1, 64)
  meridianGeometry.setDrawRange(0, 192)
  const lineMaterial = new LineBasicMaterial({ color: COLORS.GREEN, linewidth: 2 })

  return (
    <group
      rotation={new Euler(0, 0, 0)}
      position={[0, 0, 0]}
    >
      <gridHelper // Top Grid
        args={[scale, GRIDLINES, COLORS.GRID_CROSS, plane === CyberspacePlane.DSpace ? 0x3B0097 : COLORS.SKY]}
        position={[scale/2, scale, scale/2]} // all coordinates are positive, so the top left corner of the grid should be x0 z0.
      />
      <gridHelper // Bottom Grid
        args={[scale, GRIDLINES, COLORS.GRID_CROSS, plane === CyberspacePlane.DSpace ? 0x3A0C40 : COLORS.GROUND]}
        position={[scale/2, 0, scale/2]} // all coordinates are positive, so the top left corner of the grid should be x0 z0.
      />
      <mesh // Black Sun
        position={[scale/2, scale/2, -scale/2]}
        renderOrder={-1}
      >
        <circleGeometry args={[scale/4]} />
        <meshBasicMaterial color={COLORS.BLACK_SUN} />
      </mesh>

      {/* display Earth in d-space */}
      { plane === CyberspacePlane.DSpace ? 
        <>
          <mesh position={[scale/2, scale/2, scale/2]}>
            <sphereGeometry args={[earthRadius, 64, 64]} />
            <meshPhongMaterial color={COLORS.BLUE} opacity={.8} transparent={true} />
          </mesh>
          <lineSegments position={[scale/2, scale/2, scale/2]}>
            <icosahedronGeometry args={[earthRadius, 1]} />
            <lineBasicMaterial color={COLORS.BLUE } />
          </lineSegments>
          {/* equator and meridian */}
          {/* equator ring */}
          <lineLoop geometry={equatorGeometry} material={lineMaterial} position={[scale/2, scale/2, scale/2]} rotation={[Math.PI/2, 0, 0]} />
          <Text
            font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}
            position={[scale/2, scale/2,earthRadius * 1.25 + scale/2]}
            fontSize={1}
            color={COLORS.GREEN}
            anchorX="center"
            anchorY="middle"
            rotation={[-Math.PI/2,0,0]}
          >
            EQUATOR
          </Text>
          {/* meridian rectangle */}
          <lineLoop geometry={meridianGeometry} material={lineMaterial} position={[scale/2, scale/2, scale/2]} rotation={[0, 0, -Math.PI/2]} />
          {/* <lineLoop geometry={rectangleGeometry} material={rectangleMaterial} position={[earthRadius * .8 + scale/2, scale/2, scale/2]} scale={[earthRadius * .8, earthRadius * 1.3, 1]} /> */}
          <Text
            font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}
            position={[earthRadius * 1.2 + scale/2, scale/2, scale/2]}
            fontSize={1}
            color={COLORS.GREEN}
            anchorX="center"
            anchorY="middle"
            rotation={[0,0,-Math.PI/2]}
          >
            PRIME MERIDIAN
          </Text>
        </>
      : null }

      {children}
    </group>
  )
}