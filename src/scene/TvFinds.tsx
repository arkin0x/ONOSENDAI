/**
 * TvFinds.tsx: what Cyberspace TV's own scan opened, drawn where it lies
 * (lib/tv/scan.ts, store/useTv.ts found).
 *
 * Only what TV opened at the places its avatars stood on this tape, never
 * what you found anywhere else, so TV is the same picture for everyone who
 * watches (arkinox, 2026-10-19). Only shards, keys and chests, which the
 * scan alone lets through, a chest drawn shut and never what is inside it,
 * whoever watches (arkinox, 2026-10-20: "chest contents should not be shown
 * on TV"), and only once the tape is at or past the moment
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
import { ItemMark, itemMarkText, type ItemWears } from './WorldMessages'
import { regionBox, type Box } from '../lib/clip'
import { useItemModel } from '../hooks/useItemModel'
import { useMutes } from '../store/useMutes'
import { findHidden } from '../store/useShards'

const REACH = GRID_RADIUS * 8
/** No motion, one array (WorldMessages NO_MOTION). */
const NO_MOTION: ItemWears['animation'] = []
/** A find at rest: this much of its own brightness, below the avatars'. */
export const REST = 0.6

/**
 * Dim a large find further, by how much of the screen it fills (review of
 * #390, round 2): REST up to a quarter of the screen's height, down to 0.4
 * of it when it fills the screen. Prepared and OFF until arkinox rules on
 * it; the probe compares frames with it on and off.
 */
export const COVERAGE_DIM = false

/** A find's resting level when its bounding sphere spans `c` of the screen's height (COVERAGE_DIM). */
export function restingFor(c: number): number {
  return REST * Math.min(1, Math.max(0.4, 1.25 - c))
}
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

/**
 * One material at `level` of its brightness: its colour scaled to its
 * resting level where it has one, the rest as opacity. Faded, it writes no
 * depth, so it never cuts a dark hole in a find behind it (review of #390,
 * round 2); at rest it writes depth as it was made to.
 */
function lookOne(m: Lookable, level: number, rest: number, faded: boolean): void {
  const ud = m.userData
  const u = m.uniforms?.uOpacity
  if (ud.tvBase === undefined) {
    ud.tvBase = u ? (u.value as number) : m.opacity
    if (m.color) ud.tvColor = m.color.clone()
    ud.tvDepth = m.depthWrite
    Object.assign(m, OUT_OF_BLOOM)
    m.transparent = true
    m.needsUpdate = true
  }
  const base = ud.tvBase as number
  if (m.color) m.color.copy(ud.tvColor as Color).multiplyScalar(rest)
  if (u) u.value = base * level
  else m.opacity = base * (m.color ? Math.min(1, level / rest) : level)
  m.depthWrite = faded ? false : ud.tvDepth as boolean
}

