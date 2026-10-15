/**
 * Avatar.tsx — you.
 *
 * A red wireframe icosahedron marks your position in cyberspace. Same shape as
 * Onosendai v1.
 *
 * It sits at the origin, which is its own aligned cell, so the gibson point for
 * that cell falls at the exact centre of the mesh. It previously carried a 0.1
 * lift on the out axis, which floated it above a flat plane and, once the scene
 * became a volume, simply pushed it off its own gibson.
 *
 * The one exception to sitting at the origin is a commit, where it is drawn
 * trailing behind its committed cell and catches up over a few hundred
 * milliseconds. See travel.ts for why the animation lives here rather than in
 * the coordinate.
 *
 * From CONTINUOUS_SCALE_MIN up the origin is no longer where you stand: the
 * scene places everything at its true position there, you included, so the
 * avatar stands at its own sub-cell offset inside the origin's cell
 * (anchorCentre), which is [0, 0, 0] at every finer zoom (arkinox,
 * 2026-10-01).
 *
 * BUILD mode is the other exception (arkinox, 2026-10-08). The scene there
 * stands on the build cursor, not on an avatar, and the avatar of the chain
 * on show is drawn at its true place relative to the build cursor's field,
 * so you can build near it: yours at your true head, always, and a
 * spectated one at the action the CHAIN chip last aimed at, or its head
 * (lib/buildCursor.ts avatarInBuild).
 *
 * A tap on it opens its card, as a tap on anyone else's does (arkinox,
 * 2026-10-12: "let's make the avatar tap work on the current user too! it
 * will be cool to see our own avatar spin"): PersonModal with the avatar
 * turning, COPY TO WORKSHOP without credit, and no TARGET or SPECTATE, since
 * it is you. While spectating, the avatar drawn here is theirs, and so is
 * the card. Your avatar stands where the cursor, the shard you are in, the
 * stop you board from and the planet you landed on all are, so its target
 * yields (TapTarget `yields`): any of those under the same tap keeps it, and
 * the avatar takes only the taps that would otherwise have toggled the
 * controls.
 *
 * WALK is first person (arkinox, 2026-10-13): the camera is inside the
 * avatar, so the avatar is drawn at the eye (lib/walkEye.ts), out ahead of
 * the chain with the steps you have pressed, and seen from within: a shard's
 * backs are culled, so its appendages show and its inside does not, and the
 * plain icosahedron, which is all inside, is not drawn. While the proofs are
 * behind, a faint outline stands where you really are. No tap target: the
 * camera is in it.
 *
 * The outline never comes to you (arkinox, 2026-10-13). It eases from one
 * proven step to the next while the chain is behind, which keeps it behind
 * the eye, but the step that catches the chain up lands where the camera is,
 * and gliding there put it across the view, in front of you. So that last
 * landing leaves it where it stood, one step back, and it fades out there
 * (GHOST_FADE_MS). The next step pressed brings it back at your proven head
 * at once, with no glide from wherever it last was. Driven per frame from
 * the store (lib/walkGhost.ts), not from React, so a landing cannot draw
 * one frame of it at the new head before a re-render hides it.
 */

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, Material, type Quaternion } from 'three'
import { avatarTurn, facingPair } from '../lib/facing'
import { anchorCentre, GRID_RADIUS, placeCentre, type Position } from '../lib/space'
import { nearGate } from '../lib/walkGate'
import { committedAnchor } from '../lib/renderFrame'
import { travelOffset } from '../lib/travel'
import { walkEye } from '../lib/walkEye'
import { WalkGhost } from '../lib/walkGhost'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { avatarInBuild } from '../lib/buildCursor'
import { usePersonCard } from '../store/usePersonCard'
import { useLayers } from '../store/useLayers'
import { AvatarShape } from './AvatarShape'
import { TapTarget } from './TapTarget'

/** How far from the build cursor's field the avatar is still drawn in BUILD mode, as PresenceAvatars culls. */
const REACH = GRID_RADIUS * 8
/** The proven-head outline's opacity at full strength, as AvatarShape's outline draws it. */
const GHOST_OPACITY = 0.3

