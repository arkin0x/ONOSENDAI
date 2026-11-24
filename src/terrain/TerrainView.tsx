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
 * - The hotbar, 1 to 9, and the bag (I): what you carry, on this device.
 * - T or Esc goes back to the mode you came from; the mode button goes on
 *   round the ring.
 *
 * The owner's taste: white text with a dark shadow over the scene, no
 * jargon, no layout jumps (every slot kept), lucide icons, chamfered frames,
 * key hints, the shared ✕, colons in copy.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Backpack, Box, Radar } from 'lucide-react'
import { HINT_DONE, headNow, offsetOf, surveyTarget as targetNow, terrainSession, useTerrain } from '../store/useTerrain'
import { terrainCursor } from '../scene/TerrainLayer'
import { leaveTerrain } from '../store/padMode'
import { resetTerrainInput, slotKey, terrainInput } from './terrainInput'
import { blockKind, blockName } from '../lib/terrain/blocks'
import { tileUrl } from '../lib/terrain/tiles'
import { ModalClose } from '../hud/ui/ModalClose'
import { Chamfer } from '../hud/ui/Chamfer'
import { noCallout } from '../hooks/useRepeatable'

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

function Key({ children }: { children: ReactNode }): JSX.Element {
  return <kbd className="terrain-key">{children}</kbd>
}

