/**
 * Compass3D — 3D compass showing orientation in world space.
 *
 * Renders a small 3D compass with three colored axes (X=red, Y=green, Z=blue)
 * that rotates opposite to the view so it always shows world-space orientation.
 * The compass uses its own small Canvas instance separate from the main scene.
 */

import { Canvas, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Group, Quaternion } from 'three'
import { useCyberspace } from '../store/useCyberspace'

function CompassAxes(): JSX.Element {
  const view = useCyberspace((s) => s.view)
  const groupRef = useRef<Group>(null)
  const currentQuaternion = useRef(new Quaternion())

  useFrame(() => {
    if (!groupRef.current) return

    // Smoothly interpolate toward target rotation
    // Rotate opposite to view so compass shows world-space orientation
    const target = view.clone().invert()
    currentQuaternion.current.slerp(target, 0.15)
    groupRef.current.quaternion.copy(currentQuaternion.current)
  })

  const arrowLength = 1.2
  const arrowThickness = 0.08

  return (
    <group ref={groupRef}>
      {/* X axis - red */}
      <mesh position={[arrowLength / 2, 0, 0]}>
        <cylinderGeometry args={[arrowThickness, arrowThickness, arrowLength, 8]} />
        <meshStandardMaterial color="#ff4444" emissive="#ff4444" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[arrowLength, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[arrowThickness * 2, 0.3, 8]} />
        <meshStandardMaterial color="#ff4444" emissive="#ff4444" emissiveIntensity={0.3} />
      </mesh>

      {/* Y axis - green */}
      <mesh position={[0, arrowLength / 2, 0]}>
        <cylinderGeometry args={[arrowThickness, arrowThickness, arrowLength, 8]} />
        <meshStandardMaterial color="#44ff44" emissive="#44ff44" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, arrowLength, 0]}>
        <coneGeometry args={[arrowThickness * 2, 0.3, 8]} />
        <meshStandardMaterial color="#44ff44" emissive="#44ff44" emissiveIntensity={0.3} />
      </mesh>

      {/* Z axis - blue */}
      <mesh position={[0, 0, arrowLength / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[arrowThickness, arrowThickness, arrowLength, 8]} />
        <meshStandardMaterial color="#4488ff" emissive="#4488ff" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, 0, arrowLength]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[arrowThickness * 2, 0.3, 8]} />
        <meshStandardMaterial color="#4488ff" emissive="#4488ff" emissiveIntensity={0.3} />
      </mesh>

      {/* Center sphere */}
      <mesh>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.2} />
      </mesh>
    </group>
  )
}

export function Compass3D(): JSX.Element {
  return (
    <div className="compass-3d">
      <Canvas
        camera={{ position: [3, 3, 3], fov: 50 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.6} />
        <pointLight position={[5, 5, 5]} intensity={0.8} />
        <CompassAxes />
      </Canvas>
      <div className="compass-labels">
        <span className="compass-label compass-label--x">X</span>
        <span className="compass-label compass-label--y">Y</span>
        <span className="compass-label compass-label--z">Z</span>
      </div>
    </div>
  )
}
