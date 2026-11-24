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
 *
 * It draws a frame only when something it shows has changed: the pose, the
 * axes or its size. The camera rests far more than it turns, and a frame the
 * same as the last was a render, a context switch in the GPU process and a
 * composite spent on nothing, every display refresh, on a canvas of its own
 * (arkinox, 2026-10-20: /tv and the main view chug on his Windows laptop; the
 * compass is not shown on /tv, so this is the main view's and the
 * workshop's part). A canvas nobody draws to keeps showing its last frame.
 *
 * Out of the way (a placement lined up, the phone's menu open), it is hidden,
 * never unmounted: each mount is a WebGL context of its own, made and its
 * shaders compiled again, and BUILD unmounted it at every hide and every move,
 * a new context each time (2026-11-18, memory over a long session of kit
 * imports and BUILD: 63 contexts made in 15 minutes for one compass).
 *
 * The black sun rides on it (arkinox, 2026-11-24: "Can we add the black sun to
 * the 3d compass? that would help"). The sun is the direction +Z_cs and has no
 * place (scene/BlackSun.tsx), so the bearing to it is the same from anywhere:
 * it is drawn on the Z arrow, a dark disc in a violet ring that the arrowhead
 * points into. Turned away from you, it lies past the centre of the ball, and
 * is drawn dimmed through whatever is in front of it rather than hidden. The
 * workshop leaves it off: the bench is a shard's own frame, which a placed
 * shard can be turned out of, so a sun there would say something false.
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DoubleSide, Quaternion, Vector3, type Group, type MeshBasicMaterial } from 'three'
import { useCyberspace } from '../store/useCyberspace'
import { cameraPose } from '../lib/cameraPose'
import { BLACK_SUN } from '../lib/palette'
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

/**
 * The black sun on the Z arrow, in the compass's units.
 *
 * Centred a little short of the arrowhead so the ring goes round it: the cone
 * runs 1.05 to 1.35 and the ring 0.8 to 1.4, so the arrow points into the
 * sun. The disc and its rings stand SUN_BACK behind that point, away from the
 * eye, so the arrowhead is drawn over the dark disc rather than under it.
 * The Z label moves out past the halo to make room.
 */
const SUN_AT = 1.1
const SUN_BACK = 0.3
const SUN_DISC = 0.24
const SUN_RING: [number, number] = [0.24, 0.3]
const SUN_HALO: [number, number] = [0.3, 0.4]
const SUN_Z_LABEL = 1.58
/** Opacities [disc, ring, halo]: facing you, and turned away past the centre. */
const SUN_NEAR = [0.85, 1, 0.34] as const
const SUN_FAR = [0.55, 0.7, 0.2] as const
/** The disc's colour: the unlit space a black sun is. */
const SUN_DARK = '#06030c'

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

const INVERSE = new Quaternion()

/**
 * Where the black sun lies as the compass camera sees it: `sunDir` (the +Z
 * arrow's direction) turned into the camera's own frame and written to `out`.
 * +x is screen right, +y screen up, +z out of the screen toward you; so a sun
 * ahead of you, the way the canonical view faces, comes out at -z. No
 * allocation: it is called on every frame the compass draws.
 */
export function sunInView(sunDir: Vector3, pose: Quaternion, out: Vector3): Vector3 {
  INVERSE.copy(pose).invert()
  return out.copy(sunDir).applyQuaternion(INVERSE)
}

/**
 * How near the sun's side of the ball is, 0 to 1: 1 when it points out of the
 * screen at you, 0 when it points into it, past the centre. Eased over a band
 * either side of edge-on so the dimming never pops as you orbit.
 */
export function sunNearness(inView: Vector3): number {
  const t = Math.min(1, Math.max(0, (inView.z + 0.25) / 0.5))
  return t * t * (3 - 2 * t)
}

export type SunBearing = 'ahead' | 'behind' | 'left' | 'right' | 'up' | 'down'

/** The plain word for where the sun is from where you look: its largest component. */
export function sunBearing(inView: Vector3): SunBearing {
  const ax = Math.abs(inView.x), ay = Math.abs(inView.y), az = Math.abs(inView.z)
  if (az >= ax && az >= ay) return inView.z < 0 ? 'ahead' : 'behind'
  if (ax >= ay) return inView.x < 0 ? 'left' : 'right'
  return inView.y < 0 ? 'down' : 'up'
}

/** What a screen reader hears for each bearing. */
export const SUN_WORDS: Record<SunBearing, string> = {
  ahead: 'Black sun ahead',
  behind: 'Black sun behind you',
  left: 'Black sun to your left',
  right: 'Black sun to your right',
  up: 'Black sun above',
  down: 'Black sun below',
}

const SUN_SEEN = new Vector3()

/** The sun's meshes, written to on the frames the compass draws. */
interface SunParts {
  group: Group | null
  disc: MeshBasicMaterial | null
  ring: MeshBasicMaterial | null
  halo: MeshBasicMaterial | null
}

/**
 * Turns the sun to face the compass camera and dims it by how far round the
 * ball it is. Turned away, the rings draw through what is in front of them,
 * so the sun is never lost behind the centre; the disc stays depth tested,
 * so the centre still reads as in front of it. Returns the bearing.
 */
function placeSun(parts: SunParts, sunDir: Vector3, pose: Quaternion): SunBearing {
  const seen = sunInView(sunDir, pose, SUN_SEEN)
  const near = sunNearness(seen)
  if (parts.group) parts.group.quaternion.copy(pose)
  const mats = [parts.disc, parts.ring, parts.halo]
  for (let i = 0; i < 3; i++) {
    const m = mats[i]
    if (!m) continue
    m.opacity = SUN_FAR[i] + (SUN_NEAR[i] - SUN_FAR[i]) * near
    if (i > 0) m.depthTest = seen.z >= 0
  }
  return sunBearing(seen)
}

/** What the compass's last frame was drawn from. */
export interface Drawn {
  pose: [number, number, number, number]
  dirs: Dirs | null
  /** CSS pixels, which place the labels. */
  size: [number, number]
  /** The drawing buffer, which a resize clears. */
  buffer: [number, number]
  /** The labels are to be placed once more, from the camera as last drawn. */
  labelsDue: boolean
}

/** Nothing drawn yet: the first frame is always drawn. */
export function nothingDrawn(): Drawn {
  return { pose: [NaN, NaN, NaN, NaN], dirs: null, size: [0, 0], buffer: [0, 0], labelsDue: false }
}

/**
 * What this pass of the loop does, `drawn` brought up to date: 'draw' a frame
 * and place the labels, when a frame from these inputs would differ from the
 * last one drawn; 'labels' alone, in the pass after a drawn frame; otherwise
 * nothing. The pose is compared exactly, so a frame is skipped only when it
 * would be the same frame. The directions are compared by identity: they are
 * rebuilt whenever the view's axes change, and the workshop's are constant.
 *
 * The labels are projected through the camera as three last drew it (it
 * brings the camera's matrices up to date in render), so a frame behind the
 * arrows. Drawn every frame, as it was, the next frame put them right; the
 * pass after a drawn frame does that now, so they land where they always did.
 */
export function compassStep(drawn: Drawn, pose: Quaternion, dirs: Dirs, width: number, height: number, bufferWidth: number, bufferHeight: number): 'draw' | 'labels' | null {
  const p = drawn.pose
  if (
    p[0] === pose.x && p[1] === pose.y && p[2] === pose.z && p[3] === pose.w &&
    drawn.dirs === dirs &&
    drawn.size[0] === width && drawn.size[1] === height &&
    drawn.buffer[0] === bufferWidth && drawn.buffer[1] === bufferHeight
  ) {
    if (!drawn.labelsDue) return null
    drawn.labelsDue = false
    return 'labels'
  }
  p[0] = pose.x; p[1] = pose.y; p[2] = pose.z; p[3] = pose.w
  drawn.dirs = dirs
  drawn.size[0] = width; drawn.size[1] = height
  drawn.buffer[0] = bufferWidth; drawn.buffer[1] = bufferHeight
  drawn.labelsDue = true
  return 'draw'
}

function CompassScene({ onLabelsUpdate, onSun, pose, given, sun }: { onLabelsUpdate: (labels: LabelPosition[]) => void; onSun: (bearing: SunBearing) => void; pose: Quaternion; given?: Dirs; sun: boolean }): JSX.Element {
  const view = useCyberspace((s) => s.view)
  const axes = useMemo(() => useCyberspace.getState().axes(), [view])
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)

  const dirs = useMemo<Dirs>(() => given ?? {
    x: localDir(axes, 'x'),
    y: localDir(axes, 'y'),
    z: localDir(axes, 'z'),
  }, [axes, given])

  const drawn = useRef(nothingDrawn())
  const sunParts = useRef<SunParts>({ group: null, disc: null, ring: null, halo: null })
  // The sun stands on the Z arrow, so it moves with the axes.
  const sunAt = useMemo(() => dirs.z.clone().multiplyScalar(SUN_AT), [dirs])
  // A restored context starts blank: draw again.
  useEffect(() => {
    const canvas = gl.domElement
    const again = (): void => { drawn.current = nothingDrawn() }
    canvas.addEventListener('webglcontextrestored', again)
    return () => canvas.removeEventListener('webglcontextrestored', again)
  }, [gl])

  // Priority 1 takes the drawing from R3F, so a frame is drawn here or not at
  // all. The pose is read at the same point in the loop as before, so a turn
  // shows on the compass in the same frame as it did.
  useFrame(({ scene }) => {
    const canvas = gl.domElement
    const step = compassStep(drawn.current, pose, dirs, size.width, size.height, canvas.width, canvas.height)
    if (!step) return
    if (step === 'draw') {
      camera.quaternion.copy(pose)
      camera.position.copy(new Vector3(0, 0, CAMERA_DISTANCE).applyQuaternion(pose))
      if (sun) onSun(placeSun(sunParts.current, dirs.z, pose))
    }

    const labels: LabelPosition[] = (['x', 'y', 'z'] as const).map((axis) => {
      const world = dirs[axis].clone().multiplyScalar(sun && axis === 'z' ? SUN_Z_LABEL : ARROW_LENGTH + LABEL_OFFSET)
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
    if (step === 'draw') gl.render(scene, camera)
  }, 1)

  return (
    <group>
      <Arrow dir={dirs.x} color="#ff4444" />
      <Arrow dir={dirs.y} color="#44ff44" />
      <Arrow dir={dirs.z} color="#4488ff" />
      <mesh>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.2} />
      </mesh>
      {sun && (
        <group position={sunAt} ref={(g) => { sunParts.current.group = g }}>
          {/* Unlit and untone-mapped, so the violet is the scene sun's own. */}
          <group position={[0, 0, -SUN_BACK]}>
            <mesh renderOrder={1}>
              <circleGeometry args={[SUN_DISC, 32]} />
              <meshBasicMaterial ref={(m) => { sunParts.current.disc = m }} color={SUN_DARK} transparent opacity={SUN_NEAR[0]} depthWrite={false} toneMapped={false} side={DoubleSide} />
            </mesh>
            <mesh renderOrder={2}>
              <ringGeometry args={[SUN_HALO[0], SUN_HALO[1], 48]} />
              <meshBasicMaterial ref={(m) => { sunParts.current.halo = m }} color={BLACK_SUN} transparent opacity={SUN_NEAR[2]} depthWrite={false} toneMapped={false} side={DoubleSide} />
            </mesh>
            <mesh renderOrder={3}>
              <ringGeometry args={[SUN_RING[0], SUN_RING[1], 48]} />
              <meshBasicMaterial ref={(m) => { sunParts.current.ring = m }} color={BLACK_SUN} transparent opacity={SUN_NEAR[1]} depthWrite={false} toneMapped={false} side={DoubleSide} />
            </mesh>
          </group>
        </group>
      )}
    </group>
  )
}

/**
 * By default the main camera's pose and the cyberspace axes. The workshop
 * passes the bench camera's pose and its own axis directions, and `bench`
 * takes the compass out of its fixed spot so the corner can hold it. `sun`
 * draws the black sun on the Z arrow: on by default, which is every mode that
 * shows the cyberspace axes, and off on the bench, where Z is not +Z_cs.
 */
export function Compass3D({ onTap, pose = cameraPose, dirs, bench = false, hidden = false, sun = !bench }: { onTap?: () => void; pose?: Quaternion; dirs?: Dirs; bench?: boolean; hidden?: boolean; sun?: boolean } = {}): JSX.Element {
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
  // Where the sun is, in words, for the button's label. Written to the
  // element by hand like the labels, and only when the word changes, so an
  // orbit neither re-renders the compass nor chatters at a screen reader.
  const root = useRef<HTMLDivElement>(null)
  const sunSaid = useRef<SunBearing | null>(null)
  const tappable = !!onTap && !hidden
  const say = useCallback((bearing: SunBearing | null): void => {
    const el = root.current
    if (!el || !tappable) return
    el.setAttribute('aria-label', bearing ? `View controls. ${SUN_WORDS[bearing]}.` : 'View controls')
  }, [tappable])
  const handleSun = useCallback((bearing: SunBearing): void => {
    if (sunSaid.current === bearing) return
    sunSaid.current = bearing
    say(bearing)
  }, [say])
  // A render puts the static label back; put the bearing over it again.
  useEffect(() => { say(sun ? sunSaid.current : null) })

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
      ref={root}
      className={`compass-3d${onTap ? ' compass-3d--tappable' : ''}${bench ? ' compass-3d--bench' : ''}${hidden ? ' compass-3d--hidden' : ''}`}
      onPointerDown={onTap && !hidden ? (e) => { e.preventDefault(); e.stopPropagation(); onTap() } : undefined}
      role={onTap && !hidden ? 'button' : undefined}
      aria-label={onTap && !hidden ? 'View controls' : undefined}
      aria-hidden={hidden || undefined}
    >
      <Canvas
        frameloop={hidden ? 'never' : 'always'}
        camera={{ position: [0, 0, CAMERA_DISTANCE], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.6} />
        <pointLight position={[5, 5, 5]} intensity={0.8} />
        <CompassScene onLabelsUpdate={handleLabelsUpdate} onSun={handleSun} pose={pose} given={dirs} sun={sun} />
      </Canvas>
      {shown && AXES.map((axis) => (
        <span key={axis} ref={attach[axis]} className={`compass-label compass-label--${axis}`}>
          {axis.toUpperCase()}
        </span>
      ))}
    </div>
  )
}
