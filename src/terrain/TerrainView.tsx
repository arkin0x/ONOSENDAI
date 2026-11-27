/**
 * TerrainView.tsx - TERRAIN's tools on screen. TERRAIN is WALK with block
 * tools (owner, 2026-11-24: "a normal WALK mode, but it has tools to survey
 * and interact with blocks"), so WALK's pad, LOOK, camera and keys stay as
 * they are, and the scene is cyberspace's own; this adds only the tools:
 *
 * - SURVEY (G) fills the chunk you stand in, or the next one in reach the way
 *   you look, with its generated ground.
 * - MINE (Q, a click or a tap on a block) and PLACE (E, a right click or a
 *   act on the block under the cross, or under the pointer: a tap mines, PLACE places.
 * - The hotbar, 1 to 9, and the bag (I): what you carry, on this device, and
 *   your Crew (CrewPanel.tsx). The bag lists no keys: each is printed on its
 *   own button (owner, 2026-11-25: "get rid of the control hints on the
 *   inventory bag modal").
 * - T or Esc goes back to the mode you came from; the mode button goes on
 *   round the ring.
 *
 * The owner's taste: white text with a dark shadow over the scene, no
 * jargon, no layout jumps (every slot kept), lucide icons, chamfered frames,
 * key hints, the shared ✕, colons in copy.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Backpack, Box, Hammer, Radar } from 'lucide-react'
import { HINT_DONE, headNow, offsetOf, surveyTarget as targetNow, terrainSession, useTerrain } from '../store/useTerrain'
import { useWalk } from '../store/useWalk'
import { terrainCursor } from '../scene/TerrainLayer'
import { cancelSurveyHold, startSurveyHold, useSurveyHold } from './surveyHold'
import { walkLookBy } from '../lib/walkLook'
import { topEscape } from '../hooks/useEscape'
import { leaveTerrain } from '../store/padMode'
import { useTutorial } from '../store/useTutorial'
import { usePad } from '../store/usePad'
import { resetTerrainInput, slotKey, terrainInput } from './terrainInput'
import { blockKind, blockName } from '../lib/terrain/blocks'
import { tileUrl } from '../lib/terrain/tiles'
import { ModalClose } from '../hud/ui/ModalClose'
import { Chamfer } from '../hud/ui/Chamfer'
import { noCallout } from '../hooks/useRepeatable'
import { ShareLine } from './ShareLine'
import { TerrainCrew, crewChipAsking } from './TerrainCrew'
import { CrewLayer, CrewPanel, closeCrewLayer } from './CrewPanel'
import { isCompiler } from '../lib/terrain/terrainDb'
import { HeldCompiler } from './HeldCompiler'
import { useSmashHold } from './smashHold'
import { cancelSmashHold, holdSmash } from '../lib/blueprint/smashRun'
import { useSmashFx } from '../store/useSmashFx'
import { RESOLVE_AFTER_MS } from '../lib/blueprint/smash'
import { PrizeCard, PrizeFlights, PrizePicker, PrizeStrip, usePrizesHere } from './PrizePanel'
import { useBlueprintTool } from '../store/useBlueprintTool'
import { recordAtCursor } from '../lib/blueprint/capture'

/** A press held this long without moving places (a long press). */
export const LONG_PRESS_MS = 420
/** How far a press may wander, CSS pixels, and still be a tap or a long press. */
const TAP_SLOP = 8

/** The first-visit hint's three steps, in plain words. */
export const HINT_STEPS = [
  'Mine a block: tap or click it (Q).',
  'Place it back: PLACE, or right click (E).',
  'Open your bag: the last slot of the bar (I).',
] as const

/** The chunk you stand in, or null. */
function hereKey(): string | null {
  const s = terrainSession
  if (!s) return null
  const w = offsetOf(s, headNow())
  return s.world.slotAtCs(w[0], w[1], w[2])?.key ?? null
}

/** The chunk SURVEY would fill now (store/useTerrain.ts surveyTarget). */
export function surveyTarget(): string | null {
  return targetNow()
}

