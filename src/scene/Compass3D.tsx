/**
 * Compass3D — 3D compass showing orientation in world space.
 *
 * The axes group rotates by the same quaternion as the main scene's world
 * group, with a fixed camera at [0,0,DIST]. This guarantees the compass
 * always matches the main view exactly — no gimbal lock, no drift.
 *
 * Text labels project from the rotated arrow tips to screen space.
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
const ARROW_LENGTH = 1.2
const ARROW_THICKNESS = 0.08
const CONE_RADIUS = ARROW_THICKNESS * 2
const CONE_HEIGHT = 0.3
const LABEL_OFFSET = 0.2

function CompassScene({ onLabelsUpdate }: { onLabelsUpdate: (labels: LabelPosition[]) => void }): JSX.Element {
  const view = useCyberspace((s) => s.view)
  const currentQuaternion = useRef(new Quaternion())
  const { camera, size } = useThree()

  useFrame(() => {
    // Smoothly interpolate toward target view
    currentQuaternion.current.slerp(view, 0.15)
    
    // Position camera the same way as ViewRig: rotate [0, 0, distance] by the view quaternion
    const cameraPos = new Vector3(0, 0, CAMERA_DISTANCE).applyQuaternion(currentQuaternion.current)
    camera.position.copy(cameraPos)
    camera.quaternion.copy(currentQuaternion.current)

    // Project arrow tip positions to screen space for labels
    const axisTips = [
      { axis: 'x' as const, world: new Vector3(ARROW_LENGTH + LABEL_OFFSET, 0, 0) },
      { axis: 'y' as const, world: new Vector3(0, ARROW_LENGTH + LABEL_OFFSET, 0) },
      { axis: 'z' as const, world: new Vector3(0, 0, ARROW_LENGTH + LABEL_OFFSET) },
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
      {/* X axis - red (cylinder defaults to Y, rotate 90° around Z to point along X) */}
      <mesh position={[ARROW_LENGTH / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[ARROW_THICKNESS, ARROW_THICKNESS, ARROW_LENGTH, 8]} />
        <meshStandardMaterial color="#ff4444" emissive="#ff4444" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[ARROW_LENGTH, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[CONE_RADIUS, CONE_HEIGHT, 8]} />
        <meshStandardMaterial color="#ff4444" emissive="#ff4444" emissiveIntensity={0.3} />
      </mesh>

      {/* Y axis - green (cylinder defaults to Y, no rotation needed) */}
      <mesh position={[0, ARROW_LENGTH / 2, 0]}>
        <cylinderGeometry args={[ARROW_THICKNESS, ARROW_THICKNESS, ARROW_LENGTH, 8]} />
        <meshStandardMaterial color="#44ff44" emissive="#44ff44" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, ARROW_LENGTH, 0]}>
        <coneGeometry args={[CONE_RADIUS, CONE_HEIGHT, 8]} />
        <meshStandardMaterial color="#44ff44" emissive="#44ff44" emissiveIntensity={0.3} />
      </mesh>

      {/* Z axis - blue (cylinder defaults to Y, rotate 90° around X to point along Z) */}
      <mesh position={[0, 0, ARROW_LENGTH / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[ARROW_THICKNESS, ARROW_THICKNESS, ARROW_LENGTH, 8]} />
        <meshStandardMaterial color="#4488ff" emissive="#4488ff" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, 0, ARROW_LENGTH]} rotation={[-Math.PI / 2, 0, 0]}>
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
