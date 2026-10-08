/**
 * PathTrail.tsx - renders the chain as a line through cyberspace.
 *
 * Each segment connects consecutive committed positions. When the scene is
 * anchored on an earlier action, the trail up to that action is drawn in full
 * and what came after it is drawn faint: the chain is the same object, you are
 * just standing somewhere along it, and the faint part is where it goes next.
 *
 * A segment that ends on a move this device has not published yet (LOCAL, or
 * waiting for a relay) is drawn dashed and a little muted: the chain past
 * the last published action exists only here until it goes out (arkinox,
 * 2026-10-01). Publishing is in order, so that is always the chain's tail.
 * A spectated chain came from the relays and is drawn solid throughout.
 *
 * A game played on the chain is drawn apart (spec §8.11.7). Inside a virtual
 * bracket the identity does not move through cyberspace: the red trail holds
 * still at the place it entered (P, the entry's c), and the moves inside the
 * game are a pink line of their own (palette GAME), from each of the game's
 * actions that carries a coordinate to the next one that does. A bracket is
 * opaque to the base protocol (arkinox, 2026-10-07), so a game action may
 * carry no coordinate at all; it is skipped, not a gap or an error. The
 * entry does not move you and names no place in the game, so the pink line
 * starts at the first game action with a coordinate. It never joins the red
 * one, because nothing travelled between the two: the exit puts the
 * identity back at P, without a line.
 *
 * A broken chain stands at its last valid position (arkinox, 2026-10-07):
 * from the first broken action on, every position is that one, so the red
 * trail ends there and does not follow the actions no verifier accepts.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute, type LineSegments } from 'three'
import { useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { anchorCentre, placeCentre, type Position, type ViewAxes } from '../lib/space'
import { travelOffset } from '../lib/travel'
import { alignedOrigin } from '../store/useCyberspace'
import { GAME } from '../lib/palette'

/** The unpublished tail's red: the trail's own, a step toward grey. */
const LOCAL_RED = '#d94848'
/** Dash and gap along an unpublished segment, in render cells. */
const DASH = 0.32
const GAP = 0.22

interface Props {
  axes: ViewAxes
  scaleExp: number
}