function Swatch({ id, size = 22 }: { id: number; size?: number }): JSX.Element {
  const k = blockKind(id)
  const url = k ? tileUrl(k) : ''
  const style = { '--sw-face': k?.color ?? 'transparent', '--sw-edge': k?.edge ?? 'transparent', width: size, height: size, ...(url ? { backgroundImage: `url(${url})` } : {}) } as CSSProperties
  return <span className={`terrain-swatch${k?.glow ? ' terrain-swatch--glow' : ''}`} style={style} aria-hidden />
}

/**
 * The chosen block, carried (owner, 2026-11-24: "whatever item you have
 * selected, can we carry a small tilted version of it on the lower right side
 * of the screen?", and "the block is meant to be in the bottom right of the
 * whole screen under all ui elements. make it a little bigger too like we're
 * holding it"): a cube of its own tiles, tilted as if held in the right
 * hand, partly off the bottom right corner of the screen, under every
 * control and the menu, never taking a tap. CSS 3D, so it never clips into
 * the world and never blooms. It sways while a walk is under way and dips
 * when a block is mined or placed. Hidden with an empty slot or none left.
 */
function HeldBlock(): JSX.Element | null {
  const inv = useTerrain((s) => s.inventory)
  const walking = useWalk((w) => w.behind > 0 || w.open !== null)
  const id = inv.hotbar[inv.slot]
  const k = id && !isCompiler(id) && (inv.counts[id] ?? 0) > 0 ? blockKind(id) : null
  // A dip each time what you carry changes by a mine or a place (the counts change; choosing a slot does not).
  const [dip, setDip] = useState(0)
  const counts = useRef(inv.counts)
  useEffect(() => {
    if (counts.current === inv.counts) return
    counts.current = inv.counts
    setDip((d) => d + 1)
  }, [inv.counts])
  if (!k) return null
  const face = (f: number): CSSProperties => ({ backgroundColor: k.color, backgroundImage: `url(${tileUrl(k, f)})` })
  return (
    <div className={`terrain-held${walking ? ' is-walking' : ''}`} aria-hidden>
      <div key={dip} className={`terrain-held__dip${dip > 0 ? ' is-dipping' : ''}`}>
        <div className="terrain-held__cube">
          <span className="terrain-held__face terrain-held__face--top" style={face(0)} />
          <span className="terrain-held__face terrain-held__face--front" style={face(1)} />
          <span className="terrain-held__face terrain-held__face--right" style={face(1)} />
          <span className="terrain-held__face terrain-held__face--left" style={face(1)} />
          <span className="terrain-held__face terrain-held__face--back" style={face(1)} />
          <span className="terrain-held__face terrain-held__face--bottom" style={face(2)} />
        </div>
      </div>
    </div>
  )
}

/** Wheel steps: a notch (this many pixels or more in one event) or small scrolls adding up to it choose the next slot. */
export const WHEEL_STEP = 40

/**
 * The wheel chooses the hotbar slot in TERRAIN (owner, 2026-11-24: "can the
 * scroll wheel change the hotbar selection?"): down the next, up the one
 * before, round the nine, while the pointer is over the scene or captured.
 * Over a menu or a panel the wheel scrolls as ever. The scene's own wheel
 * zoom is already off while walking (scene/Scene.tsx enableZoom), so nothing
 * else hears it here. Returns what stops it.
 */
export function terrainWheel(on: EventTarget): () => void {
  let acc = 0
  const wheel = (ev: Event): void => {
    const e = ev as WheelEvent
    if (!mouseLocked() && !onScene(e)) return
    const st = useTerrain.getState()
    if (st.sheet) return
    const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)
    // A mouse's notch is one slot, however many pixels it says; a trackpad's small deltas add up to one.
    acc = Math.abs(d) >= WHEEL_STEP ? Math.sign(d) * WHEEL_STEP : acc + d
    const n = st.inventory.hotbar.length
    let slot = st.inventory.slot
    if (acc >= WHEEL_STEP) { slot = (slot + 1) % n; acc = 0 }
    else if (acc <= -WHEEL_STEP) { slot = (slot + n - 1) % n; acc = 0 }
    if (slot !== st.inventory.slot) st.selectSlot(slot)
  }
  on.addEventListener('wheel', wheel, { passive: true })
  return () => on.removeEventListener('wheel', wheel)
}

