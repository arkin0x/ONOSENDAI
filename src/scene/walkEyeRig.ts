/**
 * walkEyeRig.ts - the WALK camera's eye, for the rig (Scene.tsx Rig).
 *
 * Each frame of WALK, and of the glide into and out of it, the rig asks where
 * the camera sits relative to the walker's point: the avatar's eye
 * (lib/avatarEye.ts walkEyeLocal), turned with the body about up only, and
 * pulled back along the line from the walker so it never looks from the far
 * side of a wall or a ceiling (store/walkWalls.ts eyeReach). The answer is in
 * render cells, ready to add to the orbit's target.
 *
 * The walls are asked from where the camera's line really starts, the eased
 * walker point the rig draws, measured from the centre of the walker's own
 * gibson (`lead`), so a step out from under a low ceiling keeps the eye under
 * it until the walker is out. The question is asked again when that point
 * moves by more than a sliver of the near plane's room, when the eye turns,
 * or when the walls are listed again: at most every ITEMS_MS, at once on a new
 * gibson, and on every frame while a shard in reach is still being built.
 */

import { Quaternion, Vector3 } from 'three'
import type { ShardModel } from 'sno-core/shards'
import { walkEyeLocal, yawFromForward } from '../lib/avatarEye'
import { spectatorScale } from '../lib/avatar'
import { csDirection } from '../lib/pose'
import type { AxisDirection, Position, ViewAxes } from '../lib/space'
import { eyeReach, wallItemsAt, type WallItem } from '../store/walkWalls'
import { CAMERA_NEAR } from './camera'

/**
 * How far from any face the eye keeps, in cells: three near planes. The near
 * plane's corners reach a little past CAMERA_NEAR on a phone's frustum, and a
 * face nearer than that is cut away, showing what is behind it.
 */
export const EYE_ROOM = 3 * CAMERA_NEAR

/** How long the walls a walker meets are kept before they are listed again, in milliseconds. */
const ITEMS_MS = 300

/** How finely the question's key tells one walker point or eye from another, as a share of EYE_ROOM. */
const KEY_STEP = 1 / 16

/** What one frame needs to know. */
export interface EyeFrame {
  /** The avatar worn, or null for the icosahedron. */
  shard: ShardModel | null
  scaleExp: number
  axes: ViewAxes
  plane: number
  /** The gibson the walk is heading to (the cursor). */
  cursor: Position
  /** The eased walker point less the centre of `cursor`'s gibson as drawn, render cells: a step under way, a fall between gibsons. */
  lead: readonly [number, number, number]
  /** Where the camera looks, render space: the body takes its heading. */
  forward: { x: number; y: number; z: number }
  /** Up for the walker, against gravity: a face it stands in holds an eye below it. */
  up: AxisDirection
  /** Whether to ask the walls: in WALK. Gliding out, the last answer stands. */
  walls: boolean
  /** Fluid WALK: the walker is drawn standing on the surface, between gibsons (store/walkFluid.ts groundFluid), and reached the way it stands there (eyeReach `stand`). */
  stand?: boolean
  now: number
}

export class WalkEyeRig {
  /** The body's turn: the heading, kept when looking straight up or down. */
  readonly body = new Quaternion()
  private items: WallItem[] = []
  private itemsKey = ''
  private itemsAt = -Infinity
  private askKey = ''
  private share = 1
  private pending = { pending: false }

  /** The eye's offset from the walker's point this frame, render cells, into `out`; the body's heading is updated too. */
  offset(f: EyeFrame, out: Vector3): Vector3 {
    yawFromForward(f.forward, this.body)
    const e = walkEyeLocal(f.shard, f.scaleExp, spectatorScale(f.scaleExp))
    out.set(e[0], e[1], e[2])
    if (out.lengthSq() === 0) return out
    out.applyQuaternion(this.body)
    if (f.walls) this.share = this.ask(f, out)
    return out.multiplyScalar(this.share)
  }

  /** Forget the walls and the answer: a new WALK starts afresh. */
  reset(): void {
    this.items = []
    this.itemsKey = ''
    this.itemsAt = -Infinity
    this.askKey = ''
    this.share = 1
  }

  private ask(f: EyeFrame, eye: Vector3): number {
    const g = 2 ** f.scaleExp
    const c = f.cursor
    const cell = `${f.plane}|${c.x},${c.y},${c.z}`
    if (cell !== this.itemsKey || f.now - this.itemsAt > ITEMS_MS) {
      this.items = wallItemsAt(f.plane, c)
      this.itemsKey = cell
      this.itemsAt = f.now
      this.askKey = ''
    }
    // Render cells to cyberspace gibsons: the view's axes, the zoom.
    const lead = csDirection(f.axes, [f.lead[0], f.lead[1], f.lead[2]]).map((v) => v * g) as [number, number, number]
    const off = csDirection(f.axes, [eye.x, eye.y, eye.z]).map((v) => v * g) as [number, number, number]
    const step = EYE_ROOM * g * KEY_STEP
    const q = (v: number): number => Math.round(v / step)
    const key = `${cell}|${f.scaleExp}|${f.up.axis}${f.up.dir}|${f.stand ? 's' : ''}|${lead.map(q).join(',')}|${off.map(q).join(',')}`
    if (key === this.askKey) return this.share
    const share = eyeReach(c, lead, off, EYE_ROOM * g, this.items, f.up, this.pending, f.stand === true)
    // A shard still being built is asked about again next frame; until then the eye stays at the walker.
    this.askKey = this.pending.pending ? '' : key
    return share
  }
}
