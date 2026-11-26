/**
 * TapTarget.tsx: the invisible thing a tap on a world object lands on.
 *
 * A shard's target is the box the shard actually draws, measured from the
 * drawn geometry itself (faces, points, lines and placed objects), not a
 * sphere at its origin: a model wider than two units, or built off its
 * origin, used to overhang its sphere, so tapping what you saw missed
 * (arkinox, 2026-09-30: "tapping on shards is really unreliable").
 *
 * What cannot be seen cannot be tapped. At each tap the box's size on screen
 * is worked out from the camera; under MIN_VISIBLE_PX the target takes no
 * rays. The old sphere had a floor of 0.6 render cells, so a shard shrunk far
 * below a pixel by zooming out (2^52) still caught taps. A shard that can be
 * seen but is small is given a finger-sized target, MIN_TARGET_PX across,
 * so it is easy to hit without being invisible-yet-hittable.
 *
 * A coin's mark is drawn at a fixed pixel size and so is always visible; its
 * target is a fixed pixel size too (`px`). A message's box is one gibson in
 * the world (WorldMessages NOTE_BOX_GIBSONS): its target is a fingertip, or
 * the box itself once the box is larger (`side`).
 *
 * The other end has a limit too (arkinox, 2026-10-01). Zoomed far in, a
 * shard is larger than the screen, and a target the size of what it draws
 * would cover the whole view, so every tap anywhere would open it. A shard
 * whose box holds the camera, or whose box is more than MAX_SCREENS screens
 * across, takes no taps; it is still drawn, so its faces stand around you.
 *
 * None of these limits is for a chest-sized thing (LookMark `upClose`;
 * arkinox, 2026-11-13: "having a lot of trouble tapping on the chest again
 * ... im in walk mode"). In WALK the eye is the walker's own cell centre, so
 * standing in a chest's cell (a bounce onto the finish deck can land you
 * there) puts the eye inside its box, and standing beside it puts its box
 * behind the eye; the chest fills the view and every tap on it did nothing.
 * A target no larger than its `upClose` takes taps from inside its box (or
 * within a hair of it: the eye sits on a chest's floor, and just under it
 * once the view tilts up), with its box behind the eye, and at any size on
 * screen, in any mode. Where it draws is still the test: from inside, the
 * ray is cast from a little way in from the eye (the floor the eye sits on
 * would have every ray graze the walls), so a tap on the world seen under
 * or past it misses the chest as before.
 *
 * A shard or avatar dimmed in build mode, because it stands between the
 * camera and the build cursor, takes no taps either (`occluder`; arkinox,
 * 2026-11-09): the tap passes through to what is behind it, as it would
 * through glass. Asked at each tap (BuildOccluders tapsPassThrough), so the
 * target never holds a state of its own that could outlive the dim.
 *
 * A shard with no solid surface, only fog, glow or points, is hit on its
 * pick volume (scene/softPick.tsx), and a hit there is soft: it takes the tap
 * only when no other target under the same tap would take it with a solid
 * hit nearer (softYields), so a solid shard in front of a fog, or standing
 * in its front, still wins, and nothing invisible ever blocks what is seen;
 * a solid target whose box is met first leaves the tap to a fog in front of
 * what it drew (solidYields).
 *
 * What is hidden behind blocks cannot be tapped either (TapOccluder.tsx;
 * owner, 2026-11-26): a target whose claim lies beyond the blocks' hit under
 * the same tap leaves it to them, in every mode, and tapClaimNearer answers
 * TERRAIN the other way round, so a block behind a shard is not mined by a
 * tap the shard took.
 *
 * farCullDoublings below is the guaranteed form of the same idea for shards
 * zoomed far out: past that many doublings no shard of its own geometry can
 * show MIN_VISIBLE_PX at any camera distance, so it is not drawn at all.
 */

