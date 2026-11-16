/**
 * input.ts - DRONE RUN's controls, read by the runner once a fixed step.
 *
 * One module for every device. The keyboard, the mouse (pointer lock, or a
 * drag where the lock is refused) and the phone's controls (hud/TouchPad)
 * all write here; the runner calls readInput() once per step and gets the
 * simulation's RunInput; the camera reads lookState every frame, so the
 * view turns at the screen's rate even between steps.
 *
 * | Input | What it gives |
 * |---|---|
 * | W A S D, arrows (held) | move: fwd and strafe (+1 right on screen), each -1, 0 or 1 (the simulation accelerates them, fluid WALK's feel) |
 * | the phone's stick | move: analog, inside the unit circle (added to the keys, then kept inside it) |
 * | mouse with the lock, a drag without it, a drag on the phone's right half | yaw and pitch, absolute, in lookState |
 * | Space, JUMP | jump: an edge, true for the one step that reads it (in the air it is the double jump) |
 * | left button, FIRE (held) | fire: held (auto fires, the rail charges) |
 * | 1 2 3 | select: that gun, for the one step that reads it |
 * | Q, the wheel, the phone's gun button | select: the next gun (the wheel back: the one before) |
 * | R, RELOAD | reload: an edge |
 *
 * Edges (jump, select, reload) are kept until a step reads them, then
 * cleared, so a tap shorter than a step is never lost and never read twice.
 * Held things (keys, fire) are sources by name, as store/walkHold.ts keeps
 * WALK's: a second finger never ends the first, and the window losing focus
 * lets go of everything.
 *
 * Ledger class (c), client: how a player makes a RunInput is this client's
 * own. The RunInput itself (what a step takes) is the simulation's, class
 * (b), shared with any client that replays a run.
 */

import type { RunInput } from '../../lib/games/droneRun/types'

/**
 * Where the view looks, radians, in screen terms (frame.ts): yaw about +Y, 0
 * facing cyberspace -Z, positive turning the view left on screen; pitch,
 * positive looking up. The runner turns yaw and strafe into the
 * simulation's hand once (frame.ts toSimInput).
 */
export const lookState = { yaw: 0, pitch: 0 }

/** The most the view looks up or down, radians (about 83 degrees). */
export const PITCH_LIMIT = 1.45
/** Radians of turn per pixel the mouse moves under the pointer lock. */
export const MOUSE_RAD_PER_PX = 0.0022
/** Radians of turn per pixel of a drag (no lock, or the lock refused): coarser, since a drag is shorter than a mouse sweep. */
export const DRAG_RAD_PER_PX = 0.005

/** A held direction: forward and right are +1. */
interface Dir { fwd: number; strafe: number }

const KEY_DIRS: Record<string, Dir> = {
  KeyW: { fwd: 1, strafe: 0 }, ArrowUp: { fwd: 1, strafe: 0 },
  KeyS: { fwd: -1, strafe: 0 }, ArrowDown: { fwd: -1, strafe: 0 },
  KeyA: { fwd: 0, strafe: -1 }, ArrowLeft: { fwd: 0, strafe: -1 },
  KeyD: { fwd: 0, strafe: 1 }, ArrowRight: { fwd: 0, strafe: 1 },
}

/** What a key does in the game, or null for a key the game leaves alone. */
export type KeyAction =
  | { kind: 'move'; dir: Dir }
  | { kind: 'jump' }
  | { kind: 'select'; index: number }
  | { kind: 'cycle'; by: 1 | -1 }
  | { kind: 'reload' }
  | { kind: 'mute' }

/** The game's key map (KeyboardEvent.code). */
export function keyAction(code: string): KeyAction | null {
  const dir = KEY_DIRS[code]
  if (dir) return { kind: 'move', dir }
  if (code === 'Space') return { kind: 'jump' }
  if (code === 'Digit1' || code === 'Numpad1') return { kind: 'select', index: 0 }
  if (code === 'Digit2' || code === 'Numpad2') return { kind: 'select', index: 1 }
  if (code === 'Digit3' || code === 'Numpad3') return { kind: 'select', index: 2 }
  if (code === 'KeyQ') return { kind: 'cycle', by: 1 }
  if (code === 'KeyR') return { kind: 'reload' }
  if (code === 'KeyM') return { kind: 'mute' }
  return null
}

