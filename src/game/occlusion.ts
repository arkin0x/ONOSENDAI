/**
 * occlusion.ts - the game camera never loses you behind a wall.
 *
 * arkinox, 2026-11-23: "in the tutorial game, let's fade the wall between the
 * camera and the player so we don't get out of bounds blockage like this"
 * (the whole screen grey wall faces, the camera behind a wall).
 *
 * Two parts, the way third-person games commonly handle it:
 *
 * 1. FADE. A world shard that stands between the camera and you is drawn
 *    see-through where it is in the way: a dithered cut-out round the line
 *    of sight. Dithered (a share of the pixels thrown away, in an ordered
 *    pattern), not blended, so the faces stay opaque to the renderer: no
 *    sorting, no depth trouble, no material made again. A dungeon piece is
 *    one shard holding a whole cell, floor and walls, so the fade is not the
 *    whole shard: only the part within a cone round the line from the eye
 *    to you (FADE_RADIUS at you), nearer the eye than you are, and above
 *    your feet, so the floor you stand on is never cut and the rest of the
 *    room stays as it is.
 *    Which shards block is the build dim's own test (lib/occluders.ts): rays
 *    from the eye to your body, its centre and its corners, against the
 *    shards' faces, at most every RECOMPUTE_MS and only when something moved.
 *    A blocking shard's fade eases in over FADE_MS and back out once it has
 *    not blocked for HOLD_MS, so an edge grazed on and off does not flicker.
 *
 * 2. PULL-IN. The cut runs right back to the eye, so a camera inside a
 *    wall sees you through it too. What fading cannot help is the ground: a camera
 *    pitched down under the floor (the floor is never cut, see above). There
 *    the camera arm is shortened toward you, to just above the floor, as a
 *    spring arm does (`armShare`), and eased back out once the way is clear.
 *    Only the ground: the dungeon's pieces are not closed solids (a wall can
 *    be a single face, the entry star a flat one), so telling "inside a
 *    wall" by counting the faces crossed is not reliable, and a spring arm
 *    on every wall would leave nothing to fade, which the owner asked for.
 *
 * Rendering only. Collision is the game's (lib/games/play.ts) and is never
 * read or changed here: a faded wall stops you as before.
 *
 * Per frame: a few uniform writes and nothing allocated. The shader patch is
 * applied once per material, when its shard is first registered, so no
 * program is compiled the moment a wall starts to fade.
 */

import { DoubleSide, Matrix4, Vector3, type Material, type Mesh, type Object3D, type WebGLProgramParametersWithUniforms } from 'three'
import { bvhOf, cellPoints, fadeToward, nineVectors, pickWithin, rayCrossings, settleDimmed, type OccluderTarget } from '../lib/occluders'

/**
 * How far from the line of sight a blocking face is cut, in gibsons, at your
 * distance; nearer the eye in proportion, a cone with its tip at the eye, so
 * the hole is one size on screen wherever the wall stands, and a wall the
 * camera only runs alongside is not cut where it passes the lens. Soft from
 * FADE_SOFT of it outward.
 */
export const FADE_RADIUS = 1.1
export const FADE_SOFT = 0.55
/** The share of a faded face's pixels kept, so the wall still reads as there: the build dim's DIM (scene/BuildOccluders.tsx). */
export const FADE_KEEP = 0.2
/** How long a fade takes, in or out, ms. */
export const FADE_MS = 180
/** How long a shard stays faded after it stops blocking, ms. */
export const HOLD_MS = 150
/** The most often the blockers and the arm are worked out, ms. */
export const RECOMPUTE_MS = 50
/** The cut stops this short of your centre, in gibsons, so what stands beyond you is never cut. */
export const CUT_END = 0.45
/**
 * Never cut below your centre by this much, in gibsons: the floor. You stand
 * one gibson over the face that holds you (lib/games/gravity.ts standing), so
 * the floor is at least this far down, and your body (0.3 down) is above it.
 */
export const FEET_CLEAR = 0.75
/** Half your body's size, as the rays aim at it (GameView Player is 0.6 across). */
export const BODY_HALF = 0.27
/** How far in front of a face the pulled-in camera stops, and the shortest arm, in gibsons. */
export const ARM_MARGIN = 0.25
export const ARM_MIN = 0.6
/** How far the eye or you may move, in gibsons, before the rays are cast again. */
const MOVE_EPSILON = 1e-3

