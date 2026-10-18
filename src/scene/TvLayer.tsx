/**
 * TvLayer.tsx: what Cyberspace TV draws in the world, and how it looks at it.
 *
 * The avatars are the tape's, not today's: everyone the tape has shown, where
 * it last saw them, drawn as every other avatar is (OtherAvatar, gliding on
 * each move). Someone not seen on tape for STALE_S is left out, so a crowd
 * from last week does not stand around this afternoon's shot.
 *
 * The camera orbits the shot's avatar from above, slowly, "so it looks like it
 * was observed from above" (arkinox, 2026-10-18): an angle down onto the
 * avatar and a steady turn around it. How close and how steep is each shot's
 * own (director shotFraming), with a slow push-in over the shot. It follows the avatar as drawn (its
 * glide included), eased, and carries a change of render frame whole as the
 * Rig does, so a re-anchor is not a lurch. Your own orbit and zoom stand down
 * while TV is on; there is nothing to steer.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { GRID_RADIUS, originShift, placeCentre, type Position, type ViewAxes } from '../lib/space'
import { targetColor, drawnAvatars } from '../lib/targets'
import { avatarTurn } from '../lib/facing'
import { committedAnchor } from '../lib/renderFrame'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { shotProgress, useTv } from '../store/useTv'
import { useProfile } from '../hooks/useProfile'
import { OtherAvatar } from './OtherAvatar'
import { tvName } from '../lib/tv/text'
import { TvBoxes } from './TvBoxes'

const REACH = GRID_RADIUS * 8
/** An avatar not seen on tape for this long (tape time) is not drawn. */
const STALE_S = 30 * 60
/** The orbit's turn, radians a second: a full circle in a little under two minutes. */
const TV_ORBIT_SPEED = 0.06
/** How quickly the camera catches up with the avatar, seconds. */
const TV_FOLLOW_TAU = 0.35
/** The camera's turn in the frame: after the Rig's (0), before the composer's render (1). */
const TV_CAMERA_PRIORITY = 0.5
/** How quickly its distance and angle settle, seconds: slow, so the push-in reads as a move. */
const TV_CAMERA_TAU = 0.8

function TapeAvatar({ pubkey, centre, position, from, place, subject }: { pubkey: string; centre: [number, number, number]; position: Position; from?: Position; place: (p: Position) => [number, number, number]; subject: boolean }): JSX.Element {
  const profile = useProfile(pubkey)
  const text = tvName(pubkey, profile?.name)
  // Facing the way it went, from where it was to where it is, as every
  // avatar does after a move (lib/facing.ts; arkinox, 2026-10-18: "when my
  // avatar moves, it always faces the same direction").
  const turn = useMemo(() => avatarTurn(useCyberspace.getState().axes(), from ? [from, position] : null), [from, position])
  return <OtherAvatar pubkey={pubkey} color={targetColor(pubkey)} center={centre} position={position} place={place} turn={turn} label={text} labelOpacity={subject ? 0.9 : 0.5} tappable={false} />
}

