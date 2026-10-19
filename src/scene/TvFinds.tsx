/**
 * TvFinds.tsx: what Cyberspace TV's own scan opened, drawn where it lies
 * (lib/tv/scan.ts, store/useTv.ts found).
 *
 * Only what TV opened at the places its avatars stood on this tape, never
 * what you found anywhere else, so TV is the same picture for everyone who
 * watches (arkinox, 2026-10-19). Only shards, keys and chests, which the
 * scan alone lets through, and only once the tape is at or past the moment
 * each one's bag was signed, so a MEANWHILE that goes back hides it again.
 * Drawn as the world draws them (WorldShards' PlacedShard, WorldMessages'
 * ItemMark), in the same render frame as TV's avatars, with nothing to tap.
 *
 * The avatars are the brightest thing on screen: a find rests at REST of
 * its colour, out of the bloom, and one that stands between the camera and
 * the shot's avatar fades to COVERING so the avatar stays readable
 * (arkinox, 2026-10-19: "fade it"). Whether it stands there is a raycast
 * from the camera to the avatar's middle and four points around it, so a
 * floor or a room the avatar stands in is not in the way unless it really
 * is (review of #390: a bounding sphere put the whole plaza in the way).
 */

import { useCallback, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AddEquation, Box3, CustomBlending, OneFactor, OneMinusSrcAlphaFactor, Raycaster, Sphere, SrcAlphaFactor, Vector3, ZeroFactor,
  type Camera, type Color, type Group, type Material, type Mesh, type Object3D, type PerspectiveCamera, type Quaternion,
} from 'three'
import { GRID_RADIUS, itemCentre, type ViewAxes } from '../lib/space'
import { drawnAvatars } from '../lib/targets'
import { coversSubject } from '../lib/tv/scan'
import { tvName } from '../lib/tv/text'
import { markShown } from '../lib/worldMarks'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { foundAsOf, useTv } from '../store/useTv'
import { useProfile } from '../hooks/useProfile'
import { PlacedShard, drawableShards } from './WorldShards'
import { ItemMark, itemMarkText } from './WorldMessages'

const REACH = GRID_RADIUS * 8
/** A find at rest: this much of its own brightness, below the avatars'. */
export const REST = 0.6
/** A find in the way of the shot's avatar. */
export const COVERING = 0.12
/** How quickly a find fades out of the way and back, seconds. */
const FADE_TAU = 0.25
/** After TV's camera (0.5), before the labels (0.9) and the composer (1): this frame's camera. */
const FINDS_PRIORITY = 0.7
/** A mark's size on screen, CSS px (WorldMessages MARK_PX note), and a little over, for its label. */
const MARK_PX = 34 * 1.2
/** How far round the avatar's middle the four outer rays aim, as a share of its radius. */
const RIM = 0.7

/**
 * Blending that draws a find over what is behind it at its opacity, and
 * leaves the alpha already there: over the empty background that is 0, the
 * tag the bloom is blind to (Scene.tsx WorldBloom), so a find never glows
 * brighter than the avatars, however translucent.
 */
const OUT_OF_BLOOM = {
  blending: CustomBlending, blendEquation: AddEquation,
  blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor,
  blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor,
} as const

type Lookable = Material & { color?: Color; uniforms?: Record<string, { value: unknown }> }

/** One material at `level` of its brightness: colour scaled to REST where it has one, the rest as opacity. */
function lookOne(m: Lookable, level: number): void {
  const ud = m.userData
  const u = m.uniforms?.uOpacity
  if (ud.tvBase === undefined) {
    ud.tvBase = u ? (u.value as number) : m.opacity
    if (m.color) { ud.tvColor = m.color.clone(); m.color.multiplyScalar(REST) }
    Object.assign(m, OUT_OF_BLOOM)
    m.transparent = true
    m.needsUpdate = true
  }
  const base = ud.tvBase as number
  if (u) u.value = base * level
  else m.opacity = base * (m.color ? level / REST : level)
}

/** Everything drawn under `obj` at `level`. Hoisted per call through `levelNow`, so a frame allocates nothing. */
let levelNow = REST
function lookObj(obj: Object3D): void {
  const m = (obj as { material?: Lookable | Lookable[] }).material
  if (!m) return
  if (Array.isArray(m)) for (const one of m) lookOne(one, levelNow)
  else lookOne(m, levelNow)
}
function look(obj: Object3D, level: number): void {
  levelNow = level
  obj.traverse(lookObj)
}

// The shot's avatar and the rays to it, worked out once a frame.
const box = new Box3()
const subject = new Sphere()
const eyeAt = new Vector3()
const right = new Vector3()
const up = new Vector3()
const aimAt = new Vector3()
const rays = Array.from({ length: 5 }, () => new Vector3())
const raycaster = new Raycaster()
const eye = [0, 0, 0]
const subjectAt = [0, 0, 0]
const thingAt = [0, 0, 0]
/** How far a ray may hit and still be in front of the avatar: its distance less its radius. */
let rayFar = 0

/** Measure the shot's avatar and aim the rays; false when the shot has none on screen. */
function aim(camera: Camera): boolean {
  const shot = useTv.getState().shot
  const drawn = shot?.kind === 'trip' ? drawnAvatars[shot.pubkey] : undefined
  if (!drawn) return false
  box.setFromObject(drawn)
  if (box.isEmpty()) return false
  box.getBoundingSphere(subject)
  camera.getWorldPosition(eyeAt)
  return aimRays(eyeAt, subject, camera.quaternion)
}

/**
 * Aim the five rays from the camera at `eyePos` to the avatar `body`: its
 * middle and four points round it, across the view. False when the camera
 * is inside it. Apart from `aim` for tests.
 */