function Key({ children }: { children: ReactNode }): JSX.Element {
  return <kbd className="terrain-key">{children}</kbd>
}

function Hotbar(): JSX.Element {
  const inv = useTerrain((s) => s.inventory)
  return (
    <div className="terrain-hotbar" role="toolbar" aria-label="Blocks you carry" data-chat-avoid>
      {inv.hotbar.map((id, i) => {
        // The Compiler, once made, in slot 1 for good (owner, 2026-11-27).
        if (isCompiler(id)) {
          return (
            <button
              key={i}
              className={`terrain-slot terrain-slot--compiler${i === inv.slot ? ' is-on' : ''}`}
              onClick={(e) => { e.currentTarget.blur(); useTerrain.getState().selectSlot(i) }}
              aria-label={`The Compiler, slot ${i + 1}`}
              aria-pressed={i === inv.slot}
              title={`The Compiler: hold SMASH (${i + 1})`}
            >
              <span className="terrain-slot__num">{i + 1}</span>
              <Hammer size={18} strokeWidth={2} aria-hidden />
              <span className="terrain-slot__count" />
            </button>
          )
        }
        const n = id ? inv.counts[id] ?? 0 : 0
        return (
          <button
            key={i}
            className={`terrain-slot${i === inv.slot ? ' is-on' : ''}${id && n === 0 ? ' is-out' : ''}`}
            onClick={(e) => { e.currentTarget.blur(); useTerrain.getState().selectSlot(i) }}
            aria-label={id ? `${blockName(id)}, ${n} carried, slot ${i + 1}` : `Empty slot ${i + 1}`}
            aria-pressed={i === inv.slot}
            title={id ? `${blockName(id)}: ${n} (${i + 1})` : `Empty slot (${i + 1})`}
          >
            <span className="terrain-slot__num">{i + 1}</span>
            {id ? <Swatch id={id} /> : null}
            <span className="terrain-slot__count">{id ? n : ''}</span>
          </button>
        )
      })}
      <button className="terrain-slot terrain-slot--bag" onClick={(e) => { e.currentTarget.blur(); useTerrain.getState().setSheet(true) }} aria-label="Open the inventory (I)" title="Inventory (I)">
        <Backpack size={18} strokeWidth={2} aria-hidden />
        <span className="terrain-slot__num">I</span>
      </button>
    </div>
  )
}

function InventorySheet(): JSX.Element | null {
  const open = useTerrain((s) => s.sheet)
  const inv = useTerrain((s) => s.inventory)
  if (!open) return null
  const kinds = Object.entries(inv.counts).map(([id, n]) => [Number(id), n] as const).filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0])
  const close = (): void => useTerrain.getState().setSheet(false)
  return (
    <div className="terrain-sheet" role="dialog" aria-modal="true" aria-label="Inventory" onPointerDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="terrain-sheet__card terrain-sheet__card--bag">
        <div className="terrain-sheet__head">
          <Backpack size={16} strokeWidth={2} aria-hidden />
          <h2>INVENTORY</h2>
          <ModalClose onClose={close} title="Close (I or Esc)" />
        </div>
        {/* What scrolls, under a title line that stays: the card's frame and fill stand still around it. */}
        <div className="terrain-sheet__body">
          <p className="terrain-sheet__sub">Kept on this device. Tap a block to put it in slot&nbsp;{inv.slot + 1}.</p>
          {kinds.length === 0
            ? <p className="terrain-sheet__empty">Nothing yet: mine a block to carry it.</p>
            : (
              <div className="terrain-sheet__grid">
                {kinds.map(([id, n]) => (
                  <button key={id} className={`terrain-kind${inv.hotbar[inv.slot] === id ? ' is-on' : ''}`} onClick={() => useTerrain.getState().assignSlot(id)} aria-label={`${blockName(id)}, ${n}: put in slot ${inv.slot + 1}`}>
                    <Chamfer size={64}><Swatch id={id} size={34} /></Chamfer>
                    <span className="terrain-kind__name">{blockName(id)}</span>
                    <span className="terrain-kind__count">{n}</span>
                  </button>
                ))}
              </div>
            )}
          <ShareLine />
          <CrewPanel />
        </div>
      </div>
      <CrewLayer />
    </div>
  )
}