import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { BackSide, Box3, FrontSide, Mesh, PerspectiveCamera, Raycaster, Vector3, type Camera, type Intersection, type Material, type Object3D, type Ray } from 'three'
import { CAMERA_NEAR, FOV } from './camera'
import { markSceneTapHandled } from '../hooks/useCanvasTap'
import { tapsPassThrough } from './BuildOccluders'
import { hitDepth, isSoftHit } from './softPick'
import { blockedNearer, idleOccluder } from './TapOccluder'

/** Below this many pixels across, an object is a speck and takes no taps. */
export const MIN_VISIBLE_PX = 4
/** The smallest target a visible object gets, in pixels: a fingertip. */
export const MIN_TARGET_PX = 28
/**
 * How far a press may travel and still be a tap, in pixels: the same
 * allowance useCanvasTap gives the scene, so a thumb that drifts a little
 * does not open nothing at all.
 */
export const TAP_SLOP_PX = 12
/**
 * Past this many pixels across, a shard's box is mostly air around it, so a
 * tap must land on what it draws: a face, or within PRECISE_SLOP_PX of a point
 * or line. Smaller shards keep the fingertip box, since their geometry is too
 * small to hit exactly (arkinox, 2026-10-02: the palm tree's box took every
 * tap meant for the coin between its fronds).
 */
export const PRECISE_ABOVE_PX = 3 * 28
/** How near a point or line a tap must land, in pixels, when the hit must be exact. */
export const PRECISE_SLOP_PX = 12
/**
 * How close to a chest-sized box (`upClose`) the eye may be, as a share of
 * its longest side, and still count as inside it: WALK's eye is the cell
 * centre, a chest's floor, and drops a hair under it as the view tilts up.
 */
export const NEAR_INSIDE = 0.02

/** Wider than this many screens, a shard is something you are inside, not something to tap. */
export const MAX_SCREENS = 2
/**
 * The tallest viewport the far bound is worked out for, in CSS pixels: a 4K
 * screen. A taller one would only make the bound more generous than needed.
 */
export const MAX_VIEWPORT_PX = 2160

/** Scratch for placing a target, which runs for every target at every tap: nothing is allocated there. */
const scratch = new Vector3()

/** Whether the last traverse met a soft pick; hoisted, so a placement allocates nothing. */
let found = false
function findSoft(o: Object3D): void { if (isSoftHit(o)) found = true }

const corner = new Vector3()
/**
 * The widest side of a box's outline on screen, in pixels, from its eight
 * corners; null when any corner is at or behind the camera, which means the
 * box reaches round the view.
 */
function screenAcross(b: Box3, cam: PerspectiveCamera, width: number, height: number): number | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)
    corner.applyMatrix4(cam.matrixWorldInverse)
    if (corner.z >= 0) return null
    corner.applyMatrix4(cam.projectionMatrix)
    const x = ((corner.x + 1) / 2) * width
    const y = ((1 - corner.y) / 2) * height
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  return Math.max(maxX - minX, maxY - minY)
}

/** No shard is culled nearer than a model of this many units would be, whatever its own size. */
export const CULL_EXTENT_MIN = 64

/**
 * How many doublings past a shard's own unit the view can zoom out before the
 * shard cannot show MIN_VISIBLE_PX at any distance, for a shard with no
 * placed objects. Worked out from the worst case rather than chosen: a model
 * `extent` each side of the origin (2 x extent + 1 units per axis, measured
 * along the diagonal), as close to the camera as anything is drawn
 * (CAMERA_NEAR), on a MAX_VIEWPORT_PX tall screen. At the usual size it is 22:
 * a shard of up to 64 units at unit 2^X is never visible from 2^(X + 22) out.
 * A larger shard (the bound is 4,096 units since 2026-11-23, DECK-0003 §1.8)
 * earns its own bound, a doubling per doubling of its size, and only for
 * itself: one very large shard does not make the whole world keep every shard
 * drawn six doublings further out. Placed objects carry their own unit and
 * scale step, up to 2^84 whatever their parent's unit, so a shard with any is
 * never culled by this bound; its taps still follow the measured size.
 */
