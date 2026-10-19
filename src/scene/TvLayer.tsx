/**
 * TvLayer.tsx: what Cyberspace TV draws in the world, and how it looks at it.
 *
 * The avatars are the tape's, not today's: everyone the tape has shown, where
 * it last saw them, drawn as every other avatar is (OtherAvatar, gliding on
 * each move). Someone not seen on tape for STALE_S (store/useTv) is left out, so a crowd
 * from last week does not stand around this afternoon's shot.
 *
 * The camera orbits the shot's avatar from above, slowly, "so it looks like it
 * was observed from above" (arkinox, 2026-10-18): an angle down onto the
 * avatar and a steady turn around it. How close and how steep is each shot's
 * own (director shotFraming), with a slow push-in over the shot. It follows the avatar as drawn (its
 * glide included), eased, and carries a change of render frame whole as the
 * Rig does, so a re-anchor is not a lurch. Your own orbit and zoom stand down
 * while TV is on; there is nothing to steer.
 *
 * With the Chain trail switch on, each avatar draws the line behind it of
 * where the tape has shown it go (TvTrail), as your own chain's trail is
 * drawn outside TV.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { GRID_RADIUS, originShift, placeCentre, renderDirection, type Position, type ViewAxes } from '../lib/space'
import type { Framing } from '../lib/tv/director'
import { drawnAvatars } from '../lib/targets'
import { avatarTurn } from '../lib/facing'
import { committedAnchor } from '../lib/renderFrame'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { framingProgress, shownAvatars, useTv } from '../store/useTv'
import { useProfile } from '../hooks/useProfile'
import { OtherAvatar } from './OtherAvatar'
import { tvName } from '../lib/tv/text'
import { AVATAR_RED } from './tvPainter'
import { TvBoxes } from './TvBoxes'
import { SpawnMarker } from './SpawnMarker'
import { TvJump } from './TvJump'
import { TvTrail } from './TvTrail'
import { TvFinds } from './TvFinds'

const REACH = GRID_RADIUS * 8
/** The orbit's turn, radians a second: a full circle in a little under two minutes. */
const TV_ORBIT_SPEED = 0.06
/** How quickly the camera catches up with the avatar, seconds. */
const TV_FOLLOW_TAU = 0.35
/** The camera's turn in the frame: after the Rig's (0), before the composer's render (1). */
const TV_CAMERA_PRIORITY = 0.5
/** How quickly its distance and angle settle, seconds: slow, so the push-in reads as a move. */
const TV_CAMERA_TAU = 0.8

/** How long a spawning avatar takes to grow from a point to its size, ms. */
const GROW_MS = 900

/** A spawned avatar's size at `now`: from nothing, eased out, to whole. */
export function grownAt(born: number | undefined, now: number): number {
  if (born === undefined) return 1
  const t = (now - born) / GROW_MS
  if (t <= 0) return 0
  if (t >= 1) return 1
  return 1 - (1 - t) ** 3
}

function TapeAvatar({ pubkey, centre, position, from, born, place, subject }: { pubkey: string; centre: [number, number, number]; position: Position; from?: Position; born?: number; place: (p: Position) => [number, number, number]; subject: boolean }): JSX.Element {
  const profile = useProfile(pubkey)
  const text = tvName(pubkey, profile?.name)
  // Facing the way it went, from where it was to where it is, as every
  // avatar does after a move (lib/facing.ts; arkinox, 2026-10-18: "when my
  // avatar moves, it always faces the same direction").
  const turn = useMemo(() => avatarTurn(useCyberspace.getState().axes(), from ? [from, position] : null), [from, position])
  // Every plain avatar in the standard red, as your own is drawn: a hue per
  // person bloomed to white on the tube (arkinox, 2026-10-18: "i want all
  // avatar dodecahedrons to be the standard red color, not white").
  // Names half again the size of ONOSENDAI's 11 px (2026-10-19: "the name
  // label above the avatar is a little too small"): the tube's bend and a
  // phone's labelShrink both take some off.
  return <OtherAvatar pubkey={pubkey} color={AVATAR_RED} center={centre} position={position} place={place} turn={turn} label={text} labelOpacity={subject ? 0.9 : 0.5} tappable={false} keepShape size={() => grownAt(born, performance.now())} labelPx={TV_LABEL_PX} />
}

/** The avatars' name labels on TV, CSS px before labelShrink. */
const TV_LABEL_PX = 16

/** How high a sun shot's camera stands for each view, as a share of up: above, level, below. */
const SUN_ELEVATION = { above: 0.45, side: 0.08, below: -0.45 } as const
/** How far a sun shot sways either side of facing the sun, radians, so the sun stays in frame. */
const SUN_SWAY = 0.35

/**
 * The camera's direction from what it looks at, for a framing at orbit angle
 * `theta`, into `out`. An ordinary shot circles at the framing's angle from
 * overhead, either way round. A sun shot stands on the far side of the
 * subject from the black sun, so the sun is behind it in the picture
 * (arkinox, 2026-10-18: "i really like it when the black sun is in frame"),
 * and sways rather than circling, which would turn the sun out of shot.
 */