const held = new Map<string, Dir>()
const firing = new Set<string>()
let stick: Dir = { fwd: 0, strafe: 0 }
let edges = { jump: false, reload: false, select: null as number | null, cycle: 0 }
let weapons = { count: 3, current: 0 }
/** While a card is up (cleared, failed): nothing moves or fires, and the keys belong to the card. */
let paused = false

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Everything held, combined: opposite keys cancel, the stick adds, the result stays inside the unit circle. */
export function moveNow(): Dir {
  let fwd = 0
  let strafe = 0
  for (const d of held.values()) { fwd += d.fwd; strafe += d.strafe }
  fwd = clamp(fwd, -1, 1) + stick.fwd
  strafe = clamp(strafe, -1, 1) + stick.strafe
  const m = Math.hypot(fwd, strafe)
  return m > 1 ? { fwd: fwd / m, strafe: strafe / m } : { fwd, strafe }
}

/**
 * This step's input; the edges are cleared once read. A gun asked for by
 * cycling is resolved here against the gun in hand, so Q pressed twice
 * between two steps moves two guns on.
 */
export function readInput(): RunInput {
  let select = edges.select
  if (edges.cycle !== 0) {
    const from = select ?? weapons.current
    select = (((from + edges.cycle) % weapons.count) + weapons.count) % weapons.count
  }
  if (select !== null) weapons.current = select
  const out: RunInput = paused
    ? { move: { fwd: 0, strafe: 0 }, yaw: lookState.yaw, pitch: lookState.pitch, jump: false, fire: false, select: null, reload: false }
    : { move: moveNow(), yaw: lookState.yaw, pitch: lookState.pitch, jump: edges.jump, fire: firing.size > 0, select, reload: edges.reload }
  edges = { jump: false, reload: false, select: null, cycle: 0 }
  return out
}

/** How many guns there are and which is in hand, so cycling knows where it goes (the HUD tells it as the run changes). */
export function noteWeapons(count: number, current: number): void {
  weapons = { count: Math.max(1, count), current: clamp(current, 0, Math.max(0, count - 1)) }
}

/** Turn the view by a drag or a mouse move of (dx, dy) pixels at `radPerPx`: right turns right, up looks up. */
export function lookBy(dx: number, dy: number, radPerPx: number): void {
  lookState.yaw -= dx * radPerPx
  lookState.pitch = clamp(lookState.pitch - dy * radPerPx, -PITCH_LIMIT, PITCH_LIMIT)
}

/** Set the view (a run starting or restarting faces the entry's way). */
export function setLook(yaw: number, pitch = 0): void {
  lookState.yaw = yaw
  lookState.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT)
}

/** A held source goes down (`key:KeyW`, `pad:...`). */
export function holdMove(source: string, dir: Dir): void { held.set(source, dir) }
/** A held source is let go. */
export function releaseMove(source: string): void { held.delete(source) }
/** The phone's stick, analog, each axis -1..1. */
export function setStick(fwd: number, strafe: number): void { stick = { fwd, strafe } }
/** A fire source goes down or up (`mouse`, `pad:fire`). */
export function setFire(source: string, down: boolean): void { if (down) firing.add(source); else firing.delete(source) }
export function pressJump(): void { if (!paused) edges.jump = true }
export function pressReload(): void { if (!paused) edges.reload = true }
export function pressSelect(index: number): void { if (!paused) { edges.select = clamp(index, 0, weapons.count - 1); edges.cycle = 0 } }
export function pressCycle(by: 1 | -1): void { if (!paused) edges.cycle += by }

