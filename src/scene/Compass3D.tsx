/**
 * Compass3D — 3D compass showing orientation in world space.
 *
 * The compass camera copies the main camera's orientation, so it follows a free
 * orbit rather than only the 90 degree axis snaps. It used to copy `view`, which
 * matched while the world group carried that same rotation, but `view` no longer
 * describes where you are looking.
 *
 * Arrows are drawn along the *cyberspace* axes. The scene's local frame is those
 * axes permuted by `axes` (local x is screen-right, y is up, z is out), so each
 * arrow is placed along whichever local direction its axis currently maps to.
 * Otherwise red would mean "whatever is on the right" rather than X.
 *
 * Text labels project from the rotated arrow tips to screen space.
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Quaternion, Vector3 } from 'three'
import { useCyberspace } from '../store/useCyberspace'
import { cameraPose } from '../lib/cameraPose'
import type { AxisName, ViewAxes } from '../lib/space'

interface LabelPosition {
  axis: 'x' | 'y' | 'z'
  screen: { x: number; y: number }
}

/** The labels, in the order they are drawn. */
const AXES = ['x', 'y', 'z'] as const

const CAMERA_DISTANCE = 5
const ARROW_LENGTH = 1.2
const ARROW_THICKNESS = 0.08
const CONE_RADIUS = ARROW_THICKNESS * 2
const CONE_HEIGHT = 0.3
const LABEL_OFFSET = 0.2

/** Local-frame direction that a cyberspace axis currently points along. */
function localDir(axes: ViewAxes, axis: AxisName): Vector3 {
  const screen = [axes.right, axes.up, axes.out]
  const v = new Vector3()
  const comp: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z']
  for (let i = 0; i < 3; i++) if (screen[i].axis === axis) v[comp[i]] = screen[i].dir
  return v
}

const UP = new Vector3(0, 1, 0)

function Arrow({ dir, color }: { dir: Vector3; color: string }): JSX.Element {
  const q = useMemo(
    () => new Quaternion().setFromUnitVectors(UP, dir.clone().normalize()),
    [dir],
  )
  return (
    <group quaternion={q}>
      <mesh position={[0, ARROW_LENGTH / 2, 0]}>
        <cylinderGeometry args={[ARROW_THICKNESS, ARROW_THICKNESS, ARROW_LENGTH, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, ARROW_LENGTH, 0]}>
        <coneGeometry args={[CONE_RADIUS, CONE_HEIGHT, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>
    </group>
  )
}

type Dirs = Record<'x' | 'y' | 'z', Vector3>

function CompassScene({ onLabelsUpdate, pose, given }: { onLabelsUpdate: (labels: LabelPosition[]) => void; pose: Quaternion; given?: Dirs }): JSX.Element {
  const view = useCyberspace((s) => s.view)
  const axes = useMemo(() => useCyberspace.getState().axes(), [view])
  const { camera, size } = useThree()

  const dirs = useMemo<Dirs>(() => given ?? {
    x: localDir(axes, 'x'),
    y: localDir(axes, 'y'),
    z: localDir(axes, 'z'),
  }, [axes, given])

  useFrame(() => {
    camera.quaternion.copy(pose)
    camera.position.copy(new Vector3(0, 0, CAMERA_DISTANCE).applyQuaternion(pose))

    const labels: LabelPosition[] = (['x', 'y', 'z'] as const).map((axis) => {
      const world = dirs[axis].clone().multiplyScalar(ARROW_LENGTH + LABEL_OFFSET)
      const projected = world.project(camera)
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
      <Arrow dir={dirs.x} color="#ff4444" />
      <Arrow dir={dirs.y} color="#44ff44" />
      <Arrow dir={dirs.z} color="#4488ff" />
      <mesh>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.2} />
      </mesh>
    </group>
  )
}

/**
 * By default the main camera's pose and the cyberspace axes. The workshop
 * passes the bench camera's pose and its own axis directions, and `bench`
 * takes the compass out of its fixed spot so the corner can hold it.
 */
export function Compass3D({ onTap, pose = cameraPose, dirs, bench = false }: { onTap?: () => void; pose?: Quaternion; dirs?: Dirs; bench?: boolean } = {}): JSX.Element {
  // The labels follow the arrows every frame the camera turns, so they are
  // moved by hand rather than through state: as state, every frame of an
  // orbit re-rendered this component and, through its Canvas, the whole
  // compass scene (arkinox, 2026-10-20: the laptop "still isn't great";
  // React commits counted during a drag). State changes once, when the first
  // positions arrive, which is when the labels first appear, as before. Only
  // these writes place the spans: React renders them with no position of its
  // own, so a render can never put back an older one.
  const placed = useRef<LabelPosition[]>([])
  const spans = useRef<Partial<Record<LabelPosition['axis'], HTMLSpanElement | null>>>({})
  const [shown, setShown] = useState(false)

  /** Puts one label where the arrows last were, if its span is there. */
  const place = useCallback((axis: LabelPosition['axis']): void => {
    const span = spans.current[axis]
    const at = placed.current.find((l) => l.axis === axis)
    if (!span || !at) return
    span.style.left = `${at.screen.x}px`
    span.style.top = `${at.screen.y}px`
  }, [])
  // A span placed as it arrives: positions that came in between the render
  // and its arrival are not lost.
  const attach = useMemo(() => {
    const one = (axis: LabelPosition['axis']) => (span: HTMLSpanElement | null): void => {
      spans.current[axis] = span
      place(axis)
    }
    return { x: one('x'), y: one('y'), z: one('z') }
  }, [place])

  const handleLabelsUpdate = useCallback((newLabels: LabelPosition[]) => {
    const prev = placed.current
    if (
      prev.length === newLabels.length &&
      prev.every((p, i) =>
        Math.abs(p.screen.x - newLabels[i].screen.x) < 0.5 &&
        Math.abs(p.screen.y - newLabels[i].screen.y) < 0.5
      )
    ) {
      return
    }
    placed.current = newLabels
    if (prev.length === 0) {
      setShown(true)
      return
    }
    for (const { axis } of newLabels) place(axis)
  }, [place])

  return (
    <div
      className={`compass-3d${onTap ? ' compass-3d--tappable' : ''}${bench ? ' compass-3d--bench' : ''}`}
      onPointerDown={onTap ? (e) => { e.preventDefault(); e.stopPropagation(); onTap() } : undefined}
      role={onTap ? 'button' : undefined}
      aria-label={onTap ? 'View controls' : undefined}
    >
      <Canvas
        camera={{ position: [0, 0, CAMERA_DISTANCE], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.6} />
        <pointLight position={[5, 5, 5]} intensity={0.8} />
        <CompassScene onLabelsUpdate={handleLabelsUpdate} pose={pose} given={dirs} />
      </Canvas>
      {shown && AXES.map((axis) => (
        <span key={axis} ref={attach[axis]} className={`compass-label compass-label--${axis}`}>
          {axis.toUpperCase()}
        </span>
      ))}
    </div>
  )
}