export function Avatar(): JSX.Element | null {
  const group = useRef<Group>(null)
  // Where you really stand while WALK runs ahead of the chain.
  const proven = useRef<Group>(null)
  const walking = useCyberspace((s) => s.walking)
  // The View panel's "Hide avatar in WALK": the camera is inside you, and
  // with it on nothing of you is drawn around it.
  const hiddenInWalk = useLayers((s) => s.walkAvatarHidden)
  const ghost = useRef(new WalkGhost())
  // What is drawn, measured for the tap (TapTarget), as OtherAvatar does.
  const drawn = useRef<Group>(null)
  // Looking at a shard means the origin is that shard, not you: drawing your
  // marker there would say you are standing on it. Spectating keeps the marker,
  // where it stands in for the avatar being watched.
  const focus = useCyberspace((s) => s.focus)
  // BUILD mode: the scene rides the build cursor, and the avatar stands at
  // the aimed action of the chain on show, or its head.
  const building = useBuilder((s) => s.active)
  const scrub = useBuilder((s) => s.scrub)
  const placed = building && focus?.drive === true
  // Your own avatar at your true head; a spectated one at the aimed action
  // (lib/buildCursor.ts avatarInBuild).
  const shownPosition = useCyberspace((s): Position | null => (placed ? avatarInBuild(s, scrub)?.position ?? null : null))
  const shownPlane = useCyberspace((s): number | null => (placed ? avatarInBuild(s, scrub)?.plane ?? null : null))
  const spectating = useCyberspace((s) => s.spectate !== null)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  // The facing pair's index: the explored action, or in BUILD mode the aimed
  // one of a spectated chain. Your own avatar stands at your head there.
  const facingIndex = placed && spectating ? scrub : null
  // Whose shape: yours, or the spectated avatar's, whose marker this is then.
  const pubkey = useCyberspace((s) => s.focusPubkey())
  // The last move on the chain drawn, as a key so a re-render costs nothing
  // until the chain grows; the avatar turns to face the way it went.
  const view = useCyberspace((s) => s.view)
  // Time decides the angle: the move that brought the avatar to the link on
  // show, which while scrubbing the chain is the link before the explored one
  // and this one, not the head's last move (lib/facing.ts facingPair).
  const moveKey = useCyberspace((s) => {
    const pair = facingPair(s.focusChain(), placed ? facingIndex : s.exploreIndex)
    if (!pair) return null
    const a = pair[0].position, b = pair[1].position
    return `${a.x},${a.y},${a.z}>${b.x},${b.y},${b.z}`
  })
  // The turn its group carries: the facing in world terms with the view frame
  // composed on, so a compass turn turns the avatar with the world, upside
  // down included (lib/facing.ts avatarTurn). With no move yet it still turns
  // with the view, lying on cyberspace axes as built.
  const facing = useMemo(() => {
    const s = useCyberspace.getState()
    const pair = moveKey ? facingPair(s.focusChain(), placed ? facingIndex : s.exploreIndex) : null
    return avatarTurn(s.axes(), pair ? [pair[0].position, pair[1].position] : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveKey, view])
  // The view the group was last snapped to. A view turn snaps, as the rest of
  // the world does; only a new heading within one view eases in.
  const turnedFor = useRef<Quaternion | null>(null)
  // Where you stand in the render frame: the origin below the continuous
  // range, your true position inside its cell in it.
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const at = useMemo(() => {
    const axes = useCyberspace.getState().axes()
    return shownPosition === null
      ? anchorCentre(anchor, scaleExp, axes)
      : placeCentre(shownPosition, alignedOrigin(anchor, scaleExp), scaleExp, axes)
  }, [anchor, scaleExp, view, shownPosition])

  useFrame(({ camera }, dt) => {
    const g = group.current
    const d = drawn.current
    if (!g || !d) return
    if (walking) {
      g.position.copy(walkEye)
      const p = proven.current
      if (p) {
        const s = useCyberspace.getState()
        // Placed in the frame the scene on screen is drawn in (lib/renderFrame.ts).
        const shown = ghost.current.frame({ ...s, axes: s.axes, anchor: committedAnchor() ?? s.anchor }, performance.now(), dt)
        // Never at the eye: the step pressed glides the eye out of the cell
        // the outline stands in, and catching up glides it back past it
        // (lib/walkGate.ts).
        const gate = shown ? nearGate(Math.hypot(shown.at[0] - camera.position.x, shown.at[1] - camera.position.y, shown.at[2] - camera.position.z)) : 0
        p.visible = shown !== null && gate > 0
        if (shown && gate > 0) {
          p.position.set(shown.at[0], shown.at[1], shown.at[2])
          p.traverse((o) => {
            const m = (o as { material?: Material }).material
            if (m) { m.transparent = true; m.opacity = GHOST_OPACITY * shown.fade * gate }
          })
        }
      }
    } else {
      ghost.current.reset()
      g.position.set(at[0] + travelOffset.x, at[1] + travelOffset.y, at[2] + travelOffset.z)
    }
    // In WALK you face where you look, live as you turn (arkinox,
    // 2026-10-13), not the way your last move went. The model's nose (+Z)
    // draws as render -Z and its top as render +Y (pose.ts renderPose), which
    // are exactly the camera's forward and up in its own frame, so the turn
    // is the camera's own. Local only: everyone else sees the heading your
    // chain gives. Leaving WALK eases back to that heading below.
    if (walking) {
      d.quaternion.copy(camera.quaternion)
      turnedFor.current = view
      return
    }
    // The turn is on the drawn shape alone, so the tap target, which is
    // measured in world space and sized in its parent's, stays unturned.
    if (turnedFor.current !== view) {
      d.quaternion.copy(facing)
      turnedFor.current = view
      return
    }
    // Eases into the new heading over the same beat the travel animation takes.
    d.quaternion.slerp(facing, 1 - Math.exp(-dt / 0.15))
  })

  if (focus && !placed) return null
  // In BUILD mode: not in another plane than the one you build in, and not
  // beyond the field, where it would be a speck a universe away.
  if (placed && (shownPosition === null || shownPlane !== anchorPlane || Math.hypot(...at) > REACH)) return null

  return (
    <>
    {walking && (
      <group ref={proven} visible={false}>
        <AvatarShape pubkey={pubkey} color="#ff2323" renderOrder={10} depthTest={false} outline />
      </group>
    )}
    <group ref={group} position={[0, 0, 0]}>
      {/* No depth test, drawn after the opaque pass: you must always be able
          to find yourself. The selected block's solid cube is exactly one
          cell, the icosahedron inscribes it exactly, and standing on your
          own destination erased you; now the red edges composite on top of
          whatever shares your gibson. */}
      <group ref={drawn}>
        {!(walking && hiddenInWalk) && <AvatarShape pubkey={pubkey} color="#ff2323" renderOrder={10} depthTest={false} firstPerson={walking} />}
      </group>
      {!walking && <TapTarget measure={drawn} yields onTap={() => usePersonCard.getState().open(pubkey)} />}
    </group>
    </>
  )
}
