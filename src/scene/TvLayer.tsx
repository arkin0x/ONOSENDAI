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
import { committedAnchor, committedScale } from '../lib/renderFrame'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { broadcastScale } from '../lib/tv/broadcast'
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

function TapeAvatar({ pubkey, centre, position, from, born, place, subject, scaleExp }: { pubkey: string; centre: [number, number, number]; position: Position; from?: Position; born?: number; place: (p: Position) => [number, number, number]; subject: boolean; scaleExp: number }): JSX.Element {
  const profile = useProfile(pubkey)
  const text = tvName(pubkey, profile?.name)
  // Facing the way it went, from where it was to where it is, as every
  // avatar does after a move (lib/facing.ts; arkinox, 2026-10-18: "when my
  // avatar moves, it always faces the same direction").
  const turn = useMemo(() => avatarTurn(useCyberspace.getState().axes(), from ? [from, position] : null), [from, position])
  // As large as the stream's text asked, for its share of the frame (lib/tv/broadcast); as it is on the site.
  const frameW = useThree((st) => st.size.width)
  const labelPx = TV_LABEL_PX * broadcastScale(TV_LABEL_PX, frameW)
  // Every plain avatar in the standard red, as your own is drawn: a hue per
  // person bloomed to white on the tube (arkinox, 2026-10-18: "i want all
  // avatar dodecahedrons to be the standard red color, not white").
  // Names half again the size of ONOSENDAI's 11 px (2026-10-19: "the name
  // label above the avatar is a little too small"): the tube's bend and a
  // phone's labelShrink both take some off.
  return <OtherAvatar pubkey={pubkey} color={AVATAR_RED} center={centre} position={position} place={place} turn={turn} label={text} labelOpacity={subject ? 0.9 : 0.5} tappable={false} keepShape size={() => grownAt(born, performance.now())} labelPx={labelPx} scaleExp={scaleExp} />
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

/**
 * Past this many cells a change of render frame is not carried by TV's camera
 * but cut across, the bound the Rig keeps for the same reason (Scene.tsx
 * GLIDE_MAX_CELLS). Inside a shot the frame moves by the REANCHOR_CELLS or so
 * it takes to keep the avatar near the anchor, far below it; a cut moves it
 * across the universe, where a double cannot carry the camera's few cells
 * through the shift and back (at 1e24 neighbouring values are 1.3e8 apart).
 */
export const TV_CARRY_MAX_CELLS = 300

/**
 * Move the camera's eased point, `smooth`, with a change of render frame by
 * `shift`, so the world does not lurch under it. Too far to carry, it is put
 * on what the camera looks at, `at`, instead: a cut.
 */
export function carryAcross(smooth: Vector3, shift: [number, number, number], at: Vector3): void {
  if (Math.max(Math.abs(shift[0]), Math.abs(shift[1]), Math.abs(shift[2])) >= TV_CARRY_MAX_CELLS) {
    smooth.copy(at)
    return
  }
  smooth.x += shift[0]
  smooth.y += shift[1]
  smooth.z += shift[2]
}

/** What TV's camera follows, kept from one frame to the next. */
export interface TvFollow {
  /** The eased point it looks at, in the frame the scene is drawn in; null before the first frame. */
  smooth: Vector3 | null
  /** The frame, zoom and cut that point was last taken in, and what it was following then. */
  was: { origin: Position; scaleExp: number; cutAt: number; at?: [number, number, number] } | null
}

/** One frame's reading of the store and the scene, for followStep. */
export interface TvFollowFrame {
  /** The store's anchor, which cursorOffset works against. */
  anchor: Position
  /** The anchor the scene on screen was drawn against (lib/renderFrame.ts). */
  drawn: Position
  /** The zoom the scene on screen was drawn at (lib/renderFrame.ts committedScale). */
  scaleExp: number
  cutAt: number
  /** The view's point, against the store's anchor: cursorOffset. */
  live: [number, number, number]
  /** The shot's avatar where its mesh is drawn, for a trip; null otherwise. */
  subject: Vector3 | null
}

/**
 * One frame of what TV's camera follows: the point to look at into `at`, and
 * the eased point in `f`, moved toward it by `k`. Returns 'cut' when the
 * framing starts again (a cut), 'zoom' when only the zoom changed within a
 * shot, 'follow' otherwise, and 'hold' when this frame is not to be drawn
 * from a new place at all.
 *
 * A zoom within a shot (lib/tv/zoom.ts) is not a cut: the camera keeps its
 * distance and angle, and the eased point keeps its lag behind what it
 * follows, rescaled into the new zoom's cells, so a zoom step does not jerk
 * the camera onto the avatar.
 *
 * Everything here is in the frame the scene was drawn in. A cut moves the
 * store's anchor a commit before the scene's, and taking cursorOffset as it
 * came put the point in the new frame while the origin noted was the old one,
 * so the commit's shift was added on the next frame to a point that already
 * had it: the camera stood 4.4e24 cells out, the world beyond its far plane,
 * and eased back for the rest of the shot with only the black sun on screen
 * (measured 2026-10-20, in five TV runs of six).
 *
 * A frame drawn inside that gap, when the gap is a cut across the universe,
 * is held: there is nothing of the new place drawn yet to look at, and in the
 * old frame the new place is 1e24 cells out, where the eye and what it looks
 * at round to one point. The orbit was lost there, the camera faced straight
 * down -z, and the sun flashed in the middle of the picture for a frame, in
 * plain view under a roll cut (review of #421). The commit lands on the next
 * frame or so, and the cut is taken then, in the new frame.
 */
export function followStep(f: TvFollow, frame: TvFollowFrame, axes: ViewAxes, k: number, at: Vector3): 'hold' | 'cut' | 'zoom' | 'follow' {
  const origin = alignedOrigin(frame.drawn, frame.scaleExp)
  const lag = frame.drawn === frame.anchor ? null : originShift(alignedOrigin(frame.anchor, frame.scaleExp), origin, frame.scaleExp, axes)
  if (lag && Math.max(Math.abs(lag[0]), Math.abs(lag[1]), Math.abs(lag[2])) >= TV_CARRY_MAX_CELLS) return 'hold'
  if (frame.subject) at.copy(frame.subject)
  else at.set(frame.live[0] + (lag ? lag[0] : 0), frame.live[1] + (lag ? lag[1] : 0), frame.live[2] + (lag ? lag[2] : 0))
  const before = f.was
  let step: 'cut' | 'zoom' | 'follow' = 'follow'
  if (f.smooth && before && before.cutAt === frame.cutAt && before.scaleExp !== frame.scaleExp && before.at) {
    // A zoom step: the same lag behind the subject, in the new zoom's cells.
    const factor = 2 ** (before.scaleExp - frame.scaleExp)
    f.smooth.set(at.x + (f.smooth.x - before.at[0]) * factor, at.y + (f.smooth.y - before.at[1]) * factor, at.z + (f.smooth.z - before.at[2]) * factor)
    step = 'zoom'
  } else if (!f.smooth || !before || before.scaleExp !== frame.scaleExp || before.cutAt !== frame.cutAt) {
    // A cut or a new zoom: no path between the two framings, so no glide.
    f.smooth = at.clone()
    step = 'cut'
  } else {
    // A change of frame moves everything at once, the camera with it (zero when the anchor stayed).
    carryAcross(f.smooth, originShift(before.origin, origin, frame.scaleExp, axes), at)
  }
  f.was = { origin, scaleExp: frame.scaleExp, cutAt: frame.cutAt, at: [at.x, at.y, at.z] }
  f.smooth.lerp(at, k)
  return step
}

function TvCamera({ axes }: { axes: ViewAxes }): null {
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean; target: Vector3; object: { position: Vector3 }; update: () => void } | null
  const follow = useRef<TvFollow>({ smooth: null, was: null })
  /** Where the camera stood and looked on the last frame drawn, for a held one. */
  const pose = useRef<{ position: Vector3; target: Vector3 } | null>(null)
  const theta = useRef(0)
  const dist = useRef<number | null>(null)
  /** The camera's direction from what it looks at, unit, eased between framings. */
  const look = useRef<Vector3 | null>(null)
  const want = useMemo(() => new Vector3(), [])
  const sunDir = useMemo(() => new Vector3(...renderDirection(axes, 'z')), [axes])
  const at = useMemo(() => new Vector3(), [])
  const subjectAt = useMemo(() => new Vector3(), [])

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
    // A trip follows its avatar; a segment looks at the view's own point
    // (a located bag's box, or wherever the last shot left it), and so does
    // a hyperjump's line (halfway between its two blocks).
    const lining = tv.jump?.phase === 'line'
    const subject = tv.shot?.kind === 'trip' && !lining ? drawnAvatars[tv.shot.pubkey] : undefined
    // The push-in: from the framing's start distance to its end, eased out.
    const p = framingProgress()
    const wantDist = tv.framing.from + (tv.framing.to - tv.framing.from) * (1 - (1 - p) ** 2)
    const step = followStep(follow.current, {
      anchor: s.anchor,
      drawn: committedAnchor() ?? s.anchor,
      scaleExp: committedScale() ?? s.scaleExp,
      cutAt: tv.cutAt,
      live: s.cursorOffset(),
      subject: subject ? subject.getWorldPosition(subjectAt) : null,
    }, axes, 1 - Math.exp(-dt / TV_FOLLOW_TAU), at)
    // Held: the last frame's camera again, undoing whatever the Rig did
    // with this one.
    if (step === 'hold') {
      if (pose.current) {
        c.target.copy(pose.current.target)
        c.object.position.copy(pose.current.position)
        c.update()
      }
      return
    }
    const smooth = follow.current.smooth as Vector3
    if (step === 'cut') {
      dist.current = wantDist
      look.current = null
    }
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
    c.target.copy(smooth)
    c.object.position.copy(smooth).addScaledVector(look.current, r)
    c.update()
    pose.current ??= { position: new Vector3(), target: new Vector3() }
    pose.current.position.copy(c.object.position)
    pose.current.target.copy(c.target)
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
        <TapeAvatar key={p.pk} pubkey={p.pk} centre={p.centre} position={p.a.position} from={p.a.from} born={p.a.born} place={place} subject={shot?.kind === 'trip' && p.pk === shot.pubkey} scaleExp={scaleExp} />
      ))}
    </>
  )
}