export function farCullDoublings(extent: number = CULL_EXTENT_MIN): number {
  const span = Math.sqrt(3) * (2 * Math.max(CULL_EXTENT_MIN, extent) + 1)
  return Math.ceil(Math.log2((span * pxPerUnit(FOV, MAX_VIEWPORT_PX, CAMERA_NEAR)) / MIN_VISIBLE_PX))
}

/** Pixels per world unit at `distance` from a perspective camera. */
export function pxPerUnit(fovDeg: number, viewportHeightPx: number, distance: number): number {
  return viewportHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360) * Math.max(distance, 1e-9))
}

/**
 * The target box's size along one axis, in world units: the drawn size,
 * widened to MIN_TARGET_PX when smaller; null when the drawn extent is under
 * MIN_VISIBLE_PX, which means no target at all.
 */
export function targetSpan(drawn: [number, number, number], pxPerWorld: number, viewportPx = Infinity): [number, number, number] | null {
  const across = Math.max(...drawn) * pxPerWorld
  if (!(across >= MIN_VISIBLE_PX)) return null
  if (across > MAX_SCREENS * viewportPx) return null
  const floor = MIN_TARGET_PX / pxPerWorld
  return drawn.map((d) => Math.max(d, floor)) as [number, number, number]
}

interface Props {
  onTap: () => void
  /** The drawn object to measure (a shard). */
  measure?: RefObject<Object3D>
  /** A fixed on-screen size instead, in pixels, centred at `at` (a message's mark). */
  px?: number
  /** With `px`: never smaller than this, in render units, so a mark that is a size in the world (a message's box) takes a tap anywhere over it up close. */
  side?: number
  at?: [number, number, number]
  /**
   * Take the tap only when nothing else under it wants it: your own avatar
   * (arkinox, 2026-10-12). It stands where you are, which is where the
   * cursor, the shard you stand in, the stop you board from and the planet
   * you landed on all are, so it must never take a tap that one of those
   * would have had; it gets the taps that would otherwise have only toggled
   * the controls.
   */
  yields?: boolean
  /**
   * The key its drawn object is registered under among what may block the
   * build cursor (BuildOccluders): while that is dimmed, the target takes no
   * rays, and a tap reaches what is behind it.
   */
  occluder?: string
  /**
   * The largest its drawn box may be, in render units, and still take taps
   * from up close: from inside the box, with the box reaching behind the
   * eye, or wider than MAX_SCREENS screens. A chest or a door (LookMark);
   * absent, a shard's rules (what surrounds you is not a thing to tap).
   */
  upClose?: number
}

/**
 * Whether a yielding target leaves the tap to something else the same ray
 * hit: anything else in the scene with a tap handler (R3F's intersections
 * hold only objects that have one). `self` is the yielding target's own mesh.
 */
export function yieldsTap(intersections: ReadonlyArray<{ object: unknown }>, self: unknown): boolean {
  // Blocks behind it that a tap means nothing on (outside TERRAIN) leave it the tap; nearer, they stopped it first (TapOccluder.tsx).
  return intersections.some((i) => i.object !== self && !idleOccluder(i.object as Object3D))
}

/** What a target would take a tap at: how far along the ray (for a soft hit, how deep the fog's body lies there), and whether only on something soft (a pick volume, softPick.tsx). */
export interface TapClaim {
  distance: number
  soft: boolean
}

/** How a target judges a ray it was hit by, `boxDistance` being where the ray met its box: its claim, or null when it would let the tap through. Kept on the target mesh's userData as `tapJudge`. */
export type TapJudge = (ray: Ray, boxDistance: number) => TapClaim | null