export function framingDirection(f: Framing, theta: number, sun: Vector3, out: Vector3): Vector3 {
  if (!f.sun) {
    return out.set(Math.sin(f.polar) * Math.sin(theta), Math.cos(f.polar), Math.sin(f.polar) * Math.cos(theta))
  }
  out.copy(sun).negate()
  out.y += SUN_ELEVATION[f.view]
  // The sway: a turn about up, either way.
  const a = SUN_SWAY * Math.sin(theta * 2)
  const x = out.x * Math.cos(a) + out.z * Math.sin(a)
  const z = -out.x * Math.sin(a) + out.z * Math.cos(a)
  out.set(x, out.y, z)
  // Never straight up or down, where the camera's own up is undefined.
  if (Math.abs(out.y) > 0.96 * out.length()) out.x += 0.3
  return out.normalize()
}

function TvCamera({ axes }: { axes: ViewAxes }): null {
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean; target: Vector3; object: { position: Vector3 }; update: () => void } | null
  const smooth = useRef<Vector3 | null>(null)
  const theta = useRef(0)
  const dist = useRef<number | null>(null)
  /** The camera's direction from what it looks at, unit, eased between framings. */
  const look = useRef<Vector3 | null>(null)
  const want = useMemo(() => new Vector3(), [])
  const sunDir = useMemo(() => new Vector3(...renderDirection(axes, 'z')), [axes])
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
    // (a located bag's box, or wherever the last shot left it), and so does
    // a hyperjump's line (halfway between its two blocks).
    const lining = tv.jump?.phase === 'line'
    const subject = tv.shot?.kind === 'trip' && !lining ? drawnAvatars[tv.shot.pubkey] : undefined
    if (subject) subject.getWorldPosition(at)
    else at.set(...s.cursorOffset())
    const before = was.current
    // The push-in: from the framing's start distance to its end, eased out.
    const p = framingProgress()
    const wantDist = tv.framing.from + (tv.framing.to - tv.framing.from) * (1 - (1 - p) ** 2)
    if (!smooth.current || !before || before.scaleExp !== s.scaleExp || before.cutAt !== tv.cutAt) {
      // A cut or a new zoom: no path between the two framings, so no glide.
      smooth.current = at.clone()
      dist.current = wantDist
      look.current = null
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
    theta.current += dt * TV_ORBIT_SPEED * tv.framing.spin
    framingDirection(tv.framing, theta.current, sunDir, want)
    if (!look.current) look.current = want.clone()
    else look.current.lerp(want, kc).normalize()
    // A bag's box or a ride's two blocks on a portrait screen: stand back so
    // they stay in (a box overflowed a phone, review of #371). Only for
    // those: a close-up of an avatar on a phone stays close.
    const aspect = (state.camera as { aspect?: number }).aspect ?? 1
    // A ride's two blocks lie across the frame, so they stand back further.
    const r = dist.current * (lining ? Math.max(1, 1 / aspect) : tv.shot?.kind === 'bag' ? Math.max(1, 1 / (aspect * 1.4)) : 1)
    c.target.copy(smooth.current)
    c.object.position.copy(smooth.current).addScaledVector(look.current, r)
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
  const lining = useTv((s) => s.jump?.phase === 'line')
  const commercial = useTv((s) => s.ad !== null)
  const showTrail = useCyberspace((s) => s.showTrail)

  const place = useMemo(() => {
    const origin = alignedOrigin(anchor, scaleExp)
    return (p: Position) => placeCentre(p, origin, scaleExp, axes)
  }, [anchor, scaleExp, axes])

  const near = useMemo(() => shownAvatars({ avatars, shot, tapeTime }, anchorPlane)
    .map(([pk, a]) => ({ pk, a, centre: place(a.position) }))
    .filter((p) => Math.hypot(...p.centre) <= REACH), [avatars, anchorPlane, shot, tapeTime, place])

  // A commercial: nothing of the tape in the world under it ("No cyberspace
  // actions play in the bg while the hosaka ad plays"); the camera holds.
  if (commercial) return <TvCamera axes={axes} />

  // A hyperjump's line: only its two blocks and its rider, everything else
  // stepped aside ("all the other blocks not involved can be hidden").
  if (lining) {
    return (
      <>
        <TvCamera axes={axes} />
        <TvJump axes={axes} />
      </>
    )
  }

  return (
    <>
      <TvCamera axes={axes} />
      <TvBoxes />
      {/* What TV's own scan opened where its avatars stood (lib/tv/scan.ts). */}
      <TvFinds axes={axes} />
      {/* Each avatar's spawn point, where it is in range (SpawnMarker culls
          itself): where a chain begins (arkinox, 2026-10-18). */}
      {near.map((p) => <SpawnMarker key={`spawn-${p.pk}`} pubkey={p.pk} axes={axes} />)}
      {showTrail && near.map((p) => (p.a.path && p.a.path.length > 1 ? <TvTrail key={`trail-${p.pk}`} pubkey={p.pk} path={p.a.path} place={place} /> : null))}
      {near.map((p) => (
        <TapeAvatar key={p.pk} pubkey={p.pk} centre={p.centre} position={p.a.position} from={p.a.from} born={p.a.born} place={place} subject={shot?.kind === 'trip' && p.pk === shot.pubkey} />
      ))}
    </>
  )
}
