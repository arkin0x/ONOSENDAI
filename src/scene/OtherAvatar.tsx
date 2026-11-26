/**
 * OtherAvatar.tsx: someone else's avatar in the field, a target's or a
 * passer-by's, drawn the one way both lists draw it.
 *
 * Two things were added here (arkinox, 2026-10-11, looking at his agent's new
 * avatar next to him). A tap on the avatar opens their profile card
 * (PersonModal) with a spinning preview of the shard and COPY TO WORKSHOP:
 * the tap lands on a TapTarget measured from what is drawn, the same target
 * world shards use, so it takes its turn among the scene's other taps by
 * distance and stops the tap from also toggling the controls. And the group
 * that holds the shape is registered by pubkey (lib/targets drawnAvatars) so
 * the projector can put the HUD's name and picture under the avatar's real
 * bounds instead of its cell's corner.
 *
 * And it glides when they move (arkinox, 2026-10-12: "if I'm not spectating
 * XOR, there is no LERP when he moves, which makes his movement actions hard
 * to follow"). It used to be drawn wherever the feed last put it, so a move
 * was a teleport. Now a change of their true position starts the same glide
 * your own avatar takes (lib/avatarLerp.ts AvatarLerp, AVATAR_LERP_MS): the
 * group is drawn at its new place plus an offset that starts at the old place
 * and decays to zero. Only their own move glides; your hop moves everybody's
 * render coordinates, and since the offset is relative, that shift is applied
 * whole as the rest of the world's is.
 *
 * And it faces the way it went (arkinox, 2026-11-26: "can you fix where
 * other people's avatars always face the black sun regardless of their
 * movements?"). Each move of theirs seen here, from where they stood to
 * where they stand, is their heading, as your own chain's last move is
 * yours: PATH along it, UPRIGHT about your view's up and kept on a move
 * straight up or down (lib/facing.ts seeMove, seenTurn). Standing still
 * keeps the last heading; before any move they stand at rest, as before. A
 * new heading turns in over TURN_MS along the shorter way round
 * (lib/turnEase.ts); a view turn snaps with the world. Cyberspace TV hands
 * its own turn from the tape (TvLayer), which eases the same way.
 *
 * In build mode it dims while it stands between the camera and the build
 * cursor, as a shard does, and a tap passes through it then (BuildOccluders;
 * arkinox, 2026-11-09). It registers only while the Builder is on: anywhere
 * else an avatar is never see-through (AvatarShape, DECK-0003 §3.3).
 */

import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Quaternion, type Group } from 'three'
import { AvatarLerp, type Vec3 } from '../lib/avatarLerp'
import { renderDirection, type Position } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { REST_FLOOR } from '../store/walkWalls'
import { easeRest, useRestDrop } from './useRestDrop'
import { drawnAvatars } from '../lib/targets'
import { yawOnly } from '../lib/avatarEye'
import { NO_MOVES, seeMove, seenTurn, type SeenMoves } from '../lib/facing'
import { TurnEase } from '../lib/turnEase'
import { useAvatarFace } from '../store/avatarFace'
import { usePersonCard } from '../store/usePersonCard'
import { AvatarShape } from './AvatarShape'
import { useAvatarLift } from './avatarLift'
import { useAvatarOccluder } from './BuildOccluders'
import { TapTarget } from './TapTarget'
import { WorldLabel } from './WorldLabel'

interface Props {
  pubkey: string
  color: string
  center: [number, number, number]
  /** Their true position: a change of it is a move, and glides. */
  position: Position
  /** Where a position is drawn in the current render frame (lib/space placeCentre). */
  place: (p: Position) => Vec3
  /**
   * The turn to face, when the caller knows it: Cyberspace TV, from the tape.
   * Left out, as everywhere else, the avatar faces the way its own moves
   * seen here went (seeMove).
   */
  turn?: Quaternion
  label: string
  labelOpacity: number
  /** Whether a tap opens their card; false on Cyberspace TV, where nothing on screen takes a tap. */
  tappable?: boolean
  /** The shape's size, read each frame, 0 to 1: Cyberspace TV grows a spawning avatar from a point. */
  size?: () => number
  /** Its own shape at any zoom, never the marker (Cyberspace TV). */
  keepShape?: boolean
  /** The name label's size, CSS px before labelShrink: larger on Cyberspace TV, read from across a room. */
  labelPx?: number
  /**
   * The zoom `place` draws at, when a change of it mid-glide should rescale
   * the glide rather than leave it in the old zoom's cells: Cyberspace TV,
   * which zooms while its avatars move (lib/tv/zoom.ts). Left out, as
   * everywhere else, a glide is never touched by a zoom.
   */
  scaleExp?: number
}

