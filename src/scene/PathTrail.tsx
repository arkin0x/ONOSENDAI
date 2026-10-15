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
 *
 * The trail respects the plane on show (arkinox, 2026-10-15). Dataspace and
 * ideaspace share x, y and z, so a move in the other plane would draw right
 * over the moves in this one, and the trail could not say where you were.
 * Every vertex keeps the plane its action was in, and a vertex in the other
 * plane is drawn in that plane's dark color (palette TRAIL_IDEASPACE_DIM,
 * TRAIL_DATASPACE_DIM; GAME_DIM for a game's moves). A segment between the
 * planes, a plane flip, a ride landing in the other one, a spawn there,
 * blends from one end's color to the other's along its length. Everything
 * else about a line, solid or dashed, full or faint, is unchanged. A plane
 * switch only rewrites the color of each vertex where it stands
 * (paintTrail): the lines are not rebuilt, and nothing is measured again.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferGeometry, Color, Float32BufferAttribute, type LineSegments } from 'three'
import type { Plane } from 'cyberspace-core'
import { useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { anchorCentre, placeCentre, type Position, type ViewAxes } from '../lib/space'
import { travelOffset } from '../lib/travel'
import { alignedOrigin } from '../store/useCyberspace'
import { GAME, GAME_DIM, TRAIL_DATASPACE_DIM, TRAIL_IDEASPACE_DIM } from '../lib/palette'

/** The trail's red. */
const TRAIL_RED = '#ff0000'
/** The unpublished tail's red: the trail's own, a step toward grey. */
const LOCAL_RED = '#d94848'
/** Dash and gap along an unpublished segment, in render cells. */
const DASH = 0.32
const GAP = 0.22

/**
 * What one kind of line is drawn in: its own color in the plane on show, and
 * the color a move fades to while the other plane is, by the plane it was
 * made in. The colors are shared: read them, never change them.
 */
export interface TrailInk {
  own: Color
  other: readonly [Color, Color]
}
const ink = (own: string, dataspace: string, ideaspace: string): TrailInk =>
  ({ own: new Color(own), other: [new Color(dataspace), new Color(ideaspace)] })
export const TRAIL_INK = ink(TRAIL_RED, TRAIL_DATASPACE_DIM, TRAIL_IDEASPACE_DIM)
export const LOCAL_INK = ink(LOCAL_RED, TRAIL_DATASPACE_DIM, TRAIL_IDEASPACE_DIM)
export const GAME_INK = ink(GAME, GAME_DIM, GAME_DIM)

/** The color a vertex in `plane` is drawn in while `view` is the plane on show. */
export function trailColor(ink: TrailInk, plane: Plane, view: Plane): Color {
  return plane === view ? ink.own : ink.other[plane]
}

/** One line of the trail: its segments, the plane of each vertex, and what it is drawn in. */
export interface TrailLine {
  geometry: BufferGeometry
  planes: Uint8Array
  ink: TrailInk
}

/** The trail's lines, by how each is drawn, and whether the newest segment is unpublished. */
export interface Trail {
  walked: TrailLine | null
  ahead: TrailLine | null
  walkedLocal: TrailLine | null
  aheadLocal: TrailLine | null
  gameWalked: TrailLine | null
  gameAhead: TrailLine | null
  lastLocal: boolean
}

/** Where a game's move is, and in which plane. */
export interface GamePlace {
  position: Position
  plane: Plane
}

export interface TrailInput {
  /** Every position of the chain, spawn first. */
  positions: Position[]
  /** The plane of each position, in the same order. */
  planes: Plane[]
  /** Which positions are only on this device. */
  local: boolean[]
  /** The action the trail is drawn in full up to. */
  split: number
  /** A game's moves, by the action each ends on. */
  games: Array<{ end: number; from: GamePlace; to: GamePlace }>
  /** Where a position is drawn. */
  centre: (p: Position) => [number, number, number]
}

/**
 * Build the trail's lines. Nothing here depends on the plane on show, so
 * switching it can never rebuild them: paintTrail colors them for it.
 */
export function buildTrail({ positions, planes, local, split, games, centre }: TrailInput): Trail {
  const sets = {
    walked: { v: [] as number[], p: [] as number[], ink: TRAIL_INK },
    ahead: { v: [] as number[], p: [] as number[], ink: TRAIL_INK },
    walkedLocal: { v: [] as number[], p: [] as number[], ink: LOCAL_INK },
    aheadLocal: { v: [] as number[], p: [] as number[], ink: LOCAL_INK },
    gameWalked: { v: [] as number[], p: [] as number[], ink: GAME_INK },
    gameAhead: { v: [] as number[], p: [] as number[], ink: GAME_INK },
  }
  // The plane of a position the parsed chain has not caught up with yet is
  // the newest one it has: the store updates both together, so this is a
  // guard, not a case.
  const planeAt = (i: number): Plane => planes[i] ?? planes[planes.length - 1] ?? 0

  // A segment belongs to the action it ends on, i + 1.
  for (let i = 0; i < positions.length - 1; i++) {
    const isLocal = local[i + 1] === true
    const into = i < split ? (isLocal ? sets.walkedLocal : sets.walked) : (isLocal ? sets.aheadLocal : sets.ahead)
    into.v.push(...centre(positions[i]), ...centre(positions[i + 1]))
    into.p.push(planeAt(i), planeAt(i + 1))
  }
  for (const g of games) {
    const into = g.end <= split ? sets.gameWalked : sets.gameAhead
    into.v.push(...centre(g.from.position), ...centre(g.to.position))
    into.p.push(g.from.plane, g.to.plane)
  }

  const make = (s: { v: number[]; p: number[]; ink: TrailInk }): TrailLine | null => {
    if (s.v.length === 0) return null
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(s.v, 3))
    // Filled by paintTrail, before the first frame draws it.
    geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(s.v.length), 3))
    return { geometry, planes: Uint8Array.from(s.p), ink: s.ink }
  }
  return {
    walked: make(sets.walked), ahead: make(sets.ahead), walkedLocal: make(sets.walkedLocal), aheadLocal: make(sets.aheadLocal),
    gameWalked: make(sets.gameWalked), gameAhead: make(sets.gameAhead),
    // The newest segment, which rides the avatar below, is in whichever walked
    // set its action falls in.
    lastLocal: local[positions.length - 1] === true,
  }
}

