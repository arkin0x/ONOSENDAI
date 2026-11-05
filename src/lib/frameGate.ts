/**
 * frameGate.ts: whether a frame of the main view is worth drawing.
 *
 * A desktop's display asks for frames as fast as it runs: 144 a second at his
 * desk, whether or not anything on screen has changed. Standing still, each is the
 * same picture, at about 42 KB of garbage and all its GPU time. So when nothing is
 * moving the view draws at no more than 60 a second, and any input, any motion in
 * the scene and anything that animates brings back every frame the display offers,
 * on the very next one. The slow pulses of the terrain still run at 60.
 *
 * On a display of 60 Hz or less, every frame is drawn either way.
 *
 * No browser here, so a test can hold the rules. Scene/frameDriver.tsx applies them.
 */

/** The most an idle view draws: a frame per this many ms. */
export const IDLE_FRAME_MS = 1000 / 60
/** How long after anything happened the view stays at full rate. */
export const WAKE_HOLD_MS = 1000
/** How early an idle frame may land: a 60 Hz display's frame, a little early, must not be skipped. */
const IDLE_SLACK_MS = 2

export class FrameGate {
  private awakeUntil = Infinity
  private nextIdle = 0

  /** Something happened: every frame until WAKE_HOLD_MS after this. */
  wake(now: number): void {
    this.awakeUntil = now + WAKE_HOLD_MS
  }

  /** Whether to draw this display frame. `busy`: something is animating that a stamp cannot see (viewBusy). */
  shouldDraw(now: number, busy: boolean): boolean {
    if (this.awakeUntil === Infinity) this.awakeUntil = now + WAKE_HOLD_MS
    if (busy || now < this.awakeUntil) {
      this.nextIdle = now + IDLE_FRAME_MS
      return true
    }
    if (now < this.nextIdle - IDLE_SLACK_MS) return false
    // Kept on its own grid, so a display that does not divide 60 evenly still averages no more than it.
    const next = this.nextIdle + IDLE_FRAME_MS
    this.nextIdle = next > now ? next : now + IDLE_FRAME_MS
    return true
  }
}

/** As much of a three object as a stamp reads. */
interface Stampable {
  visible?: boolean
  matrixWorld?: { elements: ArrayLike<number> }
  material?: StampMaterial | StampMaterial[]
  geometry?: { attributes?: Record<string, { version?: number }>; drawRange?: { count: number } }
  count?: number
  children?: Stampable[]
}
interface StampMaterial {
  opacity?: number
  version?: number
  userData?: { ambient?: boolean }
  uniforms?: Record<string, { value?: unknown }>
}

// A number is mixed in by its bits. Arithmetic on the running value would round away
// the small changes this exists to see: a camera easing to rest moves a few millionths.
const bits = new Float64Array(1)
const words = new Uint32Array(bits.buffer)
let h = 0
const mix = (v: number): void => {
  bits[0] = v
  h = Math.imul(h ^ words[0], 0x01000193)
  h = Math.imul(h ^ words[1], 0x01000193)
}

function stampMaterial(m: StampMaterial): void {
  mix(m.opacity ?? 0)
  mix(m.version ?? 0)
  if (!m.uniforms || m.userData?.ambient) return
  for (const name in m.uniforms) {
    const v = m.uniforms[name].value
    if (typeof v === 'number') mix(v)
  }
}

function visit(o: Stampable): void {
  mix(o.visible === false ? 1 : 2)
  const e = o.matrixWorld?.elements
  if (e) { mix(e[0]); mix(e[1]); mix(e[5]); mix(e[12]); mix(e[13]); mix(e[14]) }
  const mat = o.material
  if (mat) {
    if (Array.isArray(mat)) { for (let i = 0; i < mat.length; i++) stampMaterial(mat[i]) }
    else stampMaterial(mat)
  }
  const attrs = o.geometry?.attributes
  if (attrs) for (const name in attrs) mix(attrs[name].version ?? 0)
  if (o.count !== undefined) mix(o.count)
  const kids = o.children
  if (kids) {
    mix(kids.length)
    for (let i = 0; i < kids.length; i++) visit(kids[i])
  }
}

/**
 * A number that changes when anything drawn changes: the camera, where each object
 * stands and how it is turned, its opacity, its material, its vertices, and any
 * number a shader is given. So whatever moves or animates wakes the view without
 * having to say so, and a new effect is awake by default. Only a material marked
 * `userData.ambient` keeps its uniforms out of this.
 */
export function sceneStamp(scene: Stampable, camera: Stampable): number {
  h = 0x811c9dc5
  visit(camera)
  visit(scene)
  return h
}

/** The events that mean a person is doing something. On the window, in the capture phase, so nothing can stop them first. */
export const WAKE_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'keydown', 'keyup', 'touchstart', 'touchmove', 'touchend', 'resize', 'focus'] as const
