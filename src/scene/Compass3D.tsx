/**
 * Compass3D — 3D compass showing orientation in world space.
 *
 * Renders a small 3D compass with three colored axes (X=red, Y=green, Z=blue)
 * that rotates opposite to the view so it always shows world-space orientation.
 * The compass uses its own small Canvas instance separate from the main scene.
 * Text labels are rendered as HTML overlays positioned in 3D space.
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useRef, useState } from 'react'
import { Group, Quaternion, Vector3 } from 'three'
import { useCyberspace } from '../store/useCyberspace'

interface LabelPosition {
  axis: 'x' | 'y' | 'z'
  screen: { x: number; y: number }
}

function CompassAxes({ onLabelsUpdate }: { onLabelsUpdate: (labels: LabelPosition[]) => void }): JSX.Element {
  const view = useCyberspace((s) => s.view)
  const groupRef = useRef<Group>(null)
  const currentQuaternion = useRef(new Quaternion())
  const { camera, size } = useThree()
  
  const arrowLength = 1.2
  const arrowThickness = 0.08
  const labelOffset = 0.15

  useFrame(() => {
    if (!groupRef.current) return

    // Smoothly interpolate toward target rotation
    // Rotate opposite to view so compass shows world-space orientation
    const target = view.clone().invert()
    currentQuaternion.current.slerp(target, 0.15)
    groupRef.current.quaternion.copy(currentQuaternion.current)

    // Project arrow tip positions to screen space
    const positions = [
      { axis: 'x' as const, world: new Vector3(arrowLength + labelOffset, 0, 0) },
      { axis: 'y' as const, world: new Vector3(0, arrowLength + labelOffset, 0) },
      { axis: 'z' as const, world: new Vector3(0, 0, arrowLength + labelOffset) },
    ]

    const labels: LabelPosition[] = positions.map(({ axis, world }) => {
      const transformed = world.clone().applyQuaternion(currentQuaternion.current)
      const projected = transformed.clone().project(camera)
      return {
        axis,
        screen: {
          x: (projected.x * 0.5 + 0.5) * size.width,
          y: (-projected.y * 0.5 + 0.5) * size.height,
        },
      }
    })

    onLabelsUpdate(labels)
  })

  return (
    <group ref={groupRef}>
      {/* X axis - red (cylinder defaults to Y, rotate 90° around Z to point along X) */}
      <mesh position={[arrowLength / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
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
  const [labels, setLabels] = useState<LabelPosition[]>([])

  const handleLabelsUpdate = (newLabels: LabelPosition[]) => {
    setLabels(newLabels)
  }

  return (
    <div className="compass-3d">
      <Canvas
        camera={{ position: [4, 3, 4], fov: 40, up: [0, 1, 0] }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.6} />
        <pointLight position={[5, 5, 5]} intensity={0.8} />
        <CompassAxes onLabelsUpdate={handleLabelsUpdate} />
      </Canvas>
      {labels.map(({ axis, screen }) => (
        <span
          key={axis}
          className={`compass-label compass-label--${axis}`}
          style={{
            left: `${screen.x}px`,
            top: `${screen.y}px`,
          }}
        >
          {axis.toUpperCase()}
        </span>
      ))}
    </div>
  )
}
