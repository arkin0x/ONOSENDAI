/**
 * SoundMark.tsx: a hidden sound in the world, drawn under the one rulebook
 * every hidden thing shares (lib/hiddenLook.ts; owner ruling, 2026-11-27,
 * option A of the hidden-item cohesion page, with option C's layer slices
 * for its body: "I don't want a cube mesh around the layer slices, just the
 * layer slices, like option C").
 *
 * Its body is a stack of SLICES thin discs, thin at the ends and full in the
 * middle, in the shared face with every hard edge outlined OUTLINE_PX wide at
 * any distance. Quiet, the slices breathe with the shared idle wave; while
 * the sound plays, from its card or where it is hidden, they swell with it.
 * Round it, facing the camera, the halo of LEVEL_LINES level lines every sound
 * has worn since the hidden-message looks (owner, 2026-11-26: "the audio look
 * is amazing from the hidden message looks"): quiet they ride the idle wave,
 * playing they dance and brighten to full. A sound found and not yet opened
 * sends a pulse out of its ring every PULSE_S. It bobs with the shared bob.
 * With reduced motion nothing moves: the slices and lines stand still, raised
 * while it plays, and NEW is a faint still ring.
 *
 * One gibson across, as a letter is, and it rests over its place (SOUND_LIFT,
 * lib/restLift.ts) so a floor at its level never cuts it. Drawing only: what
 * plays and how loud is HiddenAudio's.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, CylinderGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3, type Group, type Mesh } from 'three'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { seedOf } from '../lib/decode'
import { BOB, LEVEL_LINES, LEVEL_LINE_W, RING_COLOUR, RING_RADIUS, RING_REACH, SLICES, SLICES_LOW, SLICE_MAX_R, SLICE_T, bobAt, hiddenLook, labelShape, levelLength, pulseAt, ringTurnAt, sliceRadius, sliceY, waveAt, wavePhaseAt, type HiddenState } from '../lib/hiddenLook'
import { restLift } from '../lib/restLift'
import { cardKey, useHiddenAudio, worldKey } from '../store/useHiddenAudio'
import { drawSegments, faceMaterial, liveOutlineGeometry, liveOutlineLines, outlineMaterial, PULSE_GEOMETRY, pulseMaterial, segmentPositions, setFaceOpacity, sizeOutline } from './hiddenParts'
import { LABEL_PRIORITY } from './WorldLabel'

/** How many sides each slice is drawn with, and its outline's segments per rim. */
const SLICE_SIDES = 32

/** How far over its place a sound one gibson across is drawn: its lowest slice at the bottom of its bob stands REST_HOVER over its place's level. */
export const SOUND_LIFT = restLift(SLICES_LOW, BOB)

/** The shape its name stands clear of, for a sound 1 across (WorldLabel `clear` shape): the shared ring reach, and the stack inside it. */
export const SOUND_SHAPE = labelShape(SLICE_MAX_R, SLICES_LOW + BOB)

const SLICE_GEOMETRY = new CylinderGeometry(1, 1, SLICE_T, SLICE_SIDES)
const BAR_GEOMETRY = new PlaneGeometry(1, 1)

/** A unit circle's points, for the slices' rims. */
const CIRCLE = Array.from({ length: SLICE_SIDES + 1 }, (_, i) => [Math.cos((i / SLICE_SIDES) * Math.PI * 2), Math.sin((i / SLICE_SIDES) * Math.PI * 2)] as const)
/** Segments of outline: two rims a slice. */
const RIM_SEGMENTS = SLICES * 2 * SLICE_SIDES

/** Whether a sound is playing now, from its card or where it is hidden. */
export function useSoundPlaying(id: string | undefined): boolean {
  return useHiddenAudio((s) => !!id && (s.entries[worldKey(id)]?.phase === 'playing' || s.entries[cardKey(id)]?.phase === 'playing'))
}