// The look of the group being walked, hoisted so a frame allocates nothing.
let levelNow = REST
let restNow = REST
let fadedNow = false
function lookObj(obj: Object3D): void {
  // Faded, it draws after the finds at rest, over them.
  obj.userData.tvOrder ??= obj.renderOrder
  obj.renderOrder = (obj.userData.tvOrder as number) + (fadedNow ? 1 : 0)
  const m = (obj as { material?: Lookable | Lookable[] }).material
  if (!m) return
  if (Array.isArray(m)) for (const one of m) lookOne(one, levelNow, restNow, fadedNow)
  else lookOne(m, levelNow, restNow, fadedNow)
}
/** Everything drawn under `obj` at `level`, resting at `rest`: faded below most of it. */
export function look(obj: Object3D, level: number, rest: number): void {
  levelNow = level
  restNow = rest
  fadedNow = level < rest * 0.95
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

interface Drawn {
  group: Group
  level: number
  mark: boolean
  /** Its resting level: REST, or less for a large one with COVERAGE_DIM on. */
  rest: number
  /** Its bounding sphere, measured every MEASURE_FRAMES frames for COVERAGE_DIM, and when. */
  sphere: Sphere | null
  measured: number
}

/** How often a find's size on screen is measured for COVERAGE_DIM, in frames. */
const MEASURE_FRAMES = 20
let frameNo = 0

/** How much of the screen's height a find's bounding sphere spans, from the camera. */
function coverage(d: Drawn, camera: PerspectiveCamera): number {
  if (!d.sphere || frameNo - d.measured >= MEASURE_FRAMES) {
    box.setFromObject(d.group)
    d.sphere = box.isEmpty() ? null : box.getBoundingSphere(d.sphere ?? new Sphere())
    d.measured = frameNo
  }
  if (!d.sphere) return 0
  const dist = Math.max(1e-6, camera.position.distanceTo(d.sphere.center))
  return d.sphere.radius / (dist * Math.tan((camera.fov * Math.PI) / 360))
}

/** A key or a chest TV opened: its mark, named as TV names people. A key that wears a SNO is drawn as it, as the world draws it (ItemModel). */
function TvMark({ id, text, author, at, wears, region, axes, register }: { id: string; text: string; author: string; at: [number, number, number]; wears?: ItemWears; region: Box | null; axes: ViewAxes; register: (key: string, mark: boolean) => (g: Group | null) => void }): JSX.Element {
  const profile = useProfile(author)
  // A key drawn as its model is as large as the model, not a mark of fixed
  // size: it is measured as a shard is, for the fade and the dim (review of
  // #439). The same fetch ItemMark draws from (useItemModel caches it).
  const model = useItemModel(wears?.model)
  return (
    <group ref={register(id, !model)}>
      <group position={at} />
      <ItemMark id={id} text={text} sub={tvName(author, profile?.name)} at={at} wears={wears} region={region} axes={axes} />
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
  // Nor what a block or a mute made since hides (store/useMutes).
  const muted = useMutes((s) => s.muted)
  const me = useCyberspace((s) => s.identity.pubkey)
  const shown = useMemo(() => foundAsOf(found, tapeTime).filter(({ item }) => !findHidden(item, muted, me)), [found, tapeTime, muted, me])

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
      .map(({ item: h }) => ({
        key: h.eventId,
        text: itemMarkText({ type: h.type, keyItem: h.key, chest: h.chest }),
        author: h.author,
        centre: itemCentre(h.at, origin, scaleExp, axes),
        wears: h.type === 'key' && h.key?.model ? { model: h.key.model, animation: h.key.animation ?? NO_MOTION } : undefined,
        region: h.type === 'key' && h.key?.model ? regionBox(h.at, h.height, 0, axes) : null,
      }))
      .filter((m) => Math.hypot(...m.centre) <= REACH)
  }, [shown, anchor, plane, scaleExp, axes])

  const drawn = useRef(new Map<string, Drawn>())
  const registers = useRef(new Map<string, (g: Group | null) => void>())
  const register = useCallback((key: string, mark: boolean) => {
    // One per key and kind, so a key whose model arrives registers again, measured as a shard.
    const slot = `${key}|${mark ? 'mark' : 'drawn'}`
    let fn = registers.current.get(slot)
    if (!fn) {
      fn = (g: Group | null) => {
        if (g) drawn.current.set(key, { group: g, level: REST, mark, rest: REST, sphere: null, measured: -Infinity })
        else drawn.current.delete(key)
      }
      registers.current.set(slot, fn)
    }
    return fn
  }, [])

  useFrame((state, dt) => {
    if (drawn.current.size === 0) return
    frameNo++
    const aimed = aim(state.camera)
    const k = 1 - Math.exp(-dt / FADE_TAU)
    let covering = 0
    for (const d of drawn.current.values()) {
      const inTheWay = aimed && (d.mark ? markInTheWay(d.group.children[0], state.camera as PerspectiveCamera, state.size.height) : shardInTheWay(d.group))
      if (inTheWay) covering++
      if (COVERAGE_DIM && !d.mark) d.rest = restingFor(coverage(d, state.camera as PerspectiveCamera))
      d.level += ((inTheWay ? COVERING : d.rest) - d.level) * k
      look(d.group, d.level, d.rest)
    }
    if (import.meta.env.DEV) (window as unknown as { __tvFade?: unknown }).__tvFade = { drawn: drawn.current.size, covering, aimed }
  }, FINDS_PRIORITY)

  if (shards.length === 0 && marks.length === 0) return null
  return (
    <>
      {shards.map((w) => <PlacedShard key={w.key} w={w} birth={found[w.key]?.birth} tappable={false} drawnRef={register(w.key, false)} />)}
      {marks.map((m) => <TvMark key={m.key} id={m.key} text={m.text} author={m.author} at={m.centre} wears={m.wears} region={m.region} axes={axes} register={register} />)}
    </>
  )
}