/** The status line's words: where you stand, in plain words (messages have their own slot under the cross). */
function standingWords(loading: boolean, surveying: boolean, target: string | null): string {
  if (loading) return 'Loading your blocks'
  if (surveying) return 'Surveying'
  if (target) return target === hereKey() ? 'Empty here: SURVEY' : 'Empty ahead: SURVEY'
  return 'Build near your avatar'
}

/** COMPILING under the cross while a smash's answer is late (design page 4.3): past the shatter, still pending. */
function useCompiling(): boolean {
  const show = useSmashFx((s) => s.show)
  const [late, setLate] = useState(false)
  useEffect(() => {
    setLate(false)
    if (!show || show.outcome !== 'pending') return
    const t = window.setTimeout(() => setLate(true), Math.max(0, show.struck + RESOLVE_AFTER_MS + 200 - performance.now()))
    return () => clearTimeout(t)
  }, [show])
  return late && show?.outcome === 'pending'
}

/** The survey target, looked at a few times a second (it follows the body and the look). */
function useSurveyTarget(): string | null {
  const [target, setTarget] = useState<string | null>(null)
  useEffect(() => {
    const t = window.setInterval(() => setTarget(surveyTarget()), 250)
    return () => clearInterval(t)
  }, [])
  return target
}

export function TerrainView({ covered = false }: { covered?: boolean }): JSX.Element | null {
  const active = useTerrain((s) => s.active)
  const compiler = useTerrain((s) => isCompiler(s.inventory.hotbar[s.inventory.slot]))
  const owns = useTerrain((s) => !!s.inventory.compiler)
  return active ? <>{owns && <HeldCompiler shown={compiler} />}{!compiler && <HeldBlock />}<TerrainScreen covered={covered} /></> : null
}

/** A press held longer than this is not a tap: it does not mine. */
const LONG_MS = LONG_PRESS_MS

/** Whether an event is on the cyberspace scene's canvas (not the compass's, not a HUD's). */
function onScene(e: Event): HTMLCanvasElement | null {
  const t = e.target as HTMLElement | null
  if (!t || t.tagName !== 'CANVAS' || t.closest('.compass-3d, .benchorb, .orbsquare')) return null
  return t as HTMLCanvasElement
}

/**
 * The mouse captured for looking (owner, 2026-11-24: "Can we capture the
 * mouse when we enter terrain mode for proper mouse looking?"): on a desktop
 * pointer only, never on touch. Entering TERRAIN asks for the lock on the
 * scene's canvas; Esc frees it (the browser does that); a click on the scene
 * takes it again; leaving TERRAIN, the bag, or a menu or panel opening frees
 * it. A refused lock is no harm: the mouse drags to look as in WALK.
 */
let lockWanted = false
/** When the lock last went away, for Esc: the press that freed the mouse does not also leave TERRAIN. */
let lockLostAt = -Infinity
let hinted = false

/** Whether this device's pointer is a mouse that can be captured. */
export function canLockMouse(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (!('requestPointerLock' in Element.prototype)) return false
  return window.matchMedia?.('(pointer: fine) and (hover: hover)').matches === true
}

/** Whether the mouse is captured by the scene now. */
export function mouseLocked(): boolean {
  const el = typeof document !== 'undefined' ? document.pointerLockElement : null
  return !!el && el.tagName === 'CANVAS'
}

