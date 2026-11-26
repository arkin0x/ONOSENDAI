/**
 * LevelRing.tsx: the ring of level bars round a hidden sound's box in the
 * world, that moves while it plays (owner, 2026-11-26: "the audio look is
 * amazing from the hidden message looks. lets replace audio with this",
 * direction 7, Voice line).
 *
 * LEVEL_BARS short bars stand round the box, turned to face the camera, just
 * outside the box's outline from any side. Quiet, they rest short and dim;
 * while the sound plays, from its card or where it is hidden, they rise and
 * fall at their own speeds and light up. With reduced motion they stand
 * still, raised while it plays. One instanced mesh per sound, its bars'
 * matrices rewritten only while they move.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3, type Group, type PerspectiveCamera } from 'three'
import { hash01 } from '../lib/decode'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { cardKey, useHiddenAudio, worldKey } from '../store/useHiddenAudio'
import { useCyberspace } from '../store/useCyberspace'
import { LABEL_PRIORITY } from './WorldLabel'
import { placedBoxSide } from './WorldMessages'

/** How many bars stand round the box. */
export const LEVEL_BARS = 32
/** Where a bar starts, from the box's centre, in the box's own units (its edge is 1): past its outline seen from any side (half its diagonal, 0.87). */
export const LEVEL_INNER = 0.98
/** A bar's width, and its length at rest and at its loudest, in the box's units. */
const BAR_W = 0.05
export const LEVEL_REST = 0.07
export const LEVEL_MAX = 0.42
/** Quiet, the bars are the box's blue, dim; playing, the HUD's cyan. */
const QUIET = '#4aa3ff'
const PLAYING = '#00e5ff'

/** A bar's length `t` seconds into playing: its own two speeds, so the ring never moves in step. */
export function barLevel(i: number, t: number): number {
  const a = 0.5 + 0.5 * Math.sin(t * (5 + 7 * hash01(i, 91)) + hash01(i, 17) * 6.283)
  const b = 0.6 + 0.4 * Math.sin(t * 1.3 + i * 0.45)
  return LEVEL_REST + (LEVEL_MAX - LEVEL_REST) * a * b
}

/** A bar's length when still: at rest, or raised half way while it plays (reduced motion). */
export function stillLevel(playing: boolean): number {
  return playing ? (LEVEL_REST + LEVEL_MAX) / 2 : LEVEL_REST
}

const BAR = new PlaneGeometry(1, 1)

/** Whether a sound is playing now, from its card or where it is hidden. */
function usePlaying(id: string | undefined): boolean {
  return useHiddenAudio((s) => !!id && (s.entries[worldKey(id)]?.phase === 'playing' || s.entries[cardKey(id)]?.phase === 'playing'))
}

export function LevelRing({ id, at, opacity = 1 }: { id?: string; at: [number, number, number]; opacity?: number }): JSX.Element {
  const playing = usePlaying(id)
  const reduced = useReducedMotion()
  const group = useRef<Group>(null)
  const bars = useRef<InstancedMesh>(null)
  const material = useMemo(() => new MeshBasicMaterial({ color: QUIET, toneMapped: false, transparent: true, opacity: 0.55 * opacity, depthWrite: false }), [opacity])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => {
    material.color = new Color(playing ? PLAYING : QUIET)
    material.opacity = (playing ? 0.95 : 0.55) * opacity
  }, [material, playing, opacity])

  const scratch = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), p: new Vector3(), s: new Vector3(), z: new Vector3(0, 0, 1) }), [])
  /** Lay every bar at `level(i)`. */
  const lay = (level: (i: number) => number): void => {
    const mesh = bars.current
    // A test's stand-in renderer mounts plain records, not three's objects.
    if (!mesh || typeof mesh.setMatrixAt !== 'function') return
    const { m, q, p, s, z } = scratch
    for (let i = 0; i < LEVEL_BARS; i++) {
      const a = (i / LEVEL_BARS) * Math.PI * 2
      const len = level(i)
      q.setFromAxisAngle(z, a - Math.PI / 2)
      p.set(Math.cos(a) * (LEVEL_INNER + len / 2), Math.sin(a) * (LEVEL_INNER + len / 2), 0)
      s.set(BAR_W, len, 1)
      m.compose(p, q, s)
      mesh.setMatrixAt(i, m)
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  // Still: laid before its first frame is drawn, and again when it starts or stops.
  const moving = playing && !reduced
  useLayoutEffect(() => { if (!moving) lay(() => stillLevel(playing)) })

  const started = useRef(0)
  useEffect(() => { started.current = performance.now() }, [moving])
  useFrame((state) => {
    const g = group.current
    if (!g) return
    const cam = state.camera as PerspectiveCamera
    g.quaternion.copy(cam.quaternion)
    g.position.set(at[0], at[1], at[2])
    g.scale.setScalar(placedBoxSide(useCyberspace.getState().scaleExp))
    if (!moving) return
    const t = (performance.now() - started.current) / 1000
    lay((i) => barLevel(i, t))
  }, LABEL_PRIORITY)

  return (
    <group ref={group} position={at} name="level-ring">
      <instancedMesh ref={bars} args={[BAR, material, LEVEL_BARS]} frustumCulled={false} />
    </group>
  )
}