function TvCamera({ axes }: { axes: ViewAxes }): null {
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean; target: Vector3; object: { position: Vector3 }; update: () => void } | null
  const smooth = useRef<Vector3 | null>(null)
  const theta = useRef(0)
  const dist = useRef<number | null>(null)
  const polar = useRef<number | null>(null)
  const was = useRef<{ origin: ReturnType<typeof alignedOrigin>; scaleExp: number; cutAt: number } | null>(null)
  const at = useMemo(() => new Vector3(), [])

  useEffect(() => {
    if (!controls) return
    controls.enabled = false
    return () => { controls.enabled = true }
  }, [controls])

  useFrame((state, dt) => {
    const c = controls
    if (!c) return
    const tv = useTv.getState()
    const s = useCyberspace.getState()
    const origin = alignedOrigin(committedAnchor() ?? s.anchor, s.scaleExp)
    // A trip follows its avatar; a segment looks at the view's own point
    // (a located bag's box, or wherever the last shot left it).
    const subject = tv.shot?.kind === 'trip' ? drawnAvatars[tv.shot.pubkey] : undefined
    if (subject) subject.getWorldPosition(at)
    else at.set(...s.cursorOffset())
    const before = was.current
    // The push-in: from the framing's start distance to its end, eased out.
    const p = shotProgress()
    const wantDist = tv.framing.from + (tv.framing.to - tv.framing.from) * (1 - (1 - p) ** 2)
    if (!smooth.current || !before || before.scaleExp !== s.scaleExp || before.cutAt !== tv.cutAt) {
      // A cut or a new zoom: no path between the two framings, so no glide.
      smooth.current = at.clone()
      dist.current = wantDist
      polar.current = tv.framing.polar
    } else {
      // A change of frame moves everything at once, the camera with it (zero when the anchor stayed).
      const [x, y, z] = originShift(before.origin, origin, s.scaleExp, axes)
      smooth.current.x += x
      smooth.current.y += y
      smooth.current.z += z
    }
    was.current = { origin, scaleExp: s.scaleExp, cutAt: tv.cutAt }
    const k = 1 - Math.exp(-dt / TV_FOLLOW_TAU)
    smooth.current.lerp(at, k)
    // A shot that follows straight on keeps its camera and eases to any change.
    const kc = 1 - Math.exp(-dt / TV_CAMERA_TAU)
    dist.current = (dist.current ?? wantDist) + (wantDist - (dist.current ?? wantDist)) * kc
    polar.current = (polar.current ?? tv.framing.polar) + (tv.framing.polar - (polar.current ?? tv.framing.polar)) * kc
    theta.current += dt * TV_ORBIT_SPEED
    // A bag's box on a portrait screen: stand back so its sides stay in (it
    // overflowed a phone, review of #371). Only for the box: a close-up of
    // an avatar on a phone stays close.
    const aspect = (state.camera as { aspect?: number }).aspect ?? 1
    const r = dist.current * (tv.shot?.kind === 'bag' ? Math.max(1, 1 / (aspect * 1.4)) : 1)
    const ph = polar.current
    c.target.copy(smooth.current)
    c.object.position.set(
      smooth.current.x + r * Math.sin(ph) * Math.sin(theta.current),
      smooth.current.y + r * Math.cos(ph),
      smooth.current.z + r * Math.sin(ph) * Math.cos(theta.current),
    )
    c.update()
    // After the Rig (priority 0), which would otherwise aim the camera back
    // at the shot's first place, and before the composer draws (priority 1).
  }, TV_CAMERA_PRIORITY)
  return null
}

export function TvLayer({ axes }: { axes: ViewAxes }): JSX.Element {
  const avatars = useTv((s) => s.avatars)
  const shot = useTv((s) => s.shot)
  const tapeTime = useTv((s) => s.tapeTime)
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const place = useMemo(() => {
    const origin = alignedOrigin(anchor, scaleExp)
    return (p: Position) => placeCentre(p, origin, scaleExp, axes)
  }, [anchor, scaleExp, axes])

  const near = useMemo(() => Object.entries(avatars)
    .filter(([pk, a]) => a.plane === anchorPlane && ((shot?.kind === 'trip' && pk === shot.pubkey) || tapeTime === null || Math.abs(tapeTime - a.at) <= STALE_S))
    .map(([pk, a]) => ({ pk, a, centre: place(a.position) }))
    .filter((p) => Math.hypot(...p.centre) <= REACH), [avatars, anchorPlane, shot, tapeTime, place])

  return (
    <>
      <TvCamera axes={axes} />
      <TvBoxes />
      {near.map((p) => (
        <TapeAvatar key={p.pk} pubkey={p.pk} centre={p.centre} position={p.a.position} from={p.a.from} place={place} subject={shot?.kind === 'trip' && p.pk === shot.pubkey} />
      ))}
    </>
  )
}