/** One of R3F's intersections under a tap: what was hit, how far, and the object whose handler it reaches. */
export interface TapHit {
  object: Object3D
  distance: number
  eventObject?: Object3D
}

/**
 * Whether something without a tap target of its own (a transit stop, the
 * Earth) takes a click where it was hit: it has an onClick (R3F keeps an
 * object's handlers on its instance, `__r3f.handlers`). Its handler may still
 * decline (a stop answers only when its own dots are the first thing under
 * the tap), and then the tap is lost, as it already is behind a shard's box.
 */
function clickable(i: TapHit): boolean {
  const handlers = ((i.eventObject ?? i.object) as { __r3f?: { handlers?: Record<string, unknown> } }).__r3f?.handlers
  return typeof handlers?.onClick === 'function'
}

/**
 * Whether a soft claim at `distance` gives way: something else under the same
 * tap (`intersections`, R3F's, nearest first) would take it with a solid hit
 * nearer: another target's solid claim, or anything else with a click
 * handler, where its ray hit lies. R3F calls the handlers nearest box first,
 * so the one that gives way leaves the event travelling, and that one,
 * further along, takes it.
 */
export function softYields(intersections: ReadonlyArray<TapHit>, self: unknown, ray: Ray, distance: number): boolean {
  for (const i of intersections) {
    if (i.object === self) continue
    const judge = i.object.userData?.tapJudge as TapJudge | undefined
    if (!judge) {
      if (clickable(i) && i.distance < distance) return true
      continue
    }
    const other = judge(ray, i.distance)
    if (other && !other.soft && other.distance < distance) return true
  }
  return false
}

/**
 * Whether a solid claim at `distance` gives way: another target under the same
 * tap has a soft claim nearer, a fog standing in front of what this target
 * drew. A large solid's box can be met first (an arch or a courtyard round a
 * fog), and R3F would call it first; without this it would take a tap meant
 * for the fog in front of its far wall. Only targets that hold something soft
 * are asked (`tapSoft`), so solid against solid is as it was.
 */
export function solidYields(intersections: ReadonlyArray<TapHit>, self: unknown, ray: Ray, distance: number): boolean {
  for (const i of intersections) {
    if (i.object === self || i.object.userData?.tapSoft !== true) continue
    const judge = i.object.userData.tapJudge as TapJudge | undefined
    const other = judge?.(ray, i.distance)
    if (other && other.soft && other.distance < distance) return true
  }
  return false
}

const claimHits: Intersection[] = []

/**
 * Whether a tap target along `raycaster`'s ray would claim a tap nearer than
 * `distance` (render units): what TERRAIN asks before it mines or places by
 * a press, so a block behind a shard is never mined by the tap the shard
 * takes (the nearest thing wins, as TapOccluder.tsx has it for the shard).
 * `objects` are R3F's (its `internal.interaction`); only tap targets are
 * asked, each with its own raycast and judge, as R3F's click would. One ray,
 * asked at a press, or a few times a second for the cursor.
 */
export function tapClaimNearer(raycaster: Raycaster, objects: ReadonlyArray<Object3D>, distance: number): boolean {
  for (const o of objects) {
    const judge = o.userData?.tapJudge as TapJudge | undefined
    if (!judge) continue
    claimHits.length = 0
    o.raycast(raycaster, claimHits)
    for (const h of claimHits) {
      if (h.distance >= distance) continue
      const claim = judge(raycaster.ray, h.distance)
      if (claim && claim.distance < distance) { claimHits.length = 0; return true }
    }
  }
  claimHits.length = 0
  return false
}

/** A yielding target's claim to another target: none. */
function noClaim(): null { return null }

/** The view a target is placed for: R3F's store, as `get()` hands it over. */
export interface TapView {
  camera: Camera
  size: { width: number; height: number }
  internal?: { lastEvent: { current: Event | null } }
}