/** The scene's canvas: the largest that is not a control's own (the compass, the LOOK ball, the workshop, a card's shard). */
function sceneCanvas(): HTMLCanvasElement | null {
  let best: HTMLCanvasElement | null = null, area = 0
  for (const c of Array.from(document.querySelectorAll('canvas'))) {
    if (c.closest('.compass-3d, .benchorb, .orbsquare, .workshop, .thumbstage, .shardspin, .modal')) continue
    const r = c.getBoundingClientRect()
    if (r.width * r.height > area) { area = r.width * r.height; best = c }
  }
  return best
}

function lockMouse(canvas: HTMLCanvasElement | null = sceneCanvas()): void {
  if (!canvas || mouseLocked()) return
  try {
    const asked = canvas.requestPointerLock() as unknown
    if (asked && typeof (asked as Promise<void>).catch === 'function') (asked as Promise<void>).catch(() => { /* refused: the mouse drags to look */ })
  } catch { /* refused */ }
}

/** True when an Esc now is the one that just freed the mouse (TERRAIN stays). */
export function escFreedMouse(now: number = performance.now()): boolean {
  return now - lockLostAt < 400
}

/** Capture the mouse for TERRAIN's visit; returns what lets it go. */
export function terrainMouseLock(): () => void {
  if (!canLockMouse()) return () => {}
  lockWanted = true
  const change = (): void => {
    if (mouseLocked()) {
      if (!hinted) { hinted = true; useTerrain.getState().say('Esc to free the mouse') }
    } else lockLostAt = performance.now()
  }
  document.addEventListener('pointerlockchange', change)
  document.addEventListener('pointerlockerror', change)
  lockMouse()
  // A menu, a panel or the bag opening frees the mouse, so it can use them.
  const watch = window.setInterval(() => {
    if (mouseLocked() && (topEscape() !== null || useTerrain.getState().sheet || document.querySelector('[aria-modal="true"]'))) document.exitPointerLock()
  }, 200)
  return () => {
    lockWanted = false
    window.clearInterval(watch)
    document.removeEventListener('pointerlockchange', change)
    document.removeEventListener('pointerlockerror', change)
    if (mouseLocked()) document.exitPointerLock()
  }
}

/**
 * The scene's pointer in TERRAIN, heard on `on` (the window, in capture)
 * alongside WALK's, which still looks on a drag: a tap or a click mines at
 * the point, the mouse's second button places, the mouse resting aims the
 * cursor (owner: "Tap to mine, place with a button"). A tap never folds the
 * controls here (usePad takeSceneTaps). Returns what stops it.
 */