/** Cards up or down: paused, the steps read no movement, no fire and no edges. */
export function setInputPaused(on: boolean): void {
  paused = on
  if (on) releaseAll()
}
export function inputPaused(): boolean { return paused }

/** Let go of everything held, and drop the edges not yet read. */
export function releaseAll(): void {
  held.clear()
  firing.clear()
  stick = { fwd: 0, strafe: 0 }
  edges = { jump: false, reload: false, select: null, cycle: 0 }
}

/** Back to a fresh start (a new session; tests). */
export function resetInput(yaw = 0, pitch = 0): void {
  releaseAll()
  paused = false
  weapons = { count: 3, current: 0 }
  setLook(yaw, pitch)
}

/* ---------- the desktop: keys, mouse, pointer lock ---------- */

/** What the desktop wiring tells the screen: whether the pointer is locked to the view. */
export const pointer = { locked: false, listeners: new Set<() => void>() }
function setLocked(on: boolean): void {
  if (pointer.locked === on) return
  pointer.locked = on
  for (const l of [...pointer.listeners]) l()
}

/** The bits of the DOM the desktop wiring touches, so a test can hand it stand-ins. */
export interface DesktopHost {
  /** The view: a press on it locks the pointer, or drags. */
  el: HTMLElement
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'exitPointerLock'> & { pointerLockElement: Element | null; visibilityState?: string }
  now?: () => number
}

export interface DesktopOptions {
  /** M was pressed: sound on or off. */
  onMute?: () => void
  /** Any press: the sound may start (lib/audioContext wantSound). */
  onGesture?: () => void
}

/** Refused this many times in a row, the lock is not asked for again this session: a drag looks instead. */
const LOCK_TRIES = 2
/** After the lock goes (Esc), a refusal within this long is the browser's pause, not a refusal, ms. */
const LOCK_COOLDOWN_MS = 2000

/**
 * Wire the keyboard and the mouse to the game while the screen is up; the
 * returned function unwires it. The cyberspace keys already stand down while
 * a game session is open (hooks/useKeyboard.ts); this takes the game's.
 *
 * A press on the view asks for the pointer lock; with it, the mouse looks
 * and the left button fires. Without it (refused, or not offered, as in an
 * embedded frame), a press fires and a drag looks. Esc releases the lock
 * (the browser does that itself); a press on the view takes it again.
 */