export function aimRays(eyePos: Vector3, body: Sphere, turn: Quaternion): boolean {
  if (eyePos !== eyeAt) eyeAt.copy(eyePos)
  if (body !== subject) subject.copy(body)
  const ds = eyeAt.distanceTo(subject.center)
  if (ds <= subject.radius) return false
  rayFar = ds - subject.radius
  right.set(1, 0, 0).applyQuaternion(turn)
  up.set(0, 1, 0).applyQuaternion(turn)
  const r = subject.radius * RIM
  const offsets: Array<[number, number]> = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]
  offsets.forEach(([a, b], i) => {
    aimAt.copy(subject.center).addScaledVector(right, a * r).addScaledVector(up, b * r)
    rays[i].copy(aimAt).sub(eyeAt).normalize()
  })
  eye[0] = eyeAt.x; eye[1] = eyeAt.y; eye[2] = eyeAt.z
  subjectAt[0] = subject.center.x; subjectAt[1] = subject.center.y; subjectAt[2] = subject.center.z
  return true
}

const meshes: Mesh[] = []
function collectMesh(o: Object3D): void { if ((o as Mesh).isMesh && o.visible) meshes.push(o as Mesh) }

/** Whether any of the rays meets a face of this shard before the avatar. */
export function shardInTheWay(drawn: Object3D): boolean {
  meshes.length = 0
  drawn.traverse(collectMesh)
  if (meshes.length === 0) return false
  for (const dir of rays) {
    raycaster.set(eyeAt, dir)
    raycaster.far = rayFar
    if (raycaster.intersectObjects(meshes, false).length > 0) return true
  }
  return false
}

/** Whether a mark, a fixed size on screen, stands between the camera and the shot's avatar. */
function markInTheWay(mark: Object3D, camera: PerspectiveCamera, height: number): boolean {
  mark.getWorldPosition(aimAt)
  thingAt[0] = aimAt.x; thingAt[1] = aimAt.y; thingAt[2] = aimAt.z
  const perPixel = 2 * Math.tan((camera.fov * Math.PI) / 360) / height
  const r = aimAt.distanceTo(eyeAt) * perPixel * MARK_PX / 2
  return coversSubject(eye, subjectAt, subject.radius, thingAt, r)
}

interface Drawn { group: Group; level: number; mark: boolean }

/** A key or a chest TV opened: its mark, named as TV names people. */
function TvMark({ text, author, at, register }: { text: string; author: string; at: [number, number, number]; register: (g: Group | null) => void }): JSX.Element {
  const profile = useProfile(author)
  return (
    <group ref={register}>
      <group position={at} />
      <ItemMark text={text} sub={tvName(author, profile?.name)} at={at} />
    </group>
  )
}

export function TvFinds({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const found = useTv((s) => s.found)
  const tapeTime = useTv((s) => s.tapeTime)
  const anchor = useCyberspace((s) => s.anchor)
  const plane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  // As of the moment on screen (review of #390): found only grows, the tape does not.
  const shown = useMemo(() => foundAsOf(found, tapeTime), [found, tapeTime])

  const shards = useMemo(() => drawableShards(
    shown.map(({ item: h }) => ({ key: h.eventId, type: h.type, at: h.at, height: h.height, plane: h.plane, shard: h.shard })),
    anchor, plane, scaleExp, axes,
  ), [shown, anchor, plane, scaleExp, axes])

  // Keys and chests at the zoom the world draws them at, and no further
  // out (lib/worldMarks markShown, as WorldMessages draws them).
  const marks = useMemo(() => {
    if (!markShown('note', scaleExp)) return []
    const origin = alignedOrigin(anchor, scaleExp)
    return shown
      .filter(({ item: h }) => (h.type === 'key' || h.type === 'chest') && h.plane === plane)
      .map(({ item: h }) => ({ key: h.eventId, text: itemMarkText({ type: h.type, keyItem: h.key, chest: h.chest }), author: h.author, centre: itemCentre(h.at, origin, scaleExp, axes) }))
      .filter((m) => Math.hypot(...m.centre) <= REACH)
  }, [shown, anchor, plane, scaleExp, axes])

  const drawn = useRef(new Map<string, Drawn>())
  const registers = useRef(new Map<string, (g: Group | null) => void>())
  const register = useCallback((key: string, mark: boolean) => {
    let fn = registers.current.get(key)
    if (!fn) {
      fn = (g: Group | null) => {
        if (g) drawn.current.set(key, { group: g, level: REST, mark })
        else drawn.current.delete(key)
      }
      registers.current.set(key, fn)
    }
    return fn
  }, [])

  useFrame((state, dt) => {
    if (drawn.current.size === 0) return
    const aimed = aim(state.camera)
    const k = 1 - Math.exp(-dt / FADE_TAU)
    let covering = 0
    for (const d of drawn.current.values()) {
      const inTheWay = aimed && (d.mark ? markInTheWay(d.group.children[0], state.camera as PerspectiveCamera, state.size.height) : shardInTheWay(d.group))
      if (inTheWay) covering++
      d.level += ((inTheWay ? COVERING : REST) - d.level) * k
      look(d.group, d.level)
    }
    if (import.meta.env.DEV) (window as unknown as { __tvFade?: unknown }).__tvFade = { drawn: drawn.current.size, covering, aimed }
  }, FINDS_PRIORITY)

  if (shards.length === 0 && marks.length === 0) return null
  return (
    <>
      {shards.map((w) => <PlacedShard key={w.key} w={w} birth={found[w.key]?.birth} tappable={false} drawnRef={register(w.key, false)} />)}
      {marks.map((m) => <TvMark key={m.key} text={m.text} author={m.author} at={m.centre} register={register(m.key, true)} />)}
    </>
  )
}