/** The uniforms every patched material of one game canvas shares; `uGfLevel` is each shard's own. */
export interface FadeShared {
  uGfEye: { value: Vector3 }
  uGfTarget: { value: Vector3 }
  uGfEnd: { value: number }
  uGfFloor: { value: number }
  uGfRadius: { value: number }
  uGfSoft: { value: number }
  uGfKeep: { value: number }
}

const MARK = '// game occlusion fade'

const DITHER_GLSL = /* glsl */ `
float gfBayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float gfBayer4(vec2 a) { return gfBayer2(0.5 * a) * 0.25 + gfBayer2(a); }
`

/**
 * What the shader computes, here for the tests: the share of a fragment's
 * pixels thrown away at world point `p`, 0 (drawn) to 1 - keep, at a shard
 * fade `level`. Mirrors the GLSL in `patchOcclusionFade` term for term.
 */
export function cutShare(p: Vector3, eye: Vector3, target: Vector3, end: number, floor: number, level: number, radius = FADE_RADIUS, soft = FADE_SOFT, keep = FADE_KEEP): number {
  if (level <= 0) return 0
  const abx = target.x - eye.x, aby = target.y - eye.y, abz = target.z - eye.z
  const len = Math.max(Math.hypot(abx, aby, abz), 1e-6)
  const px = p.x - eye.x, py = p.y - eye.y, pz = p.z - eye.z
  const s = (px * abx + py * aby + pz * abz) / len
  const c = Math.min(Math.max(s, 0), len) / len
  const d = Math.hypot(px - abx * c, py - aby * c, pz - abz * c)
  const r = Math.max(radius * c, 1e-3)
  const smooth = (e0: number, e1: number, x: number): number => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t) }
  return level * (1 - keep) * (1 - smooth(r * soft, r, d)) * (1 - smooth(end - 0.2, end, s)) * (p.y >= floor ? 1 : 0)
}

/**
 * Patches a face or point material's shader with the cut-out: the world
 * position carried to the fragment, and the fragment thrown away by an
 * ordered 4x4 dither where `cutShare` says. Anchored on three's clipping
 * chunks, which three's Lambert shader and the point disc (scene/pointDisc)
 * both include once; a shader without them is left as it was, and says so.
 */