export function attachDesktop(host: DesktopHost, opts: DesktopOptions = {}): () => void {
  const { el, win, doc } = host
  const now = host.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  let refusals = 0
  // A request in flight (its refusal comes as an error event and a rejected promise: counted once), and when the lock last went.
  let asking = false
  let unlockedAt = -Infinity
  const refused = (): void => {
    if (!asking) return
    asking = false
    // Browsers refuse a new lock for about a second after Esc: that is not the page refusing it.
    if (now() - unlockedAt > LOCK_COOLDOWN_MS) refusals++
  }
  let drag: { x: number; y: number; id: number } | null = null

  const typing = (t: EventTarget | null): boolean => {
    const e = t as HTMLElement | null
    return !!e?.closest?.('input, textarea, select, [contenteditable="true"]')
  }

  const keydown = (e: KeyboardEvent): void => {
    if (e.key === 'Meta') { releaseAll(); return }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (typing(e.target)) return
    // Enter on a focused button presses the button; the cards take Enter and R themselves while they are up.
    if (paused) return
    const a = keyAction(e.code)
    if (!a) return
    e.preventDefault()
    opts.onGesture?.()
    if (a.kind === 'move') { holdMove(`key:${e.code}`, a.dir); return }
    if (e.repeat) return
    if (a.kind === 'jump') pressJump()
    else if (a.kind === 'select') pressSelect(a.index)
    else if (a.kind === 'cycle') pressCycle(a.by)
    else if (a.kind === 'reload') pressReload()
    else if (a.kind === 'mute') opts.onMute?.()
  }
  const keyup = (e: KeyboardEvent): void => {
    if (e.key === 'Meta') { releaseAll(); return }
    releaseMove(`key:${e.code}`)
    // A focused button presses on Space's keyup: a jump never presses EXIT GAME.
    if (e.code === 'Space') e.preventDefault()
  }

  const askLock = (): boolean => {
    const req = (el as { requestPointerLock?: () => unknown }).requestPointerLock
    if (typeof req !== 'function' || refusals >= LOCK_TRIES) return false
    asking = true
    try {
      const p = req.call(el) as Promise<void> | undefined
      if (p && typeof p.catch === 'function') p.catch(refused)
    } catch { refused(); return false }
    return true
  }

  const pointerdown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' || paused) return
    opts.onGesture?.()
    if (e.button !== 0) return
    if (pointer.locked) { setFire('mouse', true); return }
    // The first press asks for the lock and does not fire; refused, the press fires and a drag looks.
    if (askLock()) return
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId }
    setFire('mouse', true)
    try { el.setPointerCapture?.(e.pointerId) } catch { /* fine */ }
  }
  const pointermove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return
    if (pointer.locked) { lookBy(e.movementX ?? 0, e.movementY ?? 0, MOUSE_RAD_PER_PX); return }
    if (!drag || drag.id !== e.pointerId) return
    lookBy(e.clientX - drag.x, e.clientY - drag.y, DRAG_RAD_PER_PX)
    drag = { ...drag, x: e.clientX, y: e.clientY }
  }
  const pointerup = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return
    if (e.button === 0 || e.type === 'pointercancel') setFire('mouse', false)
    if (drag && drag.id === e.pointerId) drag = null
  }
  const wheel = (e: WheelEvent): void => {
    if (paused || e.deltaY === 0) return
    e.preventDefault()
    pressCycle(e.deltaY > 0 ? 1 : -1)
  }
  const lockchange = (): void => {
    const on = doc.pointerLockElement === el
    if (on) { refusals = 0; asking = false } else if (pointer.locked) unlockedAt = now()
    setLocked(on)
    if (!on) setFire('mouse', false)
  }
  const lockerror = (): void => { refused() }
  const letGo = (): void => { releaseAll(); drag = null }
  const hidden = (): void => { if (doc.visibilityState === 'hidden') letGo() }
  const menu = (e: Event): void => e.preventDefault()

  win.addEventListener('keydown', keydown as EventListener)
  win.addEventListener('keyup', keyup as EventListener)
  win.addEventListener('blur', letGo)
  el.addEventListener('pointerdown', pointerdown as EventListener)
  win.addEventListener('pointermove', pointermove as EventListener)
  win.addEventListener('pointerup', pointerup as EventListener)
  win.addEventListener('pointercancel', pointerup as EventListener)
  el.addEventListener('wheel', wheel as EventListener, { passive: false })
  el.addEventListener('contextmenu', menu)
  doc.addEventListener('pointerlockchange', lockchange)
  doc.addEventListener('pointerlockerror', lockerror)
  doc.addEventListener('visibilitychange', hidden)
  return () => {
    letGo()
    win.removeEventListener('keydown', keydown as EventListener)
    win.removeEventListener('keyup', keyup as EventListener)
    win.removeEventListener('blur', letGo)
    el.removeEventListener('pointerdown', pointerdown as EventListener)
    win.removeEventListener('pointermove', pointermove as EventListener)
    win.removeEventListener('pointerup', pointerup as EventListener)
    win.removeEventListener('pointercancel', pointerup as EventListener)
    el.removeEventListener('wheel', wheel as EventListener)
    el.removeEventListener('contextmenu', menu)
    doc.removeEventListener('pointerlockchange', lockchange)
    doc.removeEventListener('pointerlockerror', lockerror)
    doc.removeEventListener('visibilitychange', hidden)
    if (doc.pointerLockElement === el) { try { doc.exitPointerLock() } catch { /* fine */ } }
    setLocked(false)
  }
}