/** What a target is measured from: its props. */
export interface TapSpec {
  measure?: RefObject<Object3D>
  px?: number
  /** With `px`, the least it is in render units (Props `side`). */
  side?: number
  at?: [number, number, number]
  /** Its key among what may block the build cursor: dimmed, it takes no rays. */
  occluder?: string
  /** Up to this size (render units) it takes taps up close (Props `upClose`). */
  upClose?: number
}

/**
 * What placing a target leaves for its tap handler: how wide the shard is on
 * screen as last drawn, and the world size of a pixel at its distance, which
 * decide whether a tap must hit the geometry itself.
 */
export interface TapMeasure {
  across: number
  perPxWorld: number
  /**
   * The eye is inside its box (a chest you stand in, `upClose`). WALK's eye
   * is the walker's cell centre, which is a chest's floor, so a ray from it
   * grazes the walls and passes out under them: the exact test is cast from
   * `inner` instead, a quarter of the way from the eye to the box's centre.
   */
  around?: boolean
  inner?: Vector3
  /** What it draws holds something soft (a pick volume, softPick.tsx): measured with the box. */
  soft?: boolean
}

/**
 * A target's raycast: it places and sizes the target for the view as last
 * drawn, then raycasts it, or takes no ray when the target takes no taps.
 *
 * The target is placed when a ray asks for it, not every frame. R3F raycasts
 * a target with no hover handler on press, release, click, right click,
 * double click and wheel, never on a plain pointer move, so measuring every
 * shard and every avatar every frame was work for a tap that mostly never
 * came: with forty people and forty-one shards in view it was 81 bounding
 * boxes a frame (arkinox, 2026-10-20: the laptop "still isn't great"). A wheel
 * turn is a zoom, never a tap, and no target has a wheel handler, so a wheel
 * ray is refused before anything is measured. Asked at the tap, the
 * measurement is of the geometry and camera as last drawn, which is what the
 * eye is aiming at; a mark whose place a render has just changed answers
 * there, at most one frame ahead of its picture.
 */
