/**
 * Compass3D — 3D compass showing orientation in world space.
 *
 * Renders a small 3D compass with three colored axes (X=red, Y=green, Z=blue).
 * The camera follows the main view's orientation so the compass always matches
 * what you see in the main scene. Axes stay fixed in world space.
 * Text labels are rendered as HTML overlays positioned in 3D space.
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useRef, useState } from 'react'
import { Quaternion, Vector3 } from 'three'
import { useCyberspace } from '../store/useCyberspace'

interface LabelPosition {
  axis: 'x' | 'y' | 'z'
  screen: { x: number; y: number }
}

const CAMERA_DISTANCE = 5
const COMPASS_RADIUS = 1.2
const ARROW_THICKNESS = 0.08
const CONE_RADIUS = ARROW_THICKNESS * 2
const CONE_HEIGHT = 0.3
const LABEL_OFFSET = 0.2

function CompassScene({ onLabelsUpdate }: { onLabelsUpdate: (labels: LabelPosition[]) => void }): JSX.Element {
  const view = useCyberspace((s) => s.view)
  const { camera, size } = useThree()

  const currentQuaternion = useRef(new Quaternion())

  useFrame(() => {
    // Position camera to match the main scene's view direction
    const target = view.clone()
    currentQuaternion.current.slerp(target, 0.15)

    // Camera looks from the same direction as the main scene
    const cameraPos = new Vector3(0, 0, CAMERA_DISTANCE)
      .applyQuaternion(currentQuaternion.current)
    camera.position.copy(cameraPos)
    camera.lookAt(0, 0, 0)

    // Project arrow tip positions to screen space for labels
    const axisTips = [
      { axis: 'x' as const, world: new Vector3(COMPASS_RADIUS + LABEL_OFFSET, 0, 0) },
      { axis: 'y' as const, world: new Vector3(0, COMPASS_RADIUS + LABEL_OFFSET, 0) },
      { axis: 'z' as const, world: new Vector3(0, 0, COMPASS_RADIUS + LABEL_OFFSET) },
    ]

    const labels: LabelPosition[] = axisTips.map(({ axis, world }) => {
      const projected = world.clone().project(camera)
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
    <group>
      {/* X axis - red */}
      <mesh position={[COMPASS_RADIUS / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[ARROW_THICKNESS, ARROW_THICKNESS, COMPASS_RADIUS, 8]} />
        <meshStandardMaterial color="#ff4444" emissive="#ff4444" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[COMPASS_RADIUS, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[CONE_RADIUS, CONE_HEIGHT, 8]} />
        <meshStandardMaterial color="#ff4444" emissive="#ff4444" emissiveIntensity={0.3} />
      </mesh>

      {/* Y axis - green */}
      <mesh position={[0, COMPASS_RADIUS / 2, 0]}>
        <cylinderGeometry args={[ARROW_THICKNESS, ARROW_THICKNESS, COMPASS_RADIUS, 8]} />
        <meshStandardMaterial color="#44ff44" emissive="#44ff44" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, COMPASS_RADIUS, 0]}>
        <coneGeometry args={[CONE_RADIUS, CONE_HEIGHT, 8]} />
        <meshStandardMaterial color="#44ff44" emissive="#44ff44" emissiveIntensity={0.3} />
      </mesh>

      {/* Z axis - blue */}
      <mesh position={[0, 0, COMPASS_RADIUS / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[ARROW_THICKNESS, ARROW_THICKNESS, COMPASS_RADIUS, 8]} />
        <meshStandardMaterial color="#4488ff" emissive="#4488ff" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, 0, COMPASS_RADIUS]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[CONE_RADIUS, CONE_HEIGHT, 8]} />
        <meshStandardMaterial color="#4488ff" emissive="#4488ff" emissiveIntensity={0.3} />
      </mesh>

      {/* Center sphere */}
      <mesh>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.2} />
      </mesh>
    </group>
  )
}

export function Compass3D(): JSX.Element {
  const [labels, setLabels] = useState<LabelPosition[]>([])

  const handleLabelsUpdate = (newLabels: LabelPosition[]) => {
    setLabels((prev) => {
      // Only update if positions actually changed (avoid unnecessary renders)
      if (
        prev.length === newLabels.length &&
        prev.every((p, i) =>
          Math.abs(p.screen.x - newLabels[i].screen.x) < 0.5 &&
          Math.abs(p.screen.y - newLabels[i].screen.y) < 0.5
        )
      ) {
        return prev
      }
      return newLabels
    })
  }

  return (
    <div className="compass-3d">
      <Canvas
        camera={{ position: [0, 0, CAMERA_DISTANCE], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.6} />
        <pointLight position={[5, 5, 5]} intensity={0.8} />
        <CompassScene onLabelsUpdate={handleLabelsUpdate} />
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