/** Let the pointer go (a card coming up needs the mouse for its buttons). */
export function releasePointer(doc: (Pick<Document, 'exitPointerLock'> & { pointerLockElement: Element | null }) | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (doc?.pointerLockElement) { try { doc.exitPointerLock() } catch { /* fine */ } }
}

/* ---------- the phone: the stick and the look drag ---------- */

/** The stick's dead zone, as a share of its reach: a thumb resting on it moves nothing. */
export const STICK_DEAD = 0.12
/** Radians of turn per pixel of a look drag on the phone: 130 degrees across WALK's 112px LOOK ball (hud/WalkLookSphere), a little finer than WALK's 150 for aiming. */
export const TOUCH_RAD_PER_PX = (130 * Math.PI) / 180 / 112

/**
 * The stick's output for a thumb at (dx, dy) pixels from its centre, reach
 * `radius`: forward is up the screen. Inside the dead zone nothing; past it
 * the magnitude rises from 0 to 1 at the rim (and stays 1 beyond it), the
 * direction kept.
 */
export function stickVector(dx: number, dy: number, radius: number, dead = STICK_DEAD): Dir & { mag: number } {
  const r = Math.hypot(dx, dy)
  if (radius <= 0 || r <= dead * radius) return { fwd: 0, strafe: 0, mag: 0 }
  const mag = Math.min(1, (r / radius - dead) / (1 - dead))
  return { fwd: (-dy / r) * mag, strafe: (dx / r) * mag, mag }
}

/** Where the stick stands on screen: its centre and reach, in CSS pixels. */
export interface StickPlace { cx: number; cy: number; radius: number }

/**
 * The phone's touches by pointer id: a touch that lands on the left half
 * (below the top bar) drives the stick, measured from the stick's own
 * centre; one that lands on the right half looks. One finger each: a
 * second finger on a side already held is ignored there (FIRE, JUMP and the
 * gun button are buttons of their own and take their own fingers).
 */
export class TouchTracker {
  private stickId: number | null = null
  private lookId: number | null = null
  private last = { x: 0, y: 0 }
  constructor(private place: () => StickPlace, private radPerPx = TOUCH_RAD_PER_PX) {}

  /** A finger lands at (x, y) on a view `width` wide: what it took, if anything. */
  down(id: number, x: number, y: number, width: number): 'stick' | 'look' | null {
    if (x < width / 2) {
      if (this.stickId !== null) return null
      this.stickId = id
      this.moveStick(x, y)
      return 'stick'
    }
    if (this.lookId !== null) return null
    this.lookId = id
    this.last = { x, y }
    return 'look'
  }

  move(id: number, x: number, y: number): void {
    if (id === this.stickId) this.moveStick(x, y)
    else if (id === this.lookId) {
      lookBy(x - this.last.x, y - this.last.y, this.radPerPx)
      this.last = { x, y }
    }
  }

  up(id: number): void {
    if (id === this.stickId) { this.stickId = null; setStick(0, 0); this.knob = { dx: 0, dy: 0 } }
    if (id === this.lookId) this.lookId = null
  }

  /** Every finger gone (the screen lost focus, a card came up). */
  clear(): void {
    if (this.stickId !== null) setStick(0, 0)
    this.stickId = null
    this.lookId = null
    this.knob = { dx: 0, dy: 0 }
  }

  /** Where the knob is drawn, from the stick's centre, clamped to its reach. */
  knob = { dx: 0, dy: 0 }

  get holding(): { stick: number | null; look: number | null } { return { stick: this.stickId, look: this.lookId } }

  private moveStick(x: number, y: number): void {
    const p = this.place()
    const dx = x - p.cx
    const dy = y - p.cy
    const v = stickVector(dx, dy, p.radius)
    setStick(v.fwd, v.strafe)
    const r = Math.hypot(dx, dy)
    const k = r > p.radius ? p.radius / r : 1
    this.knob = { dx: dx * k, dy: dy * k }
  }
}