export function tapRaycast(view: () => TapView, spec: { current: TapSpec }, out: TapMeasure): (this: Mesh, raycaster: Raycaster, intersects: Intersection[]) => void {
  const box = new Box3()
  const centre = new Vector3()
  const size = new Vector3()

  /** Places and sizes the target `m`; false when it takes no taps. */
  const place = (m: Mesh): boolean => {
    if (!m.parent) return false
    const { measure, px, side, at, occluder, upClose } = spec.current
    // Dimmed in build mode: see-through, and so tapped through. Left out of
    // the ray's hits altogether, so nothing else under the tap (a yielding
    // avatar, a large shard's exact test) counts it either.
    if (tapsPassThrough(occluder)) return false
    const { camera, size: screen } = view()
    const cam = camera as PerspectiveCamera
    const fov = cam.fov ?? 50

    if (px !== undefined) {
      if (at) centre.set(at[0], at[1], at[2]); else centre.set(0, 0, 0)
      m.parent.localToWorld(centre)
      const perPx = 1 / pxPerUnit(fov, screen.height, cam.position.distanceTo(centre))
      if (at) m.position.set(at[0], at[1], at[2]); else m.position.set(0, 0, 0)
      const finger = px * perPx
      m.scale.setScalar(Math.max(finger, side ?? 0))
      // A mark (a message or a coin) held to a fingertip is a deliberate,
      // fixed-size target, and wins over a shard's box when a tap passes
      // through both. A message's box larger than that (`side`) is a thing in
      // the place like the rest ('box'): a measured target gives it the tap
      // only where the box is hit nearer than what that target draws. As
      // large as the view up close, it would otherwise take every tap meant
      // for a chest, a shard or a person in front of it; and a room or a
      // tile it stands in still gives way to it, since their faces under the
      // tap are behind the box.
      m.userData.tapPriority = finger >= (side ?? 0) ? 'mark' : 'box'
      m.updateWorldMatrix(false, false)
      return true
    }

    const drawn = measure?.current
    if (!drawn) return false
    // Measured at every tap, from the geometry as it is drawn now: a shard
    // clipped to its region changes shape with the zoom, and a measurement
    // even a few frames old kept a target alive over nothing (arkinox,
    // 2026-10-01: still tappable at 2^9 after vanishing at 2^5). The cost is
    // one cached bounding box per child geometry.
    box.setFromObject(drawn)
    if (box.isEmpty()) return false
    box.getCenter(centre)
    box.getSize(size)
    // A chest or a door up close is still a thing to tap (`upClose`); a shard is not.
    const longest = Math.max(size.x, size.y, size.z)
    const near = upClose !== undefined && longest <= upClose
    // Inside the shard: it surrounds the view, so it is not a thing to tap.
    // A chest's floor is WALK's eye height, and the eye is WALK_EYE behind
    // the cell centre, so a view tilted up puts it a hair under the floor:
    // within NEAR_INSIDE of its size counts as inside, and the box grows by
    // that much so the eye is truly in it.
    const hair = near ? NEAR_INSIDE * longest : 0
    const inside = box.containsPoint(cam.position) || (near && box.distanceToPoint(cam.position) <= hair)
    if (inside && !near) return false
    if (inside) { box.expandByScalar(hair); box.getCenter(centre); box.getSize(size) }
    // How wide the box really is on screen, from its eight corners: the
    // distance to its centre understates a large box, whose near face is
    // much closer than its middle. A corner behind the camera means the box
    // reaches round the view, which is too big to tap.
    const wide = screenAcross(box, cam, screen.width, screen.height)
    if (wide === null && !near) return false
    // Up close it is as wide as the view or wider: a tap must land where it draws (PRECISE_ABOVE_PX).
    const across = wide ?? Infinity
    const viewport = Math.max(screen.width, screen.height)
    const perWorld = pxPerUnit(fov, screen.height, cam.position.distanceTo(centre))
    out.across = across
    out.perPxWorld = 1 / perWorld
    out.around = inside
    if (inside) (out.inner ??= new Vector3()).copy(cam.position).lerp(centre, 0.25)
    // targetSpan's rule, worked in place: it once ran per shard per frame,
    // and the arrays targetSpan returns were a steady stream of garbage
    // (2026-10-14); it now runs for every target at every tap.
    const largest = Math.max(size.x, size.y, size.z) * perWorld
    if ((across > MAX_SCREENS * viewport && !near) || !(largest >= MIN_VISIBLE_PX)) return false
    // Whether what it draws holds anything soft, asked only of a target that takes the ray.
    found = false
    drawn.traverse(findSoft)
    out.soft = found
    m.userData.tapSoft = found
    // From inside its box a ray meets only the box's back faces.
    ;(m.material as Material).side = inside ? BackSide : FrontSide
    const floor = MIN_TARGET_PX / perWorld
    // The box is measured in world space; the target lives in its parent's.
    m.position.copy(m.parent.worldToLocal(scratch.copy(centre)))
    m.scale.set(Math.max(size.x, floor), Math.max(size.y, floor), Math.max(size.z, floor))
    m.updateWorldMatrix(false, false)
    return true
  }

  return function raycast(this: Mesh, raycaster: Raycaster, intersects: Intersection[]): void {
    if (view().internal?.lastEvent.current?.type === 'wheel') return
    if (place(this)) Mesh.prototype.raycast.call(this, raycaster, intersects)
  }
}