export function terrainPointer(on: EventTarget): () => void {
  let press: { id: number; x: number; y: number; moved: number; t: number; canvas: HTMLCanvasElement } | null = null
  const ndc = (c: HTMLCanvasElement, x: number, y: number): { x: number; y: number } => {
    const r = c.getBoundingClientRect()
    return { x: ((x - r.left) / r.width) * 2 - 1, y: -(((y - r.top) / r.height) * 2 - 1) }
  }
  const end = (): void => { press = null }
  const down = (ev: Event): void => {
    const e = ev as PointerEvent
    terrainInput.swallowTap = false
    const c = onScene(e)
    if (!c || useTerrain.getState().sheet) return
    // The mouse captured (terrainMouseLock): a click mines and a right click places at the cross.
    if (e.pointerType === 'mouse' && mouseLocked()) {
      if (e.button === 0) terrainInput.action = { kind: 'mine', at: null }
      else if (e.button === 2) terrainInput.action = { kind: 'place', at: null }
      return
    }
    // Freed with Esc: a click on the scene captures the mouse again, and does nothing else.
    // R3F hears the same press below the window: it is swallowed there, so no shard under the pointer opens (scene/TapOccluder.tsx).
    if (e.pointerType === 'mouse' && e.button === 0 && lockWanted) { terrainInput.swallowTap = true; lockMouse(c); return }
    if (e.pointerType === 'mouse' && e.button === 2) { terrainInput.action = { kind: 'place', at: ndc(c, e.clientX, e.clientY) }; return }
    if (e.pointerType === 'mouse' && e.button !== 0) return
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now(), canvas: c }
  }
  const move = (ev: Event): void => {
    const e = ev as PointerEvent
    // Captured, the mouse looks, as a drag does in WALK, and the cross aims.
    if (e.pointerType === 'mouse' && mouseLocked()) { walkLookBy(e.movementX ?? 0, e.movementY ?? 0); terrainInput.hover = null; return }
    const c = onScene(e)
    if (e.pointerType === 'mouse') terrainInput.hover = c ? ndc(c, e.clientX, e.clientY) : null
    if (!press || press.id !== e.pointerId) return
    press.moved += Math.abs(e.movementX ?? 0) + Math.abs(e.movementY ?? 0)
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP) press.moved = TAP_SLOP + 1
  }
  const up = (ev: Event): void => {
    const e = ev as PointerEvent
    const p = press
    if (!p || p.id !== e.pointerId) return
    if (p.moved <= TAP_SLOP && performance.now() - p.t < LONG_MS) terrainInput.action = { kind: 'mine', at: ndc(p.canvas, p.x, p.y) }
    end()
  }
  const menu = (e: Event): void => { if (onScene(e)) e.preventDefault() }
  on.addEventListener('pointerdown', down, true)
  on.addEventListener('pointermove', move, true)
  on.addEventListener('pointerup', up, true)
  on.addEventListener('pointercancel', end, true)
  on.addEventListener('contextmenu', menu, true)
  return () => {
    end()
    // Leaving TERRAIN never leaves a press swallowed.
    terrainInput.swallowTap = false
    on.removeEventListener('pointerdown', down, true)
    on.removeEventListener('pointermove', move, true)
    on.removeEventListener('pointerup', up, true)
    on.removeEventListener('pointercancel', end, true)
    on.removeEventListener('contextmenu', menu, true)
  }
}

/** Survey the chunk SURVEY offers now (the one you stand in, else the one ahead), or say there is none. */
export function surveyNow(): void {
  const key = surveyTarget()
  if (key) void useTerrain.getState().survey(key)
  else useTerrain.getState().say('Everything here is surveyed.')
}

/** Start the 5 second hold that surveys when it completes (surveyHold.ts). */
export function holdSurvey(): void {
  startSurveyHold(surveyNow)
}

/**
 * TERRAIN's own keys, heard on `on` (the window, in capture) ahead of the rest:
 * the tools, T and Esc; G is a hold (surveyHold.ts), its repeats ignored and its
 * release before the end a cancel. Returns what stops them.
 */
export function terrainKeys(on: EventTarget): () => void {
  const down = (ev: Event): void => {
    const e = ev as KeyboardEvent
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement | null
    if (target?.closest?.('input, textarea, [contenteditable="true"]')) return
    const st = useTerrain.getState()
    const take = (): void => { e.preventDefault(); e.stopImmediatePropagation() }
    if (e.code === 'Escape') { if (mouseLocked() || escFreedMouse()) { take(); return } if (st.sheet) { take(); if (!closeCrewLayer()) st.setSheet(false) } else if (crewChipAsking()) { /* the Crew chip's Esc dismisses it (TerrainCrew.tsx), never leaves TERRAIN */ } else if (topEscape() === null && !document.querySelector('[aria-modal="true"]')) { take(); leaveTerrain() } return }
    if (e.code === 'KeyT') { take(); if (!e.repeat) leaveTerrain(); return }
    if (e.code === 'KeyI') { take(); if (!e.repeat) st.setSheet(!st.sheet); return }
    if (st.sheet) return
    const slot = slotKey(e.code)
    if (slot !== null) { take(); st.selectSlot(slot); return }
    if (e.code === 'KeyG') { take(); if (!e.repeat) holdSurvey(); return }
    if (e.code === 'KeyF') { take(); if (!e.repeat) holdSmash(); return }
    if (e.code === 'KeyR' && useBlueprintTool.getState().capturing) { take(); if (!e.repeat) recordAtCursor(); return }
    if (e.code === 'KeyQ') { take(); if (!e.repeat) terrainInput.action = { kind: 'mine', at: null }; return }
    if (e.code === 'KeyE') { take(); if (!e.repeat) terrainInput.action = { kind: 'place', at: null } }
  }
  // G held: letting it up before the bar fills cancels the survey.
  const up = (ev: Event): void => {
    const code = (ev as KeyboardEvent).code
    if (code === 'KeyG') cancelSurveyHold()
    if (code === 'KeyF') cancelSmashHold()
  }
  const blur = (): void => { cancelSurveyHold(); cancelSmashHold() }
  on.addEventListener('keydown', down, true)
  on.addEventListener('keyup', up, true)
  const win = typeof window !== 'undefined' ? window : null
  win?.addEventListener('blur', blur)
  return () => {
    on.removeEventListener('keydown', down, true)
    on.removeEventListener('keyup', up, true)
    win?.removeEventListener('blur', blur)
    cancelSurveyHold()
    cancelSmashHold()
  }
}