export function PathTrail({ axes, scaleExp }: Props): JSX.Element | null {
  const ownHistory = useCyberspace((s) => s.positionHistory)
  const spectate = useCyberspace((s) => s.spectate)
  const anchor = useCyberspace((s) => s.anchor)
  const exploreIndex = useCyberspace((s) => s.exploreIndex)
  const focus = useCyberspace((s) => s.focus)
  // BUILD mode stands the scene on the build cursor, and the chain on show
  // is drawn there in place, split at the action the CHAIN chip aimed at
  // (arkinox, 2026-10-08), the way history splits it at the explored one.
  const building = useBuilder((s) => s.active)
  const scrub = useBuilder((s) => s.scrub)
  const placed = building && focus?.drive === true
  // Off from the Chain panel's switch (arkinox, 2026-10-01); read with the
  // other hooks so the early return below stays after every one of them.
  const showTrail = useCyberspace((s) => s.showTrail)
  const events = useCyberspace((s) => s.events)
  const published = useCyberspace((s) => s.published)

  // Whose trail: the spectated avatar's chain, else your own.
  const positionHistory = useMemo(
    () => (spectate ? spectate.actions.map((a) => a.position) : ownHistory),
    [spectate, ownHistory],
  )
  const split = (placed ? scrub : exploreIndex) ?? positionHistory.length - 1
  // Which positions are only on this device: your own chain's actions whose
  // events have not been published. The chain is parsed once per change by
  // the store; positionHistory is its positions in the same order.
  const local = useMemo(() => {
    if (spectate) return [] as boolean[]
    return useCyberspace.getState().focusChain().map((a) => published[a.id] !== 'ok')
  }, [spectate, events, published])
  // The game segments: within one bracket, from each game action that
  // carries a coordinate to the next one that does, skipping those without.
  // Indexed by the action a segment ends on, like the trail's.
  const gameSegments = useMemo(() => {
    const chain = useCyberspace.getState().focusChain()
    const out: Array<{ end: number; from: Position; to: Position }> = []
    let last: { bracketId: string; at: Position } | null = null
    for (let i = 1; i < chain.length; i++) {
      const b = chain[i]
      if (b.role === 'enter' || b.role === 'exit') { last = null; continue }
      if (b.role !== 'virtual' || !b.bracketId || !b.declared) continue
      if (last && last.bracketId === b.bracketId) out.push({ end: i, from: last.at, to: b.declared.position })
      last = { bracketId: b.bracketId, at: b.declared.position }
    }
    return out
  }, [spectate, events])

  const geometry = useMemo(() => {
    if (positionHistory.length < 2) return null

    const origin = alignedOrigin(anchor, scaleExp)
    const walked: number[] = []
    const ahead: number[] = []
    const walkedLocal: number[] = []
    const aheadLocal: number[] = []
    const gameWalked: number[] = []
    const gameAhead: number[] = []

    // All three axes. The trail used to map right and up only and pin depth to a
    // constant, so it drew a flat shadow of a 3D path: every out-axis hop
    // collapsed to nothing, and rotating the view changed which axis was being
    // flattened, so the shape changed with the view. placeCentre, matching
    // the cursor and the avatar, so a segment ends where its gibson is drawn:
    // cell centres below the continuous range, true positions in it, where a
    // trail across the whole cube would otherwise fold onto eight corners.
    const centre = (p: typeof anchor): [number, number, number] =>
      placeCentre(p, origin, scaleExp, axes)

    // A segment belongs to the action it ends on, i + 1.
    for (let i = 0; i < positionHistory.length - 1; i++) {
      const isLocal = local[i + 1] === true
      const into = i < split ? (isLocal ? walkedLocal : walked) : (isLocal ? aheadLocal : ahead)
      into.push(...centre(positionHistory[i]), ...centre(positionHistory[i + 1]))
    }
    for (const g of gameSegments) {
      ;(g.end <= split ? gameWalked : gameAhead).push(...centre(g.from), ...centre(g.to))
    }
    // The newest segment, which rides the avatar below, is in whichever walked
    // set its action falls in.
    const lastLocal = local[positionHistory.length - 1] === true

    const make = (v: number[]): BufferGeometry | null => {
      if (v.length === 0) return null
      const geom = new BufferGeometry()
      geom.setAttribute('position', new Float32BufferAttribute(v, 3))
      return geom
    }
    // Where the avatar stands, for the head-riding vertex below.
    return {
      walked: make(walked), ahead: make(ahead), walkedLocal: make(walkedLocal), aheadLocal: make(aheadLocal),
      gameWalked: make(gameWalked), gameAhead: make(gameAhead),
      lastLocal, head: anchorCentre(anchor, scaleExp, axes),
    }
  }, [positionHistory, axes, scaleExp, anchor, split, local, gameSegments])
  // Rebuilt on every hop and re-anchor; the old buffers go with it.
  useEffect(() => () => {
    geometry?.walked?.dispose(); geometry?.ahead?.dispose(); geometry?.walkedLocal?.dispose(); geometry?.aheadLocal?.dispose()
    geometry?.gameWalked?.dispose(); geometry?.gameAhead?.dispose()
  }, [geometry])
  // Dashes are laid along each line's length, which three measures per
  // vertex; measured when a dashed line mounts and again when its riding
  // vertex moves.
  const walkedLocalLine = useRef<LineSegments | null>(null)
  const measureDashes = (line: LineSegments | null): void => { line?.computeLineDistances() }

  // The newest segment ends on the avatar, which is drawn trailing behind its
  // committed cell for a moment after a commit. Left alone, the trail would
  // reach the destination while you were still visibly travelling to it, so the
  // line would lead you there. Its final vertex rides the same offset, from
  // the same place the avatar stands. Only at the head: in history nothing is
  // travelling.
  const lastVertex = useRef<Float32Array | null>(null)
  useFrame(() => {
    if (exploreIndex !== null || spectate || focus !== null) return
    const riding = geometry?.lastLocal ? geometry.walkedLocal : geometry?.walked
    const attr = riding?.attributes.position
    const head = geometry?.head
    if (!attr || !head) return
    const arr = attr.array as Float32Array
    const n = arr.length
    if (n < 3) return
    if (lastVertex.current !== arr) lastVertex.current = arr
    arr[n - 3] = head[0] + travelOffset.x
    arr[n - 2] = head[1] + travelOffset.y
    arr[n - 1] = head[2] + travelOffset.z
    attr.needsUpdate = true
    if (geometry?.lastLocal) walkedLocalLine.current?.computeLineDistances()
  })

  // A focus view (a hyperspace stop, EARTH, a shard) anchors the scene far
  // from the chain, and the head-riding vertex above would pin the trail's
  // last point to the render origin: a red line from your history straight
  // into whatever is being viewed. The avatar hides under a focus; its trail
  // does too.
  // BUILD mode's view is the exception: it frames the chain at its true
  // place, and the riding vertex above stands down under any focus.
  if (!geometry || (focus !== null && !placed) || !showTrail) return null

  return (
    <>
      {geometry.walked && (
        <lineSegments geometry={geometry.walked} frustumCulled={false}>
          <lineBasicMaterial color="#ff0000" linewidth={2} toneMapped={false} />
        </lineSegments>
      )}
      {geometry.ahead && (
        <lineSegments geometry={geometry.ahead} frustumCulled={false}>
          <lineBasicMaterial color="#ff0000" transparent opacity={0.22} toneMapped={false} />
        </lineSegments>
      )}
      {/* Not published yet: dashed and a little muted. */}
      {geometry.walkedLocal && (
        <lineSegments geometry={geometry.walkedLocal} frustumCulled={false} ref={(l: LineSegments | null) => { walkedLocalLine.current = l; measureDashes(l) }}>
          <lineDashedMaterial color={LOCAL_RED} dashSize={DASH} gapSize={GAP} transparent opacity={0.7} toneMapped={false} />
        </lineSegments>
      )}
      {geometry.aheadLocal && (
        <lineSegments geometry={geometry.aheadLocal} frustumCulled={false} ref={measureDashes}>
          <lineDashedMaterial color={LOCAL_RED} dashSize={DASH} gapSize={GAP} transparent opacity={0.18} toneMapped={false} />
        </lineSegments>
      )}
      {/* Moves inside a game: never travel, so never red. */}
      {geometry.gameWalked && (
        <lineSegments geometry={geometry.gameWalked} frustumCulled={false}>
          <lineBasicMaterial color={GAME} transparent opacity={0.85} toneMapped={false} />
        </lineSegments>
      )}
      {geometry.gameAhead && (
        <lineSegments geometry={geometry.gameAhead} frustumCulled={false}>
          <lineBasicMaterial color={GAME} transparent opacity={0.2} toneMapped={false} />
        </lineSegments>
      )}
    </>
  )
}