export function OtherAvatar({ pubkey, color, center, position, place, turn, label, labelOpacity, tappable = true, size, keepShape = false, labelPx = 11, scaleExp }: Props): JSX.Element {
  const drawn = useRef<Group>(null)
  const placed = useRef<Group>(null)
  const lerp = useRef(new AvatarLerp())
  const out = useRef<Vec3>([0, 0, 0])
  const last = useRef<Position>(position)
  const zoomWas = useRef(scaleExp)
  // The moves of theirs seen here, and the turn the shape is easing into.
  const seen = useRef<SeenMoves>(NO_MOVES)
  const ease = useRef(new TurnEase())
  const aimed = useRef<{ seen: SeenMoves; turn: Quaternion | undefined; face: string; view: Quaternion } | null>(null)
  /** The drop a move left with, and how far its glide had to go (render cells): apply blends the drop along it. */
  const dropFrom = useRef<number | null>(null)
  const glideLen = useRef(0)
  const dropNow = useRef<number | null>(null)
  // Its key among what may block the build cursor, only while the Builder is
  // on; unique to this one drawing, since two lists may draw the same pubkey.
  const id = useId()
  const { occluder, dim } = useAvatarOccluder(`${pubkey}:${id}`, drawn)
  // Before the move's effect below, so a move landing in the same commit as
  // a zoom adds its own offset (in the new zoom's cells) to a glide already
  // put in them.
  useLayoutEffect(() => {
    const was = zoomWas.current
    zoomWas.current = scaleExp
    if (was !== undefined && scaleExp !== undefined && was !== scaleExp) lerp.current.rescale(2 ** (was - scaleExp))
  }, [scaleExp])
  const moveKey = `${position.x},${position.y},${position.z}`
  // A layout effect, so the glide is registered before a frame can draw the
  // avatar at its new place with no offset: that frame was the avatar
  // flashing at its destination before travelling there.
  useLayoutEffect(() => {
    const old = last.current
    last.current = position
    if (old.x === position.x && old.y === position.y && old.z === position.z) return
    seen.current = seeMove(seen.current, old, position, useCyberspace.getState().axes())
    const was = place(old)
    lerp.current.move([was[0] - center[0], was[1] - center[1], was[2] - center[2]], performance.now())
    // The height it leaves with, blended onto the new one as the glide goes (apply).
    dropFrom.current = dropNow.current
    glideLen.current = Math.hypot(was[0] - center[0], was[1] - center[1], was[2] - center[2])
    // place and center are read at the moment of the move on purpose, as
    // Travel reads its frame: a zoom mid-glide must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveKey])
  // Their origin stands on the surface under their gibson, else on its
  // floor, as yours does, the icosahedron lifted onto it (useRestDrop,
  // useAvatarLift; arkinox, 2026-11-17). Not on Cyberspace TV (`scaleExp`
  // given), whose frame and zoom are its own: drawn there as before.
  const tv = scaleExp !== undefined
  const plane = useCyberspace((st) => st.plane)
  const zoom = useCyberspace((st) => st.scaleExp)
  const dropTo = useRestDrop(tv ? null : position, plane, zoom)
  const lift = useAvatarLift(pubkey, keepShape)
  const dropAt = useRef<number | null>(null)
  // PATH or UPRIGHT, from the shape they wear (DECK-0003 §1.18).
  const face = useAvatarFace(pubkey)
  const apply = (): void => {
    const g = placed.current
    if (!g) return
    const now = performance.now()
    turnShape(now)
    const o = lerp.current.offset(now, out.current)
    g.position.set(center[0] + o[0], center[1] + o[1], center[2] + o[2])
    if (!tv) {
      // A move under way goes from the height it left with to the new one as
      // it glides, so a walker on a slope keeps its feet on it; at rest it settles.
      const left = Math.hypot(o[0], o[1], o[2])
      if (dropNow.current === null) dropNow.current = dropTo.current
      else if (left > 1e-3 && dropFrom.current !== null && glideLen.current > 1e-9) {
        const t = Math.min(1, Math.max(0, 1 - left / glideLen.current))
        dropNow.current = dropFrom.current + (dropTo.current - dropFrom.current) * t
      } else dropNow.current = easeRest(dropNow.current, dropTo.current, dropAt.current === null ? 0 : (now - dropAt.current) / 1000)
      dropAt.current = now
      const up = renderDirection(useCyberspace.getState().axes(), 'y')
      const k = lift - dropNow.current
      g.position.x += up[0] * k
      g.position.y += up[1] * k
      g.position.z += up[2] * k
    }
    if (size && drawn.current) drawn.current.scale.setScalar(Math.max(1e-4, size()))
  }
  // On every commit as well as every frame, so the group is never left at
  // the origin or at a stale center between a render and the next frame.
  useLayoutEffect(apply)
  useFrame(apply)
  useEffect(() => {
    const g = drawn.current
    if (!g) return
    drawnAvatars[pubkey] = g
    return () => { if (drawnAvatars[pubkey] === g) delete drawnAvatars[pubkey] }
  }, [pubkey])
  // The heading to face, worked out again only when what it comes from
  // changes: a move seen, a new turn from the caller, a new face, a view turn.
  // A view turn, or the first heading, snaps; anything else turns in.
  function turnShape(now: number): void {
    const d = drawn.current
    if (!d) return
    const s = useCyberspace.getState()
    const was = aimed.current
    if (!was || was.seen !== seen.current || was.turn !== turn || was.face !== face || was.view !== s.view) {
      // UPRIGHT (DECK-0003 §1.18): a caller's turn laid level about your
      // view's up, render +Y, so they stand on their feet on your screen
      // however the compass has turned the world. Idempotent on a turn
      // already level; seenTurn lays its own.
      const target = turn ? (face === 'upright' ? yawOnly(turn, new Quaternion()) : turn) : seenTurn(seen.current, s.axes(), face)
      if (!was || was.view !== s.view) ease.current.snap(target)
      else ease.current.aim(target, now)
      aimed.current = { seen: seen.current, turn, face, view: s.view }
    }
    ease.current.at(now, d.quaternion)
  }
  return (
    <group ref={placed}>
      <group ref={drawn}>
        <AvatarShape pubkey={pubkey} color={color} keepShape={keepShape} dim={dim} />
      </group>
      {tappable && <TapTarget measure={drawn} occluder={occluder} onTap={() => usePersonCard.getState().open(pubkey)} />}
      <WorldLabel text={label} color={color} at={[0, tv ? 0.9 : 0.9 + REST_FLOOR - lift, 0]} align="center" px={labelPx} opacity={labelOpacity} />
    </group>
  )
}