function TerrainScreen({ covered }: { covered: boolean }): JSX.Element {
  // The bag open: on a phone it covers the screen as the menu does (styles.css .is-bag; App's crowded hides the rest).
  const bag = useTerrain((st) => st.sheet)
  // The pad put away (on a phone the open chat takes its column, usePad): PLACE, SURVEY, the hotbar, the steps and the
  // carried block go with it and LOOK (hud/WalkLookSphere.tsx), each keeping its place, and come back with CONTROLS.
  const folded = usePad((st) => !st.open)
  const message = useTerrain((s) => s.message)
  const hint = useTerrain((s) => s.hint)
  const loading = useTerrain((s) => s.loading)
  const surveying = useTerrain((s) => s.surveying.length > 0)
  const target = useSurveyTarget()
  const standing = standingWords(loading, surveying, target)
  // Loading or surveying is said under the cross while it lasts; nothing else is, so the scene stays clear.
  const catching = loading || surveying

  // A fresh cursor at every visit.
  useEffect(() => { resetTerrainInput() }, [])

  const holding = useSurveyHold((s) => s.since !== null)
  const smashing = useSmashHold((s) => s.since !== null)
  const smashMs = useSmashHold((s) => s.ms)
  const bare = useTerrain((s) => !isCompiler(s.inventory.hotbar[s.inventory.slot]))
  const compiling = useCompiling()
  const here = usePrizesHere()
  const capturing = useBlueprintTool((s) => s.capturing)
  // A SURVEY or SMASH hold the fold hides would never hear its finger lift: it ends there.
  useEffect(() => { if (folded) { cancelSurveyHold(); cancelSmashHold() } }, [folded])
  // A tour run guides TERRAIN itself (tutorial/terrainRoute.ts): its own three steps wait until after, their slot kept.
  const touring = useTutorial((s) => s.active)

  // TERRAIN's own keys, ahead of the rest (capture): the tools, T and Esc. WALK's keys go on to WALK (hooks/useKeyboard.ts).
  useEffect(() => terrainKeys(window), [])

  // The scene's pointer, heard alongside WALK's (which still looks on a drag), and the mouse captured on a desktop.
  useEffect(() => terrainPointer(window), [])
  useEffect(() => terrainMouseLock(), [])
  useEffect(() => terrainWheel(window), [])

  return (
    <div className={`terrainview${covered ? ' is-covered' : ''}${bag ? ' is-bag' : ''}${folded ? ' is-folded' : ''}`} role="group" aria-label="TERRAIN: block tools" aria-hidden={covered || undefined}>
      <span className="terrain-crosshair" aria-hidden />

      {/* What just happened (a refusal, a survey), under the cross, in a slot of its own: up to two lines, nothing moves. */}
      <div className="terrain-message" role="status" aria-live="polite">{message ? <span className="terrain-message__text">{message}</span> : compiling ? <span className="terrain-message__text terrain-message__text--compiling">COMPILING</span> : catching ? <span className="terrain-message__text">{standing}</span> : null}</div>

      {/* The first visit's three steps, just over the hotbar, in a slot of its own. */}
      <div className="terrain-hint" aria-live="polite">
        {capturing ? (
          <span className="prize-strip prize-strip--record" role="group" aria-label="Record a blueprint">
            <span className="prize-strip__count">Aim at a build that stands alone</span>
            <button className="prize-strip__btn prize-strip__btn--go" onClick={recordAtCursor}>RECORD<Key>R</Key></button>
            <button className="prize-strip__btn" onClick={() => { useBlueprintTool.getState().set({ capturing: false, open: true }); leaveTerrain() }}>BACK</button>
          </span>
        ) : here.length > 0 ? <PrizeStrip here={here} /> : !loading && hint < HINT_DONE && !touring && (
          <span className="terrain-hint__box"><span className="terrain-hint__step">{hint + 1} of 3</span>{HINT_STEPS[hint]}</span>
        )}
      </div>

      {/* PLACE beside FORWARD, and SURVEY (a hold) beside the row under it, while one is offered: just right of WALK's
          walk pad (owner, 2026-11-24), clear of the right column the menu opens over. Mining is a tap on the scene. */}
      <div className="terrain-tools" aria-label="Smash, place and survey">
        {/* SMASH, a hold (smashHold.ts): 3 seconds with the Compiler, 20 with a bare hand. Its slot is always there. */}
        <span className="terrain-tools__slot terrain-tools__slot--smash">
          <button
            className={`terrain-act terrain-act--smash${smashing ? ' is-holding' : ''}${bare ? ' is-bare' : ''}`}
            style={{ ['--hold-ms' as string]: `${smashMs || 3000}ms` }}
            {...noCallout}
            onPointerDown={(e) => {
              e.preventDefault(); e.stopPropagation()
              try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
              holdSmash()
            }}
            onPointerUp={cancelSmashHold}
            onPointerLeave={cancelSmashHold}
            onPointerCancel={cancelSmashHold}
            title={bare ? 'Hold to smash the blocks at the cross with your bare hand (hold F, 20 seconds)' : 'Hold to smash the blocks at the cross with the Compiler (hold F)'}
            aria-label="Hold to smash (hold F)"
          >
            <Hammer size={15} strokeWidth={2.25} aria-hidden />{smashing ? 'Smashing' : 'SMASH'}<Key>F</Key>
            <span className="terrain-act__bar" aria-hidden />
          </button>
        </span>
        <button className="terrain-act terrain-act--place" {...noCallout} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); terrainInput.action = { kind: 'place', at: null } }} title="Place the chosen block on the face at the cross (E, or right click)" aria-label="Place (E)"><Box size={15} strokeWidth={2.25} aria-hidden />PLACE<Key>E</Key></button>
        <span className="terrain-tools__slot">
          {(target || surveying || holding) && (
            <button
              className={`terrain-act terrain-act--survey${holding ? ' is-holding' : ''}`}
              disabled={surveying}
              {...noCallout}
              onPointerDown={(e) => {
                e.preventDefault(); e.stopPropagation()
                // Let go of the implicit capture, so a finger sliding off the button leaves it and cancels.
                try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
                if (!surveying) holdSurvey()
              }}
              onPointerUp={cancelSurveyHold}
              onPointerLeave={cancelSurveyHold}
              onPointerCancel={cancelSurveyHold}
              title="Hold to fill this chunk with the ground everyone computes the same (hold G)"
              aria-label="Hold to survey (hold G)"
            >
              <Radar size={15} strokeWidth={2.25} aria-hidden />{surveying ? '...' : holding ? 'Surveying' : 'SURVEY'}<Key>G</Key>
              <span className="terrain-act__bar" aria-hidden />
            </button>
          )}
        </span>
      </div>

      <TerrainCrew />
      <Hotbar />
      <InventorySheet />
      <PrizeCard />
      <PrizePicker here={here} />
      <PrizeFlights />
    </div>
  )
}

/** For tests: what the cursor points at now. */
export const cursorNow = (): typeof terrainCursor.hit => terrainCursor.hit