export function SoundMark({ id, at, side, state = 'unread', playing, opacity = 1 }: {
  /** What it stands for, for its own phase. */
  id: string
  at: [number, number, number]
  /** One gibson in scene units (noteBoxSide). */
  side: number
  state?: HiddenState
  playing: boolean
  opacity?: number
}): JSX.Element {
  const reduced = useReducedMotion()
  const root = useRef<Group>(null)
  const ring = useRef<Group>(null)
  const slices = useRef<InstancedMesh>(null)
  const bars = useRef<InstancedMesh>(null)
  const pulse = useRef<Mesh>(null)
  const look = hiddenLook(state, { playing })
  const materials = useMemo(() => ({
    face: faceMaterial(opacity),
    line: outlineMaterial({ color: look.outline, opacity }),
    // The bars' colour is set per bar (instance colour), so the wave can brighten each one.
    bar: new MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, opacity: look.ringOpacity * opacity, depthWrite: false }),
    pulse: pulseMaterial(),
  // The outline's colour and the ring's opacity are set every frame from the state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [opacity])
  useEffect(() => () => { for (const m of Object.values(materials)) m.dispose() }, [materials])
  const rims = useMemo(() => liveOutlineGeometry(RIM_SEGMENTS, false), [])
  const rimLines = useMemo(() => {
    const l = liveOutlineLines(rims, materials.line)
    l.name = 'sound-slice-lines'
    return l
  }, [rims, materials])
  useEffect(() => () => rims.dispose(), [rims])
  const phase = useMemo(() => (seedOf(id) / 4294967296) * Math.PI * 2, [id])
  const scratch = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), p: new Vector3(), s: new Vector3(), z: new Vector3(0, 0, 1), c: new Color(), ring: new Color(RING_COLOUR), white: new Color('#ffffff') }), [])
  const started = useRef(performance.now())
  useEffect(() => { started.current = performance.now() }, [playing])
  const laid = useRef<boolean | null>(null)
  const pulseNow = useMemo(() => ({ scale: 0, opacity: 0 }), [])

  useFrame((st) => {
    const g = root.current
    if (!g) return
    const t = st.clock.elapsedTime
    g.position.set(at[0], at[1] + (SOUND_LIFT + bobAt(t, phase, reduced)) * side, at[2])
    g.scale.setScalar(side)
    sizeOutline(materials.line, st.size)
    materials.line.color.set(look.outline)
    materials.line.linewidth = look.outlinePx
    materials.line.opacity = opacity
    setFaceOpacity(materials.face, opacity)
    materials.bar.opacity = look.ringOpacity * opacity
    if (ring.current) ring.current.quaternion.copy(st.camera.quaternion)
    if (pulse.current) {
      pulse.current.visible = look.pulse
      if (look.pulse) {
        const p = pulseAt(t, phase, reduced, pulseNow)
        pulse.current.scale.setScalar(RING_REACH * p.scale)
        materials.pulse.opacity = p.opacity * opacity
      }
    }
    // Held still with reduced motion: laid once, and again only when it starts or stops.
    if (reduced && laid.current === playing) return
    laid.current = playing
    const since = (performance.now() - started.current) / 1000
    const { m, q, p, s, z, c } = scratch
    // The slices and their rims.
    const sm = slices.current
    const pos = segmentPositions(rims)
    let o = 0
    for (let i = 0; i < SLICES; i++) {
      const r = sliceRadius(i, playing ? since : t, playing, reduced)
      const y = sliceY(i)
      if (sm && typeof sm.setMatrixAt === 'function') {
        m.compose(p.set(0, y, 0), q.identity(), s.set(r, 1, r))
        sm.setMatrixAt(i, m)
      }
      for (let face = 0; face < 2; face++) {
        const yy = face === 0 ? y + SLICE_T / 2 : y - SLICE_T / 2
        for (let k = 0; k < SLICE_SIDES; k++) {
          const a = CIRCLE[k], b = CIRCLE[k + 1]
          pos[o++] = a[0] * r; pos[o++] = yy; pos[o++] = a[1] * r
          pos[o++] = b[0] * r; pos[o++] = yy; pos[o++] = b[1] * r
        }
      }
    }
    if (sm?.instanceMatrix) sm.instanceMatrix.needsUpdate = true
    drawSegments(rims, RIM_SEGMENTS)
    // The level lines round it, riding the wave, dancing while it plays.
    const bm = bars.current
    if (!bm || typeof bm.setMatrixAt !== 'function') return
    const turn = ringTurnAt(t, reduced)
    const wph = wavePhaseAt(t, reduced)
    for (let i = 0; i < LEVEL_LINES; i++) {
      const a = (i / LEVEL_LINES) * Math.PI * 2 + turn
      const wave = waveAt(a, wph)
      const len = levelLength(i, since, playing, reduced, wave)
      const mid = RING_RADIUS + len / 2
      q.setFromAxisAngle(z, a - Math.PI / 2)
      m.compose(p.set(Math.cos(a) * mid, Math.sin(a) * mid, 0), q, s.set(LEVEL_LINE_W, len, 1))
      bm.setMatrixAt(i, m)
      const dim = playing ? 0.8 + 0.2 * wave : 0.75 + 0.25 * wave
      bm.setColorAt(i, c.copy(scratch.ring).lerp(scratch.white, playing ? 0.12 : 0).multiplyScalar(dim))
    }
    bm.instanceMatrix.needsUpdate = true
    if (bm.instanceColor) bm.instanceColor.needsUpdate = true
  }, LABEL_PRIORITY)

  return (
    <group ref={root} position={[at[0], at[1] + SOUND_LIFT * side, at[2]]} scale={side} name="sound-mark">
      <instancedMesh ref={slices} args={[SLICE_GEOMETRY, materials.face, SLICES]} frustumCulled={false} name="sound-slices" />
      <primitive object={rimLines} />
      <group ref={ring} name="level-ring">
        <instancedMesh ref={bars} args={[BAR_GEOMETRY, materials.bar, LEVEL_LINES]} frustumCulled={false} name="level-lines" />
        <mesh ref={pulse} geometry={PULSE_GEOMETRY} material={materials.pulse} visible={false} frustumCulled={false} name="sound-pulse" />
      </group>
    </group>
  )
}