function Hotbar(): JSX.Element {
  const inv = useTerrain((s) => s.inventory)
  return (
    <div className="terrain-hotbar" role="toolbar" aria-label="Blocks you carry">
      {inv.hotbar.map((id, i) => {
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
  const waiting = useTerrain((s) => s.waiting)
  if (!open) return null
  const kinds = Object.entries(inv.counts).map(([id, n]) => [Number(id), n] as const).filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0])
  const close = (): void => useTerrain.getState().setSheet(false)
  return (
    <div className="terrain-sheet" role="dialog" aria-modal="true" aria-label="Inventory" onPointerDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="terrain-sheet__card">
        <div className="terrain-sheet__head">
          <Backpack size={16} strokeWidth={2} aria-hidden />
          <h2>INVENTORY</h2>
          <ModalClose onClose={close} title="Close (I or Esc)" />
        </div>
        <p className="terrain-sheet__sub">Kept on this device. Tap a block to put it in slot {inv.slot + 1}.</p>
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
        <p className="terrain-sheet__foot">{waiting > 0 ? `${waiting} ${waiting === 1 ? 'change' : 'changes'} kept on this device. Nothing is published yet.` : 'Your changes are kept on this device. Nothing is published yet.'}</p>
        <dl className="terrain-sheet__keys">
          <div><dt><Key>W A S D</Key></dt><dd>walk</dd></div>
          <div><dt><Key>SPACE</Key></dt><dd>jump</dd></div>
          <div><dt><Key>TAP</Key> <Key>CLICK</Key></dt><dd>mine</dd></div>
          <div><dt><Key>LONG PRESS</Key> <Key>RIGHT CLICK</Key></dt><dd>place</dd></div>
          <div><dt><Key>1 to 9</Key></dt><dd>choose a block</dd></div>
          <div><dt><Key>G</Key></dt><dd>survey</dd></div>
          <div><dt><Key>T</Key></dt><dd>back to BUILD</dd></div>
        </dl>
      </div>
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

/** The survey target, looked at a few times a second (it follows the body and the look). */
function useSurveyTarget(): string | null {
  const [target, setTarget] = useState<string | null>(null)
  useEffect(() => {
    const t = window.setInterval(() => setTarget(surveyTarget()), 250)
    return () => clearInterval(t)
  }, [])
  return target
}

export function TerrainView(): JSX.Element | null {
  const active = useTerrain((s) => s.active)
  return active ? <TerrainScreen /> : null
}

/** A press held this long on the scene without moving places (a long press). */
const LONG_MS = LONG_PRESS_MS

/** Whether an event is on the cyberspace scene's canvas (not the compass's, not a HUD's). */
function onScene(e: Event): HTMLCanvasElement | null {
  const t = e.target as HTMLElement | null
  if (!t || t.tagName !== 'CANVAS' || t.closest('.compass-3d, .benchorb, .orbsquare')) return null
  return t as HTMLCanvasElement
}

function TerrainScreen(): JSX.Element {
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

  const doSurvey = (): void => {
    const key = surveyTarget()
    if (key) void useTerrain.getState().survey(key)
    else useTerrain.getState().say('Everything here is surveyed.')
  }

  // TERRAIN's own keys, ahead of the rest (capture): the tools, T and Esc. WALK's keys go on to WALK (hooks/useKeyboard.ts).
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return
      const st = useTerrain.getState()
      const take = (): void => { e.preventDefault(); e.stopImmediatePropagation() }
      if (e.code === 'Escape') { if (st.sheet) { take(); st.setSheet(false) } else if (!document.querySelector('[aria-modal="true"]')) { take(); leaveTerrain() } return }
      if (e.code === 'KeyT') { take(); if (!e.repeat) leaveTerrain(); return }
      if (e.code === 'KeyI') { take(); if (!e.repeat) st.setSheet(!st.sheet); return }
      if (st.sheet) return
      const slot = slotKey(e.code)
      if (slot !== null) { take(); st.selectSlot(slot); return }
      if (e.code === 'KeyG') { take(); if (!e.repeat) doSurvey(); return }
      if (e.code === 'KeyQ') { take(); if (!e.repeat) terrainInput.action = { kind: 'mine', at: null }; return }
      if (e.code === 'KeyE') { take(); if (!e.repeat) terrainInput.action = { kind: 'place', at: null } }
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [])

  // The scene's pointer, heard alongside WALK's (which still looks on a drag): a tap or a click mines at the point,
  // the mouse's second button places, the mouse resting aims the cursor (owner: "Tap to mine, place with a button").
  useEffect(() => {
    let press: { id: number; x: number; y: number; moved: number; t: number; done: boolean; timer: number; canvas: HTMLCanvasElement } | null = null
    const ndc = (c: HTMLCanvasElement, x: number, y: number): { x: number; y: number } => {
      const r = c.getBoundingClientRect()
      return { x: ((x - r.left) / r.width) * 2 - 1, y: -(((y - r.top) / r.height) * 2 - 1) }
    }
    const end = (): void => { if (press) clearTimeout(press.timer); press = null }
    const down = (e: PointerEvent): void => {
      const c = onScene(e)
      if (!c || useTerrain.getState().sheet) return
      if (e.pointerType === 'mouse' && e.button === 2) { terrainInput.action = { kind: 'place', at: ndc(c, e.clientX, e.clientY) }; return }
      if (e.pointerType === 'mouse' && e.button !== 0) return
      end()
      const p = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now(), done: false, timer: 0, canvas: c }
      press = p
    }
    const move = (e: PointerEvent): void => {
      const c = onScene(e)
      if (e.pointerType === 'mouse') terrainInput.hover = c ? ndc(c, e.clientX, e.clientY) : null
      if (!press || press.id !== e.pointerId) return
      press.moved += Math.abs(e.movementX ?? 0) + Math.abs(e.movementY ?? 0)
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP) press.moved = TAP_SLOP + 1
    }
    const up = (e: PointerEvent): void => {
      const p = press
      if (!p || p.id !== e.pointerId) return
      if (!p.done && p.moved <= TAP_SLOP && performance.now() - p.t < LONG_MS) terrainInput.action = { kind: 'mine', at: ndc(p.canvas, p.x, p.y) }
      end()
    }
    const menu = (e: MouseEvent): void => { if (onScene(e)) e.preventDefault() }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', end, true)
    window.addEventListener('contextmenu', menu, true)
    return () => {
      end()
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', end, true)
      window.removeEventListener('contextmenu', menu, true)
    }
  }, [])

  return (
    <div className="terrainview" role="group" aria-label="TERRAIN: block tools">
      <span className="terrain-crosshair" aria-hidden />

      {/* What just happened (a refusal, a survey), under the cross, in a slot of its own: up to two lines, nothing moves. */}
      <div className="terrain-message" role="status" aria-live="polite">{message ? <span className="terrain-message__text">{message}</span> : catching ? <span className="terrain-message__text">{standing}</span> : null}</div>

      {/* The first visit's three steps, just over the hotbar, in a slot of its own. */}
      <div className="terrain-hint" aria-live="polite">
        {!loading && hint < HINT_DONE && (
          <span className="terrain-hint__box"><span className="terrain-hint__step">{hint + 1} of 3</span>{HINT_STEPS[hint]}</span>
        )}
      </div>

      {/* PLACE, and SURVEY while one is offered: a column beside WALK's LOOK ball, in WALK's layout. Mining is a tap on the scene. */}
      <div className="terrain-tools" aria-label="Place and survey">
        <span className="terrain-tools__slot">
          {(target || surveying) && (
            <button className="terrain-act terrain-act--survey" disabled={surveying} {...noCallout} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); if (!surveying) doSurvey() }} title="Fill this chunk with the ground everyone computes the same (G)" aria-label="Survey (G)">
              <Radar size={15} strokeWidth={2.25} aria-hidden />{surveying ? '...' : 'SURVEY'}<Key>G</Key>
            </button>
          )}
        </span>
        <button className="terrain-act" {...noCallout} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); terrainInput.action = { kind: 'place', at: null } }} title="Place the chosen block on the face at the cross (E, or right click)" aria-label="Place (E)"><Box size={15} strokeWidth={2.25} aria-hidden />PLACE<Key>E</Key></button>
      </div>

      <Hotbar />
      <InventorySheet />
    </div>
  )
}

/** For tests: what the cursor points at now. */
export const cursorNow = (): typeof terrainCursor.hit => terrainCursor.hit