export function TapTarget({ onTap, measure, px, side, at, yields = false, occluder, upClose }: Props): JSX.Element {
  const hit = useRef<Mesh>(null)
  const get = useThree((s) => s.get)
  const precise = useRef(new Raycaster())
  // What the measurement reads, kept to the committed props: the raycast
  // below is made once, and a render React throws away must not move it.
  const spec = useRef<TapSpec>({ measure, px, side, at, occluder, upClose })
  useLayoutEffect(() => {
    spec.current.measure = measure
    spec.current.px = px
    spec.current.side = side
    spec.current.at = at
    spec.current.occluder = occluder
    spec.current.upClose = upClose
  })
  const measured = useRef<TapMeasure>({ across: 0, perPxWorld: 0 })
  const raycast = useMemo(() => tapRaycast(get as () => TapView, spec, measured.current), [get])

  /**
   * Where along `ray` this target would take a tap, as last placed for it,
   * and whether only on something soft; null when it lets the tap through.
   * A large shard is hit only where it draws, so the air inside its box lets
   * the tap through to whatever is behind; a small one is hit on its box,
   * soft only when what the ray meets inside it first is soft.
   */
  const judge = (ray: Ray, boxDistance: number): TapClaim | null => {
    if (yields || !measure) return { distance: boxDistance, soft: false }
    const drawn = measure.current
    if (!drawn) return { distance: boxDistance, soft: false }
    const { around, inner } = measured.current
    const exact = around || measured.current.across > PRECISE_ABOVE_PX
    const r = precise.current
    r.set(around && inner ? inner : ray.origin, ray.direction)
    const slop = PRECISE_SLOP_PX * measured.current.perPxWorld
    r.params.Points = { threshold: slop }
    r.params.Line = { threshold: slop }
    const hits = r.intersectObject(drawn, true)
    // A small target is hit on its box: soft when what it draws is (the fingertip round a speck of fog).
    if (hits.length === 0) return exact ? null : { distance: boxDistance, soft: measured.current.soft === true }
    const first = hits[0]
    if (!exact && !isSoftHit(first.object)) return { distance: boxDistance, soft: false }
    // Measured from the eye (the ray from `inner`, a chest stood in, starts nearer).
    return isSoftHit(first.object) ? { distance: hitDepth(first, ray.origin), soft: true } : { distance: first.point.distanceTo(ray.origin), soft: false }
  }
  // What another target under the same tap reads (softYields). One that yields never takes a tap from another, so it claims nothing there.
  useLayoutEffect(() => {
    if (hit.current) hit.current.userData.tapJudge = yields ? noClaim : judge
  })

  const tap = (e: ThreeEvent<MouseEvent>): void => {
    if (e.delta > TAP_SLOP_PX) return
    // Not stopping propagation is how R3F lets the tap travel on to the
    // next thing the ray hit, nearer or farther.
    if (yields && yieldsTap(e.intersections, hit.current)) return
    // A coin or message under the same tap takes it: leave the event to
    // travel on to it (not stopping propagation is how R3F does that).
    if (measure && e.intersections.some((i) => i.object.userData?.tapPriority === 'mark')) return
    const claim = judge(e.ray, e.distance)
    if (!claim) return
    // A message's box met before what this target draws takes the tap: leave it to travel on to the box.
    if (measure && e.intersections.some((i) => i.object.userData?.tapPriority === 'box' && i.distance < claim.distance)) return
    // Blocks in front of what it draws hide it: the tap is theirs (TapOccluder.tsx), however near its box was met.
    if (blockedNearer(e.intersections, claim.distance)) return
    // Fog, glow or points: a solid thing hit nearer under the same tap takes it;
    // and a solid one leaves it to a fog that stands in front of what it drew.
    if (claim.soft ? softYields(e.intersections, hit.current, e.ray, claim.distance) : solidYields(e.intersections, hit.current, e.ray, claim.distance)) return
    e.stopPropagation()
    markSceneTapHandled()
    onTap()
  }

  return (
    // Not drawn: a target is only ever raycast, and three and R3F both
    // raycast an object whatever its `visible`. Drawn, at opacity 0, every
    // shard paid a transparent draw call and a place in the per-frame
    // transparent sort for nothing (2026-10-14).
    <mesh ref={hit} onClick={tap} raycast={raycast} visible={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}
