/**
 * TvFinds.tsx: what Cyberspace TV's own scan opened, drawn where it lies
 * (lib/tv/scan.ts, store/useTv.ts found).
 *
 * Only what TV opened at the places its avatars stood on this tape, never
 * what you found anywhere else, so TV is the same picture for everyone who
 * watches (arkinox, 2026-10-19). Only shards, keys and chests, which the
 * scan alone lets through. Drawn as the world draws them (WorldShards'
 * PlacedShard, WorldMessages' ItemMark), in the same render frame as TV's
 * avatars, with nothing to tap: TV is for watching.
 *
 * Something between the camera and the shot's avatar fades while it is in
 * the way, so the avatar stays readable (arkinox, 2026-10-19: "fade it").
 */

import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Box3, Sphere, Vector3, type Camera, type Group, type Object3D, type PerspectiveCamera } from 'three'
import { GRID_RADIUS, itemCentre, type ViewAxes } from '../lib/space'
import { drawnAvatars } from '../lib/targets'
import { coversSubject } from '../lib/tv/scan'
import { tvName } from '../lib/tv/text'
import { markShown } from '../lib/worldMarks'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useTv } from '../store/useTv'
import { useProfile } from '../hooks/useProfile'
import { PlacedShard, drawableShards } from './WorldShards'
import { ItemMark, itemMarkText } from './WorldMessages'

const REACH = GRID_RADIUS * 8
/** How far a key's or a chest's mark fades when it is in the way. */
const MARK_FADED = 0.15
/** A mark's size on screen, CSS px (WorldMessages MARK_PX note), and a little over, for its label. */
const MARK_PX = 34 * 1.2

// Hoisted, so a frame allocates nothing.
const box = new Box3()
const sphere = new Sphere()
const subjectSphere = new Sphere()
const eyeAt = new Vector3()
const eye = [0, 0, 0]
const subjectAt = [0, 0, 0]
const thingAt = [0, 0, 0]

/** The shot's avatar, as drawn, as a sphere in the render frame; false when the shot has none on screen. */
function subjectBounds(): boolean {
  const shot = useTv.getState().shot
  const subject = shot?.kind === 'trip' ? drawnAvatars[shot.pubkey] : undefined
  if (!subject) return false
  box.setFromObject(subject)
  if (box.isEmpty()) return false
  box.getBoundingSphere(subjectSphere)
  subjectAt[0] = subjectSphere.center.x; subjectAt[1] = subjectSphere.center.y; subjectAt[2] = subjectSphere.center.z
  return true
}

function eyeOf(camera: Camera): void {
  camera.getWorldPosition(eyeAt)
  eye[0] = eyeAt.x; eye[1] = eyeAt.y; eye[2] = eyeAt.z
}

/** Whether a drawn shard stands between the camera and the shot's avatar. */
function shardCovers(drawn: Group, camera: Camera): boolean {
  if (!subjectBounds()) return false
  box.setFromObject(drawn)
  if (box.isEmpty()) return false
  box.getBoundingSphere(sphere)
  thingAt[0] = sphere.center.x; thingAt[1] = sphere.center.y; thingAt[2] = sphere.center.z
  eyeOf(camera)
  return coversSubject(eye, subjectAt, subjectSphere.radius, thingAt, sphere.radius)
}

/** Whether a mark, a fixed size on screen, stands between the camera and the shot's avatar. */
function markCovers(mark: Object3D, camera: PerspectiveCamera, height: number): boolean {
  if (!subjectBounds()) return false
  mark.getWorldPosition(eyeAt)
  thingAt[0] = eyeAt.x; thingAt[1] = eyeAt.y; thingAt[2] = eyeAt.z
  eyeOf(camera)
  const perPixel = 2 * Math.tan((camera.fov * Math.PI) / 360) / height
  const r = Math.hypot(thingAt[0] - eye[0], thingAt[1] - eye[1], thingAt[2] - eye[2]) * perPixel * MARK_PX / 2
  return coversSubject(eye, subjectAt, subjectSphere.radius, thingAt, r)
}

/** A key or a chest TV opened: its mark, named as TV names people, fading while it is in the way. */
function TvMark({ text, author, at }: { text: string; author: string; at: [number, number, number] }): JSX.Element {
  const profile = useProfile(author)
  const where = useRef<Group>(null)
  const [faded, setFaded] = useState(false)
  useFrame((state) => {
    if (!where.current) return
    const covers = markCovers(where.current, state.camera as PerspectiveCamera, state.size.height)
    if (covers !== faded) setFaded(covers)
  })
  return (
    <group>
      <group ref={where} position={at} />
      <ItemMark text={text} sub={tvName(author, profile?.name)} at={at} opacity={faded ? MARK_FADED : 1} />
    </group>
  )
}

export function TvFinds({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const found = useTv((s) => s.found)
  const anchor = useCyberspace((s) => s.anchor)
  const plane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const shards = useMemo(() => drawableShards(
    Object.values(found).map(({ item: h }) => ({ key: h.eventId, type: h.type, at: h.at, height: h.height, plane: h.plane, shard: h.shard })),
    anchor, plane, scaleExp, axes,
  ), [found, anchor, plane, scaleExp, axes])

  // Keys and chests at the zoom the world draws them at, and no further
  // out (lib/worldMarks markShown, as WorldMessages draws them).
  const marks = useMemo(() => {
    if (!markShown('note', scaleExp)) return []
    const origin = alignedOrigin(anchor, scaleExp)
    return Object.values(found)
      .filter(({ item: h }) => (h.type === 'key' || h.type === 'chest') && h.plane === plane)
      .map(({ item: h }) => ({ key: h.eventId, text: itemMarkText({ type: h.type, keyItem: h.key, chest: h.chest }), author: h.author, centre: itemCentre(h.at, origin, scaleExp, axes) }))
      .filter((m) => Math.hypot(...m.centre) <= REACH)
  }, [found, anchor, plane, scaleExp, axes])

  if (shards.length === 0 && marks.length === 0) return null
  return (
    <>
      {shards.map((w) => <PlacedShard key={w.key} w={w} birth={found[w.key]?.birth} tappable={false} fades={shardCovers} />)}
      {marks.map((m) => <TvMark key={m.key} text={m.text} author={m.author} at={m.centre} />)}
    </>
  )
}
