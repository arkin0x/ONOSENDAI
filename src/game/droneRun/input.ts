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
 * | the phone's MOVE stick (floating: its centre is where the thumb lands) | move: analog, inside the unit circle (added to the keys, then kept inside it) |
 * | mouse with the lock, a drag without it, a second finger dragged on the phone's right half | yaw and pitch, absolute, in lookState |
 * | the phone's LOOK stick (floating, held off where the thumb landed) | a turn rate, applied each frame by tickLook (lookStickRate: dead zone, a gentle curve, at most LOOK_MAX_YAW and LOOK_MAX_PITCH) |
 * | the phone's MOVE stick while the rail charges (AIM) | a finer turn rate (AIM_SCALE of LOOK's); move is 0 meanwhile |
 * | Shift, SPRINT (held) | sprint: held (the simulation spends stamina) |
 * | Space, JUMP | jump: an edge, true for the one step that reads it (in the air it is the double jump) |
 * | left button, FIRE (held) | fire: held (auto fires, the rail charges) |
 * | 1 2 3 | select: that gun, for the one step that reads it |
 * | Q, the wheel, the phone's gun button | select: the next gun (the wheel back: the one before) |
 * | R, RELOAD | reload: an edge |
 * | SPRINT on the phone, tapped | sprint, latched on (sprintLatched) until a second tap, the MOVE stick let go, the lockout (stamina run dry), a card, or the page losing focus; held longer than SPRINT_TAP_MS it sprints only while held, so two fingers can still hold it. Shift stays a hold |
 *
 * Edges (jump, select, reload) are kept until a step reads them, then
 * cleared, so a tap shorter than a step is never lost and never read twice.
 * Held things (keys, fire) are sources by name, as store/walkHold.ts keeps
 * WALK's: a second finger never ends the first, and the window losing focus
 * lets go of everything. On the phone each control owns its own finger
 * (pointer id), so moving, looking, firing and jumping all work at once.
 *
 * Each press of a control (FIRE going down, JUMP, a gun, RELOAD, sprint on
 * or off, the lockout) is told to controls$, for its press sound
 * (clicks.ts); a stick never is.
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
  | { kind: 'sprint' }
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
  if (code === 'ShiftLeft' || code === 'ShiftRight') return { kind: 'sprint' }
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
const sprinting = new Set<string>()
/** SPRINT tapped on the phone: sprint stays on without a finger on it (one thumb can tap it, then go back to the MOVE stick). */
let latched = false
/** Each SPRINT finger's press: when it went down and whether the latch was on then. */
const sprintPresses = new Map<string, { at: number; wasLatched: boolean }>()
/** The rail charging on a phone: the MOVE stick aims (TouchTracker.setAim) and the steps read no movement. */
let aiming = false
let stick: Dir = { fwd: 0, strafe: 0 }
/** The LOOK stick's turn rate, radians a second, in lookState's terms (yaw positive turns left, pitch positive looks up). */
const lookRate = { yaw: 0, pitch: 0 }
let edges = { jump: false, reload: false, select: null as number | null, cycle: 0 }
let weapons = { count: 3, current: 0 }
/** While a card is up (cleared, failed): nothing moves or fires, and the keys belong to the card. */
let paused = false

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Everything held, combined: opposite keys cancel, the stick adds, the result stays inside the unit circle. Nothing while the stick aims. */
export function moveNow(): Dir {
  if (aiming) return { fwd: 0, strafe: 0 }
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
    ? { move: { fwd: 0, strafe: 0 }, yaw: lookState.yaw, pitch: lookState.pitch, jump: false, fire: false, select: null, reload: false, sprint: false }
    : { move: moveNow(), yaw: lookState.yaw, pitch: lookState.pitch, jump: edges.jump, fire: firing.size > 0, select, reload: edges.reload, sprint: sprinting.size > 0 || latched }
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

/** The LOOK stick's turn rate, radians a second (lookStickRate); 0, 0 when it is let go. */
export function setLookRate(yaw: number, pitch: number): void {
  lookRate.yaw = Number.isFinite(yaw) ? yaw : 0
  lookRate.pitch = Number.isFinite(pitch) ? pitch : 0
}

/** The LOOK stick's turn rate now, radians a second. */
export function lookRateNow(): { yaw: number; pitch: number } { return { yaw: lookRate.yaw, pitch: lookRate.pitch } }

/** Turn the view by the LOOK stick's rate over `dt` seconds (each screen frame; nothing while paused). */
export function tickLook(dt: number): void {
  if (paused || !(dt > 0) || (lookRate.yaw === 0 && lookRate.pitch === 0)) return
  const t = Math.min(dt, 0.1)
  lookState.yaw += lookRate.yaw * t
  lookState.pitch = clamp(lookState.pitch + lookRate.pitch * t, -PITCH_LIMIT, PITCH_LIMIT)
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
/** A fire source goes down or up (`mouse`, `pad:fire:<finger>`). */
export function setFire(source: string, down: boolean): void {
  const had = firing.has(source)
  const before = firing.size
  if (down) firing.add(source); else firing.delete(source)
  if (down && before === 0 && firing.size === 1 && !paused) pressed('fire')
  if (had !== down) heard()
}
/** A sprint source goes down or up (`key:ShiftLeft`, `pad:sprint:<finger>`). */
export function setSprint(source: string, down: boolean): void {
  const had = sprinting.has(source)
  if (down) sprinting.add(source); else sprinting.delete(source)
  if (had !== down) heard()
}
/** Whether a finger holds the phone's FIRE (a `pad:fire:` source): with the rail in hand, that is the charge the MOVE stick aims through. */
export function padFiring(): boolean {
  for (const s of firing) if (s.startsWith('pad:fire:')) return true
  return false
}
/** Whether anything holds sprint, or the phone's SPRINT is latched on. */
export function sprintHeld(): boolean { return sprinting.size > 0 || latched }

/** A press on the phone's SPRINT shorter than this, milliseconds, is a tap (it toggles the latch); longer, a hold. */
export const SPRINT_TAP_MS = 250

/** Whether the phone's SPRINT is latched on (tapped). */
export function sprintLatched(): boolean { return latched }

/** The latch on or off; the HUD hears it (the button lit). */
export function setSprintLatch(on: boolean): void {
  if (latched === on) return
  latched = on
  heard()
}

/**
 * A finger goes down on the phone's SPRINT at `now` (ms): it sprints at
 * once while held. Latched already, the press is the second tap: the latch
 * comes off (the finger still sprints while it stays down).
 */
export function pressSprintPad(source: string, now: number): void {
  if (paused) return
  sprintPresses.set(source, { at: now, wasLatched: latched })
  // The finger first, then the latch off, so sprint never flickers off and on (one press sound, not three).
  setSprint(source, true)
  setSprintLatch(false)
}

/**
 * That finger lifts at `now` (ms). A tap (shorter than SPRINT_TAP_MS, and
 * the latch off when it went down) latches sprint on; a hold just ends.
 * `tap` false (a cancelled touch) never latches.
 */
export function releaseSprintPad(source: string, now: number, tap = true): void {
  const p = sprintPresses.get(source)
  sprintPresses.delete(source)
  // A tap latches before the finger lets go, so sprint stays on without a flicker.
  if (tap && p && !p.wasLatched && !paused && now - p.at < SPRINT_TAP_MS) setSprintLatch(true)
  setSprint(source, false)
}

/** Stamina ran dry (the lockout runs): the latch comes off, so sprint is tapped on again when it is back (the runner tells it each step). */
export function noteSprintLocked(locked: boolean): void {
  if (locked && !wasLocked && !paused) {
    // The lockout's own sound, not SPRINT off as well.
    quietSprint = true
    setSprintLatch(false)
    quietSprint = false
    sprintWas = sprintHeld()
    pressed('lockout')
  } else if (locked) setSprintLatch(false)
  wasLocked = locked
}
/** The rail charging on a phone (TouchTracker.setAim sets it): the steps read no movement while it is on. */
export function setAiming(on: boolean): void { aiming = on }
export function aimingNow(): boolean { return aiming }

/**
 * A control pressed, for its press sound (clicks.ts; the HUD plays it):
 * FIRE going down (any finger or the mouse, the first of them), JUMP, a gun
 * chosen or cycled, RELOAD, sprint coming on or off (any source, the latch
 * too), and the stamina lockout. Never while paused, never a stick.
 */
export type ControlPress = 'fire' | 'jump' | 'switch' | 'reload' | 'sprintOn' | 'sprintOff' | 'lockout'
export const controls$ = { listeners: new Set<(c: ControlPress) => void>() }
function pressed(c: ControlPress): void { for (const l of [...controls$.listeners]) l(c) }
let sprintWas = false
let quietSprint = false
let wasLocked = false

/** Who hears FIRE and SPRINT going down or up (the HUD: AIM, the SPRINT button lit). */
export const held$ = { listeners: new Set<() => void>() }
function heard(): void {
  const now = sprintHeld()
  if (now !== sprintWas) {
    sprintWas = now
    // In the lockout, sprint ending says nothing (the lockout said it), and SPRINT pressed again answers with the lockout's sound: not yet.
    if (!paused && !quietSprint && !(wasLocked && !now)) pressed(now ? (wasLocked ? 'lockout' : 'sprintOn') : 'sprintOff')
  }
  for (const l of [...held$.listeners]) l()
}
export function pressJump(): void { if (!paused) { edges.jump = true; pressed('jump') } }
export function pressReload(): void { if (!paused) { edges.reload = true; pressed('reload') } }
export function pressSelect(index: number): void {
  if (paused) return
  const to = clamp(index, 0, weapons.count - 1)
  if (to !== weapons.current) pressed('switch')
  edges.select = to
  edges.cycle = 0
}
export function pressCycle(by: 1 | -1): void { if (!paused) { edges.cycle += by; if (weapons.count > 1) pressed('switch') } }

/** Cards up or down: paused, the steps read no movement, no fire and no edges. */
export function setInputPaused(on: boolean): void {
  paused = on
  if (on) releaseAll()
}
export function inputPaused(): boolean { return paused }

/** Let go of everything held, and drop the edges not yet read. */
export function releaseAll(): void {
  const any = firing.size > 0 || sprinting.size > 0 || latched
  held.clear()
  firing.clear()
  sprinting.clear()
  sprintPresses.clear()
  latched = false
  aiming = false
  stick = { fwd: 0, strafe: 0 }
  lookRate.yaw = 0
  lookRate.pitch = 0
  edges = { jump: false, reload: false, select: null, cycle: 0 }
  if (any) heard()
}

/** Back to a fresh start (a new session; tests). */
export function resetInput(yaw = 0, pitch = 0): void {
  releaseAll()
  paused = false
  sprintWas = false
  wasLocked = false
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
/** Wheel scroll, in pixels, that changes the gun once (a mouse notch is about 100). */
export const WHEEL_STEP = 60
/** A pause in wheel events this long, in ms, ends a scroll gesture. */
export const WHEEL_GAP_MS = 180

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
    if (a.kind === 'sprint') { setSprint(`key:${e.code}`, true); return }
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
    setSprint(`key:${e.code}`, false)
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
  // A trackpad scroll sends dozens of small wheel events per gesture: they add up, and a gun
  // changes once per WHEEL_STEP of scroll and at most once per gesture (a gap of WHEEL_GAP_MS
  // ends one), so one swipe is one gun. A mouse notch (about 100) is one gun each.
  let wheelSum = 0
  let wheelAt = -Infinity
  let wheelSpent = false
  const wheel = (e: WheelEvent): void => {
    if (paused || e.deltaY === 0) return
    e.preventDefault()
    const t = now()
    if (t - wheelAt > WHEEL_GAP_MS) { wheelSum = 0; wheelSpent = false }
    wheelAt = t
    const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY
    wheelSum += px
    const notch = Math.abs(px) >= WHEEL_STEP
    if (Math.abs(wheelSum) < WHEEL_STEP || (wheelSpent && !notch)) return
    pressCycle(wheelSum > 0 ? 1 : -1)
    wheelSum = 0
    wheelSpent = true
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

/* ---------- the phone: the MOVE stick, the LOOK stick and the look drag ---------- */

/** The stick's dead zone, as a share of its reach: a thumb resting on it moves nothing. */
export const STICK_DEAD = 0.12
/** Radians of turn per pixel of a look drag on the phone: 130 degrees across WALK's 112px LOOK ball (hud/WalkLookSphere), a little finer than WALK's 150 for aiming. */
export const TOUCH_RAD_PER_PX = (130 * Math.PI) / 180 / 112

/** The LOOK stick's dead zone, as a share of its reach. */
export const LOOK_DEAD = 0.1
/** The LOOK stick's curve: the turn rate grows as the push past the dead zone to this power, so a small push aims finely. */
export const LOOK_CURVE = 1.8
/** The fastest the LOOK stick turns the view, radians a second: 180 degrees across, 100 up and down. */
export const LOOK_MAX_YAW = Math.PI
export const LOOK_MAX_PITCH = (100 * Math.PI) / 180
/** While the rail charges the MOVE stick aims at this share of the LOOK stick's rates (54 degrees a second across at the rim): fine enough to snipe. */
export const AIM_SCALE = 0.3
/** A floating stick's ring keeps this far inside the screen's edge, CSS px. */
export const RING_MARGIN = 4

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

/**
 * The LOOK stick's turn rate for a thumb at (dx, dy) pixels from its centre,
 * reach `radius`, radians a second in lookState's terms. Inside the dead zone
 * nothing; past it the push (0 to 1 at the rim) is raised to LOOK_CURVE and
 * split along the thumb's direction: right on screen turns the view right
 * (yaw down, as lookBy), up looks up. `scale` shrinks the top rates (AIM_SCALE
 * for the aim).
 */
export function lookStickRate(dx: number, dy: number, radius: number, scale = 1): { yaw: number; pitch: number; mag: number } {
  const r = Math.hypot(dx, dy)
  if (radius <= 0 || r <= LOOK_DEAD * radius) return { yaw: 0, pitch: 0, mag: 0 }
  const push = Math.min(1, (r / radius - LOOK_DEAD) / (1 - LOOK_DEAD))
  const mag = Math.pow(push, LOOK_CURVE)
  return { yaw: (-dx / r) * mag * LOOK_MAX_YAW * scale, pitch: (-dy / r) * mag * LOOK_MAX_PITCH * scale, mag }
}

/** Where a stick stands on screen at rest: its centre and reach, in CSS pixels. A floating stick takes only its reach from it. */
export interface StickPlace { cx: number; cy: number; radius: number }

/** What a finger took when it landed. */
export type TouchRole = 'stick' | 'lookstick' | 'look'

/** A point on screen, CSS px. */
export interface Pt { x: number; y: number }

/**
 * Where a floating stick's ring is drawn for a thumb landing at (x, y): there,
 * moved only as far as it must to keep the ring on screen (RING_MARGIN in)
 * and on its own half. The stick still measures from the landing point, so
 * the ring near an edge sits a little off the thumb, never the turn.
 */
export function ringAt(x: number, y: number, radius: number, side: 'left' | 'right', width: number, height: number): Pt {
  const r = radius + RING_MARGIN
  const half = width / 2
  const lo = side === 'left' ? r : half + radius
  const hi = side === 'left' ? half - radius : width - r
  const fit = (v: number, a: number, b: number): number => (a <= b ? clamp(v, a, b) : (a + b) / 2)
  return {
    x: Number.isFinite(width) ? fit(x, lo, hi) : x,
    y: Number.isFinite(height) ? fit(y, r, height - r) : y,
  }
}

/** One floating stick's finger: its id, where it landed (the stick's centre), where it is, and where the ring is drawn. */
interface Held { id: number; origin: Pt; at: Pt; ring: Pt }

/**
 * The phone's touches by pointer id. Both sticks float: where a thumb lands
 * becomes the stick's centre (the ring is drawn there, kept on screen), so
 * every touch starts at nothing and only moving away from the landing point
 * moves or turns; the dead zone and the curve are measured from it. On lift
 * the ring goes back to its resting place.
 *
 * - The left half (below the top bar) is the MOVE stick.
 * - The right half is the LOOK stick: the view turns at its rate (tickLook)
 *   until it lifts. A second finger on the right while LOOK is held drags the
 *   look. Without a LOOK stick on screen (a desktop's touch screen) the right
 *   half drags.
 * - Aim (setAim, while the rail charges): the MOVE stick turns the view at
 *   AIM_SCALE of LOOK's rate instead of moving, and the LOOK stick rests
 *   (hidden by the HUD); a finger on either is re-centred where it is when aim
 *   starts or ends, so neither jumps.
 *
 * One finger each: a second finger on a stick already held is ignored there.
 * FIRE, JUMP, SPRINT and the gun button are buttons of their own and take
 * their own fingers. A finger keeps what it took until it lifts, wherever it
 * slides; lifting (or cancelling) one finger never lets go of another's.
 */
export class TouchTracker {
  private stick: Held | null = null
  private lookStick: Held | null = null
  private lookId: number | null = null
  private last = { x: 0, y: 0 }
  private aim = false
  private size = { w: Infinity, h: Infinity }
  private readonly lookPlace: () => StickPlace | null
  private readonly radPerPx: number
  constructor(private place: () => StickPlace, opts: { look?: () => StickPlace | null; radPerPx?: number } = {}) {
    this.lookPlace = opts.look ?? (() => null)
    this.radPerPx = opts.radPerPx ?? TOUCH_RAD_PER_PX
  }

  /** A finger lands at (x, y) on a view `width` by `height`: what it took, if anything. */
  down(id: number, x: number, y: number, width: number, height = Infinity): TouchRole | null {
    if (id === this.stick?.id || id === this.lookStick?.id || id === this.lookId) return null
    this.size = { w: width, h: height }
    if (x < width / 2) {
      if (this.stick) return null
      this.stick = this.held(id, x, y, this.place().radius, 'left')
      this.moveStick(x, y)
      return 'stick'
    }
    const lp = this.lookPlace()
    if (lp && this.aim) return null
    if (lp && !this.lookStick) {
      this.lookStick = this.held(id, x, y, lp.radius, 'right')
      this.moveLookStick(x, y)
      return 'lookstick'
    }
    if (this.lookId !== null) return null
    this.lookId = id
    this.last = { x, y }
    return 'look'
  }

  move(id: number, x: number, y: number): void {
    if (id === this.stick?.id) this.moveStick(x, y)
    else if (id === this.lookStick?.id) this.moveLookStick(x, y)
    else if (id === this.lookId) {
      lookBy(x - this.last.x, y - this.last.y, this.radPerPx)
      this.last = { x, y }
    }
  }

  up(id: number): void {
    if (id === this.stick?.id) {
      this.stick = null
      setStick(0, 0)
      // The run is let go: a tapped SPRINT ends with it.
      setSprintLatch(false)
      if (this.aim) setLookRate(0, 0)
      this.knob = { dx: 0, dy: 0 }
    }
    if (id === this.lookStick?.id) {
      this.lookStick = null
      // Resting under the aim it turns nothing: the aim's rate is the MOVE stick's.
      if (!this.aim) setLookRate(0, 0)
      this.lookKnob = { dx: 0, dy: 0 }
    }
    if (id === this.lookId) this.lookId = null
  }

  /** Every finger gone (the screen lost focus, a card came up). */
  clear(): void {
    if (this.stick) { setStick(0, 0); setSprintLatch(false) }
    if (this.lookStick || (this.aim && this.stick)) setLookRate(0, 0)
    this.stick = null
    this.lookStick = null
    this.lookId = null
    this.knob = { dx: 0, dy: 0 }
    this.lookKnob = { dx: 0, dy: 0 }
  }

  /**
   * Aim on or off (the rail charging with FIRE held, on a phone). On: the
   * steps read no movement (input.ts setAiming), the MOVE stick turns the
   * view finely, the LOOK stick rests. Either way a finger held on a stick is
   * re-centred where it is, so the aim (or the run, or the turn) starts at
   * nothing.
   */
  setAim(on: boolean): void {
    if (on === this.aim) return
    this.aim = on
    setAiming(on)
    setStick(0, 0)
    setLookRate(0, 0)
    if (this.stick) { this.recentre(this.stick, this.place().radius, 'left'); this.knob = { dx: 0, dy: 0 } }
    const lp = this.lookPlace()
    if (this.lookStick && lp) { this.recentre(this.lookStick, lp.radius, 'right'); this.lookKnob = { dx: 0, dy: 0 } }
  }

  /** Whether the MOVE stick aims now. */
  get aiming(): boolean { return this.aim }

  /** Where the MOVE stick's knob is drawn, from its centre, clamped to its reach. */
  knob = { dx: 0, dy: 0 }
  /** Where the LOOK stick's knob is drawn. */
  lookKnob = { dx: 0, dy: 0 }

  /** Where the MOVE stick's ring is drawn while a finger holds it; null: at its resting place. */
  get ring(): Pt | null { return this.stick ? { ...this.stick.ring } : null }
  /** Where the LOOK stick's ring is drawn while a finger holds it; null: at its resting place. */
  get lookRing(): Pt | null { return this.lookStick ? { ...this.lookStick.ring } : null }

  get holding(): { stick: number | null; lookStick: number | null; look: number | null } {
    return { stick: this.stick?.id ?? null, lookStick: this.lookStick?.id ?? null, look: this.lookId }
  }

  /** Whether this finger holds one of the sticks (its knob moves with it). */
  holdsStick(id: number): boolean { return id === this.stick?.id || id === this.lookStick?.id }

  private held(id: number, x: number, y: number, radius: number, side: 'left' | 'right'): Held {
    return { id, origin: { x, y }, at: { x, y }, ring: ringAt(x, y, radius, side, this.size.w, this.size.h) }
  }

  private recentre(h: Held, radius: number, side: 'left' | 'right'): void {
    h.origin = { ...h.at }
    h.ring = ringAt(h.at.x, h.at.y, radius, side, this.size.w, this.size.h)
  }

  private moveStick(x: number, y: number): void {
    const h = this.stick
    if (!h) return
    h.at = { x, y }
    const radius = this.place().radius
    const dx = x - h.origin.x
    const dy = y - h.origin.y
    if (this.aim) {
      const r = lookStickRate(dx, dy, radius, AIM_SCALE)
      setLookRate(r.yaw, r.pitch)
    } else {
      const v = stickVector(dx, dy, radius)
      setStick(v.fwd, v.strafe)
    }
    this.knob = knobAt(dx, dy, radius)
  }

  private moveLookStick(x: number, y: number): void {
    const h = this.lookStick
    const p = this.lookPlace()
    if (!h || !p) return
    h.at = { x, y }
    // Resting under the aim: it remembers where the finger is, and turns nothing.
    if (this.aim) return
    const dx = x - h.origin.x
    const dy = y - h.origin.y
    const r = lookStickRate(dx, dy, p.radius)
    setLookRate(r.yaw, r.pitch)
    this.lookKnob = knobAt(dx, dy, p.radius)
  }
}

/** A knob's place for a thumb at (dx, dy): kept inside the reach. */
function knobAt(dx: number, dy: number, radius: number): { dx: number; dy: number } {
  const r = Math.hypot(dx, dy)
  const k = r > radius ? radius / r : 1
  return { dx: dx * k, dy: dy * k }
}