/** Every line a trail has. */
export function trailLines(t: Trail): TrailLine[] {
  return [t.walked, t.ahead, t.walkedLocal, t.aheadLocal, t.gameWalked, t.gameAhead].filter((l): l is TrailLine => l !== null)
}

/**
 * Color a line for the plane on show. The color attribute is rewritten where
 * it stands, never replaced, and nothing is allocated, so a plane switch
 * costs one pass over the vertices and an upload.
 */
export function paintTrail(line: TrailLine, view: Plane): void {
  const attr = line.geometry.attributes.color
  const arr = attr.array as Float32Array
  for (let i = 0; i < line.planes.length; i++) {
    const c = trailColor(line.ink, line.planes[i] as Plane, view)
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  attr.needsUpdate = true
}

interface Props {
  axes: ViewAxes
  scaleExp: number
}

export function PathTrail({ axes, scaleExp }: Props): JSX.Element | null {
  const ownHistory = useCyberspace((s) => s.positionHistory)
  const spectate = useCyberspace((s) => s.spectate)
  const anchor = useCyberspace((s) => s.anchor)
  // The plane on show, which the scene's terrain and avatars follow too: the
  // head's at the head, the explored action's in history, the view's in a view.
  const viewPlane = useCyberspace((s) => s.anchorPlane)
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
  // The plane each position is in, from the same chain in the same order.
  const planes = useMemo(() => useCyberspace.getState().focusChain().map((a) => a.plane), [spectate, events])
  // The game segments: within one bracket, from each game action that
  // carries a coordinate to the next one that does, skipping those without.
  // Indexed by the action a segment ends on, like the trail's.
  const gameSegments = useMemo(() => {
    const chain = useCyberspace.getState().focusChain()
    const out: Array<{ end: number; from: GamePlace; to: GamePlace }> = []
    let last: { bracketId: string; at: GamePlace } | null = null
    for (let i = 1; i < chain.length; i++) {
      const b = chain[i]
      if (b.role === 'enter' || b.role === 'exit') { last = null; continue }
      if (b.role !== 'virtual' || !b.bracketId || !b.declared) continue
      if (last && last.bracketId === b.bracketId) out.push({ end: i, from: last.at, to: b.declared })
      last = { bracketId: b.bracketId, at: b.declared }
    }
    return out
  }, [spectate, events])

  const trail = useMemo(() => {
    if (positionHistory.length < 2) return null

    const origin = alignedOrigin(anchor, scaleExp)
    // All three axes. The trail used to map right and up only and pin depth to a
    // constant, so it drew a flat shadow of a 3D path: every out-axis hop
    // collapsed to nothing, and rotating the view changed which axis was being
    // flattened, so the shape changed with the view. placeCentre, matching
    // the cursor and the avatar, so a segment ends where its gibson is drawn:
    // cell centres below the continuous range, true positions in it, where a
    // trail across the whole cube would otherwise fold onto eight corners.
    const centre = (p: Position): [number, number, number] =>
      placeCentre(p, origin, scaleExp, axes)

    // Where the avatar stands, for the head-riding vertex below.
    return {
      ...buildTrail({ positions: positionHistory, planes, local, split, games: gameSegments, centre }),
      head: anchorCentre(anchor, scaleExp, axes),
    }
  }, [positionHistory, planes, axes, scaleExp, anchor, split, local, gameSegments])
  // Rebuilt on every hop and re-anchor; the old buffers go with it.
  useEffect(() => () => {
    if (trail) for (const line of trailLines(trail)) line.geometry.dispose()
  }, [trail])
  // Colored for the plane on show when built, and again in place when the
  // plane changes. Before paint, so a switch never shows a frame of the old
  // colors and a new trail never shows one of black.
  useLayoutEffect(() => {
    if (trail) for (const line of trailLines(trail)) paintTrail(line, viewPlane)
  }, [trail, viewPlane])
  // Dashes are laid along each line's length, which three measures per
  // vertex; measured when a dashed line mounts or is rebuilt, and again when
  // its riding vertex moves. Keyed on the trail, so the ref is called again
  // for a rebuild and for nothing else: an inline callback is a new one every
  // render, and re-measured both lines on any re-render at all, a plane
  // switch included.
  const walkedLocalLine = useRef<LineSegments | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const measureWalkedLocal = useCallback((line: LineSegments | null): void => { walkedLocalLine.current = line; line?.computeLineDistances() }, [trail])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const measureDashes = useCallback((line: LineSegments | null): void => { line?.computeLineDistances() }, [trail])

  // The newest segment ends on the avatar, which is drawn trailing behind its
  // committed cell for a moment after a commit. Left alone, the trail would
  // reach the destination while you were still visibly travelling to it, so the
  // line would lead you there. Its final vertex rides the same offset, from
  // the same place the avatar stands. Only at the head: in history nothing is
  // travelling.
  const lastVertex = useRef<Float32Array | null>(null)
  useFrame(() => {
    if (exploreIndex !== null || spectate || focus !== null) return
    const riding = trail?.lastLocal ? trail.walkedLocal : trail?.walked
    const attr = riding?.geometry.attributes.position
    const head = trail?.head
    if (!attr || !head) return
    const arr = attr.array as Float32Array
    const n = arr.length
    if (n < 3) return
    // As float32, as the array stores them, so an unmoved vertex compares equal.
    const x = Math.fround(head[0] + travelOffset.x), y = Math.fround(head[1] + travelOffset.y), z = Math.fround(head[2] + travelOffset.z)
    // Only when the riding vertex moved. Rewritten every frame, the dashed
    // trail was re-measured every frame too, and three's
    // computeLineDistances allocates a new array the length of the line each
    // time: 30 MB a minute of garbage on a 2,000-action LOCAL trail with the
    // avatar standing still (measured 2026-10-13).
    if (lastVertex.current === arr && arr[n - 3] === x && arr[n - 2] === y && arr[n - 1] === z) return
    lastVertex.current = arr
    arr[n - 3] = x
    arr[n - 2] = y
    arr[n - 1] = z
    attr.needsUpdate = true
    if (trail?.lastLocal) walkedLocalLine.current?.computeLineDistances()
  })

  // A focus view (a hyperspace stop, EARTH, a shard) anchors the scene far
  // from the chain, and the head-riding vertex above would pin the trail's
  // last point to the render origin: a red line from your history straight
  // into whatever is being viewed. The avatar hides under a focus; its trail
  // does too.
  // BUILD mode's view is the exception: it frames the chain at its true
  // place, and the riding vertex above stands down under any focus.
  if (!trail || (focus !== null && !placed) || !showTrail) return null

  // Each line's color is per vertex (paintTrail), so the materials are white.
  return (
    <>
      {trail.walked && (
        <lineSegments geometry={trail.walked.geometry} frustumCulled={false}>
          <lineBasicMaterial vertexColors linewidth={2} toneMapped={false} />
        </lineSegments>
      )}
      {trail.ahead && (
        <lineSegments geometry={trail.ahead.geometry} frustumCulled={false}>
          <lineBasicMaterial vertexColors transparent opacity={0.22} toneMapped={false} />
        </lineSegments>
      )}
      {/* Not published yet: dashed and a little muted. */}
      {trail.walkedLocal && (
        <lineSegments geometry={trail.walkedLocal.geometry} frustumCulled={false} ref={measureWalkedLocal}>
          <lineDashedMaterial vertexColors dashSize={DASH} gapSize={GAP} transparent opacity={0.7} toneMapped={false} />
        </lineSegments>
      )}
      {trail.aheadLocal && (
        <lineSegments geometry={trail.aheadLocal.geometry} frustumCulled={false} ref={measureDashes}>
          <lineDashedMaterial vertexColors dashSize={DASH} gapSize={GAP} transparent opacity={0.18} toneMapped={false} />
        </lineSegments>
      )}
      {/* Moves inside a game: never travel, so never red. */}
      {trail.gameWalked && (
        <lineSegments geometry={trail.gameWalked.geometry} frustumCulled={false}>
          <lineBasicMaterial vertexColors transparent opacity={0.85} toneMapped={false} />
        </lineSegments>
      )}
      {trail.gameAhead && (
        <lineSegments geometry={trail.gameAhead.geometry} frustumCulled={false}>
          <lineBasicMaterial vertexColors transparent opacity={0.2} toneMapped={false} />
        </lineSegments>
      )}
    </>
  )
}