export function patchOcclusionFade(shader: Pick<WebGLProgramParametersWithUniforms, 'vertexShader' | 'fragmentShader' | 'uniforms'>, shared: FadeShared, level: { value: number }): boolean {
  if (shader.fragmentShader.includes(MARK)) return true
  const once = (src: string, anchor: string): boolean => src.split(anchor).length === 2
  const anchors: Array<[string, string]> = [
    [shader.vertexShader, '#include <clipping_planes_pars_vertex>'],
    [shader.vertexShader, '#include <clipping_planes_vertex>'],
    [shader.fragmentShader, '#include <clipping_planes_pars_fragment>'],
    [shader.fragmentShader, '#include <clipping_planes_fragment>'],
  ]
  if (!anchors.every(([src, a]) => once(src, a))) {
    if (!warned) console.warn('[game] a shard shader is not the one expected; walls in the way are not faded')
    warned = true
    return false
  }
  Object.assign(shader.uniforms, shared, { uGfLevel: level })
  shader.vertexShader = shader.vertexShader
    .replace('#include <clipping_planes_pars_vertex>', '#include <clipping_planes_pars_vertex>\nvarying vec3 vGfWorld;')
    .replace('#include <clipping_planes_vertex>', '#include <clipping_planes_vertex>\n\tvGfWorld = (modelMatrix * vec4(position, 1.0)).xyz;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>
${MARK}
varying vec3 vGfWorld;
uniform vec3 uGfEye;
uniform vec3 uGfTarget;
uniform float uGfEnd;
uniform float uGfFloor;
uniform float uGfRadius;
uniform float uGfSoft;
uniform float uGfKeep;
uniform float uGfLevel;
${DITHER_GLSL}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
	if (uGfLevel > 0.0) {
		vec3 gfAb = uGfTarget - uGfEye;
		float gfLen = max(length(gfAb), 1e-6);
		vec3 gfP = vGfWorld - uGfEye;
		float gfS = dot(gfP, gfAb) / gfLen;
		float gfC = clamp(gfS, 0.0, gfLen) / gfLen;
		float gfD = length(gfP - gfAb * gfC);
		float gfR = max(uGfRadius * gfC, 1e-3);
		float gfCut = uGfLevel * (1.0 - uGfKeep)
			* (1.0 - smoothstep(gfR * uGfSoft, gfR, gfD))
			* (1.0 - smoothstep(uGfEnd - 0.2, uGfEnd, gfS))
			* step(uGfFloor, vGfWorld.y);
		if (gfCut > 0.0 && gfBayer4(gl_FragCoord.xy) + 0.03125 < gfCut) discard;
	}`)
  return true
}
let warned = false

/** The one compile hook every patched material shares: it reads its shard's uniforms off the material (`userData.gameFade`). */
function fadeHook(this: Material, shader: WebGLProgramParametersWithUniforms): void {
  const f = this.userData.gameFade as { shared: FadeShared; level: { value: number } } | undefined
  if (f) patchOcclusionFade(shader, f.shared, f.level)
}
const fadeKey = (): string => 'game-occlusion-fade-1'

/**
 * Where on the arm from `focus` to `want` the camera may stand, as a share of
 * the arm (1: all of it), from the `n` faces it crosses: `ts` where, as
 * shares of the arm, `ys` at what height. A crossing below `floor` is ground,
 * which the fade never cuts, so the camera stops at the nearest of them;
 * every other face is left to the fade.
 */
export function armShare(ts: ArrayLike<number>, ys: ArrayLike<number>, n: number, floor: number): number {
  let share = 1
  for (let i = 0; i < n; i++) if (ys[i] < floor && ts[i] < share) share = ts[i]
  return share
}

/** One registered shard: its group, and its fade level as the shader reads it. */
interface Entry extends OccluderTarget {
  level: { value: number }
}

// Hoisted, so a frame allocates nothing.
const body = nineVectors()
const inv = new Matrix4()
const fL = new Vector3()
const wL = new Vector3()
const CAP = 64
const crossT = new Float64Array(CAP)
const crossY = new Float64Array(CAP)
let crossN = 0
let armFrom: Vector3 = new Vector3()
let armTo: Vector3 = new Vector3()

/** One object of a shard, its face crossings along the arm added to crossT (unsorted; armShare takes the nearest that counts). */
function crossOne(o: Object3D): void {
  if (!(o as Mesh).isMesh) return
  const mesh = o as Mesh
  const g = mesh.geometry
  if (!g?.attributes?.position || !mesh.material || (g as { isInstancedBufferGeometry?: boolean }).isInstancedBufferGeometry) return
  const b = bvhOf(g)
  if (!b || crossN >= CAP) return
  inv.copy(mesh.matrixWorld).invert()
  fL.copy(armFrom).applyMatrix4(inv)
  wL.copy(armTo).applyMatrix4(inv)
  // Either side: ground is ground seen from above or below, and only the nearest crossing is wanted.
  crossN += rayCrossings(b, fL.x, fL.y, fL.z, wL.x - fL.x, wL.y - fL.y, wL.z - fL.z, 1, DoubleSide, crossT, crossN)
}

let patchLevel: { value: number } | null = null
let patchShared: FadeShared | null = null

function patchOne(o: Object3D): void {
  const m = (o as { material?: Material | Material[] }).material
  if (!m) return
  if (Array.isArray(m)) m.forEach(patchMaterial)
  else patchMaterial(m)
}

function patchMaterial(m: Material): void {
  if (m.userData.gameFade || !patchLevel || !patchShared) return
  // Faces (lit Lambert) and the vertex dots (the disc shader); lines and anything else are left as they are.
  const kind = m as { isMeshLambertMaterial?: boolean; isShaderMaterial?: boolean; uniforms?: Record<string, unknown> }
  if (!kind.isMeshLambertMaterial && !(kind.isShaderMaterial && kind.uniforms && 'uOpacity' in kind.uniforms)) return
  m.userData.gameFade = { shared: patchShared, level: patchLevel }
  m.onBeforeCompile = fadeHook
  m.customProgramCacheKey = fadeKey
  m.needsUpdate = true
}

/**
 * One game canvas's occlusion: its registry of world shards, the uniforms
 * they share, and the work each frame (`frame`), called by the camera rig
 * once it has placed the camera.
 */
export class OcclusionFade {
  readonly shared: FadeShared = {
    uGfEye: { value: new Vector3() },
    uGfTarget: { value: new Vector3() },
    uGfEnd: { value: 0 },
    uGfFloor: { value: Infinity },
    uGfRadius: { value: FADE_RADIUS },
    uGfSoft: { value: FADE_SOFT },
    uGfKeep: { value: FADE_KEEP },
  }
  private entries: Entry[] = []
  private seen = new Map<string, number>()
  private blocking: ReadonlySet<string> = new Set()
  /** The faded set after the hold: what eases toward full fade. */
  faded: ReadonlySet<string> = new Set()
  private next = 0
  private computed = -Infinity
  private recheck = Infinity
  private lastEye = new Vector3(NaN, NaN, NaN)
  private lastTarget = new Vector3(NaN, NaN, NaN)
  private lastWant = new Vector3(NaN, NaN, NaN)
  private dirty = true
  /** The share of the arm the camera may use, from the last cast. */
  arm = 1

  /** Registers a world shard's group under `key`; the returned function takes it out. Its materials are patched now. */
  register(key: string, object: Object3D): () => void {
    const entry: Entry = { key, object, level: { value: 0 } }
    this.entries = [...this.entries.filter((e) => e.key !== key), entry]
    this.patch(entry)
    this.dirty = true
    return () => {
      this.entries = this.entries.filter((e) => e !== entry)
      this.dirty = true
    }
  }

  /** The fade level of the shard under `key`, 0 (solid) to 1 (faded); for tests and probes. */
  levelOf(key: string): number {
    return this.entries.find((e) => e.key === key)?.level.value ?? 0
  }

  private patch(e: Entry): void {
    patchLevel = e.level
    patchShared = this.shared
    e.object.traverse(patchOne)
    patchLevel = null
    patchShared = null
  }

  /**
   * One frame: `eye` the camera where it stands, `target` your centre,
   * `focus` and `want` the arm the rig would use (from what it looks at to
   * where it would put the camera), `now` in ms and `dtMs` since the last.
   * Casts when something moved, at most every RECOMPUTE_MS, which also
   * sets `arm` for the next frame; eases every shard's fade.
   */
  frame(eye: Vector3, target: Vector3, focus: Vector3, want: Vector3, now: number, dtMs: number): void {
    const s = this.shared
    s.uGfEye.value.copy(eye)
    s.uGfTarget.value.copy(target)
    s.uGfEnd.value = Math.max(0, eye.distanceTo(target) - CUT_END)
    s.uGfFloor.value = target.y - FEET_CLEAR
    const e2 = MOVE_EPSILON * MOVE_EPSILON
    const moved = this.dirty || Number.isNaN(this.lastEye.x) || eye.distanceToSquared(this.lastEye) > e2 || target.distanceToSquared(this.lastTarget) > e2 || want.distanceToSquared(this.lastWant) > e2
    if ((moved || now >= this.recheck) && now - this.computed >= RECOMPUTE_MS) {
      this.dirty = false
      this.computed = now
      this.lastEye.copy(eye); this.lastTarget.copy(target); this.lastWant.copy(want)
      this.cast(eye, target, focus, want, now)
    }
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]
      const goal = this.faded.has(e.key) ? 1 : 0
      if (e.level.value !== goal) e.level.value = fadeToward(e.level.value, goal, dtMs, FADE_MS, 1)
    }
  }

  private cast(eye: Vector3, target: Vector3, focus: Vector3, want: Vector3, now: number): void {
    // Who blocks: rays from the eye to your body, within a budget, as the build dim does.
    cellPoints(target, body, 0.5 - BODY_HALF)
    const picked = pickWithin(this.entries, eye, body, { budgetMs: 3, start: this.next, carry: this.blocking })
    this.next = picked.next
    this.blocking = picked.blocking
    if (!picked.done) this.dirty = true
    this.faded = settleDimmed(this.seen, picked.blocking, now, HOLD_MS)
    this.recheck = this.faded.size > picked.blocking.size ? now + HOLD_MS + 1 : Infinity
    // A shard drawn again since it was registered has new materials: patch what has not been.
    for (let i = 0; i < this.entries.length; i++) if (this.faded.has(this.entries[i].key)) this.patch(this.entries[i])
    this.arm = this.armFor(focus, want, target.y - FEET_CLEAR)
  }

  /** The share of the arm from `focus` to `want` the camera may use (armShare), never under ARM_MIN. */
  armFor(focus: Vector3, want: Vector3, floor: number): number {
    const len = focus.distanceTo(want)
    if (len <= ARM_MIN) return 1
    armFrom = focus; armTo = want
    crossN = 0
    for (let i = 0; i < this.entries.length; i++) this.entries[i].object.traverseVisible(crossOne)
    for (let i = 0; i < crossN; i++) crossY[i] = focus.y + (want.y - focus.y) * crossT[i]
    const share = armShare(crossT, crossY, crossN, floor)
    if (share >= 1) return 1
    return Math.max(ARM_MIN, share * len - ARM_MARGIN) / len
  }
}
