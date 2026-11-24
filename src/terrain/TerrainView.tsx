/**
 * TerrainView.tsx - TERRAIN mode on screen: the builder's view full screen
 * over cyberspace, on a canvas of its own (as a game's is, game/GameView.tsx),
 * and its controls.
 *
 * Cyberspace is not drawn meanwhile (scene/frameDriver.tsx stops its frames),
 * and it is exactly as you left it when you come back: BUILD is still on, the
 * build cursor where it was. Nothing here is signed or published.
 *
 * Controls (every key printed beside its button):
 * - W A S D or the arrows walk, Space jumps; in a chunk not yet surveyed the
 *   body floats, and Space and Shift go up and down.
 * - Drag the scene to look (WALK's own gain, lib/walkLook.ts), or drag the
 *   LOOK ball on a touch screen.
 * - A click or a tap mines the block under it; the second mouse button, or a
 *   long press, places the chosen block on the face under it. MINE (Q) and
 *   PLACE (E) do the same at the cursor in the middle of the screen.
 * - 1 to 9 choose a hotbar slot; I or the bag opens the inventory.
 * - G surveys the chunk you are in, or the next one you look at.
 * - T or Esc leaves, back to BUILD.
 *
 * The owner's taste (2026-11-15/17): white text with a dark shadow over the
 * scene, no jargon, no layout jumps (the status line and the hint keep their
 * slots), lucide icons, chamfered frames, key hints, the shared ✕.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { Backpack, Blocks, Box, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsDown, ChevronsUp, Pickaxe, Radar } from 'lucide-react'
import { HINT_DONE, bodyWorld, chunkAtView, surveyTargetOf, terrainSession, useTerrain } from '../store/useTerrain'
import { TerrainScene, terrainCursor } from './TerrainScene'
import { MOVE_KEYS, hold, release, releaseAll, resetTerrainInput, slotKey, terrainInput, turnLook } from './terrainInput'
import { BG } from '../lib/palette'
import { blockKind, blockName } from '../lib/terrain/blocks'
import { tileUrl } from '../lib/terrain/tiles'
import { lookRadPerPx, sphereRadPerPx } from '../lib/walkLook'
import { gravityHolds } from '../lib/terrain/body'
import { OrbitSphere } from '../hud/ui/OrbitSphere'
import { ModalClose } from '../hud/ui/ModalClose'
import { Chamfer } from '../hud/ui/Chamfer'
import { noCallout } from '../hooks/useRepeatable'
import { FOG_FAR } from './terrainMaterial'

/** A press held this long without moving places (a long press). */
export const LONG_PRESS_MS = 420
/** How far a press may wander, CSS pixels, and still be a tap or a long press. */
const TAP_SLOP = 8

/** The first-visit hint's three steps, in plain words. */
export const HINT_STEPS = [
  'Mine a block: tap or click it, or press MINE (Q).',
  'Place it back: long press or right click, or press PLACE (E).',
  'Open your inventory: the bag at the end of the bar (I).',
] as const

/** The chunk the body stands in, or null. */
function hereKey(): string | null {
  const s = terrainSession
  return s ? chunkAtView(s, [s.body.x, s.body.y + 1, s.body.z]) : null
}

/** The chunk SURVEY would fill now (store/useTerrain.ts surveyTargetOf), for the look as it is. */
export function surveyTarget(): string | null {
  return terrainSession ? surveyTargetOf(terrainSession, terrainInput.yaw, terrainInput.pitch) : null
}

/** A block's picture: its side tile (lib/terrain/tiles.ts), as the scene draws it. */
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

function PadButton({ name, label, children }: { name: string; label: string; children: ReactNode }): JSX.Element {
  const pressed = useRef(false)
  const up = (): void => { if (pressed.current) { pressed.current = false; release(name) } }
  useEffect(() => up, [])
  return (
    <button
      className={`terrain-pad__btn terrain-pad__btn--${name}`}
      aria-label={label}
      {...noCallout}
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); if (!pressed.current) { pressed.current = true; hold(name) } }}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
    >{children}</button>
  )
}

/** The status line's words: where you stand, in plain words (messages have their own slot under the cross). */
function standingWords(loading: boolean, surveying: boolean, target: string | null): string {
  if (loading) return 'Loading your blocks'
  if (surveying) return 'Surveying'
  if (target) return target === hereKey() ? 'Empty here: SURVEY' : 'Empty ahead: SURVEY'
  return 'Build near your avatar'
}

/** Whether the body floats (in a chunk not surveyed, with none under it), looked at a few times a second. */
function useFloating(): boolean {
  const [floating, setFloating] = useState(false)
  useEffect(() => {
    const t = window.setInterval(() => {
      const s = terrainSession
      if (!s) return
      setFloating(!gravityHolds(bodyWorld(s), s.body))
    }, 250)
    return () => clearInterval(t)
  }, [])
  return floating
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

function TerrainScreen(): JSX.Element {
  const message = useTerrain((s) => s.message)
  const hint = useTerrain((s) => s.hint)
  const loading = useTerrain((s) => s.loading)
  const surveying = useTerrain((s) => s.surveying.length > 0)
  const target = useSurveyTarget()
  const floating = useFloating()
  const standing = standingWords(loading, surveying, target)
  const canvasRef = useRef<HTMLDivElement>(null)

  // A fresh look and nothing held at every visit; everything let go on the way out.
  useEffect(() => { resetTerrainInput(); return () => releaseAll() }, [])

  const doSurvey = (): void => {
    const key = surveyTarget()
    if (key) void useTerrain.getState().survey(key)
    else useTerrain.getState().say('Everything here is surveyed.')
  }

  // TERRAIN's keys, while it is on screen (the cyberspace keys stand down: hooks/useKeyboard.ts).
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.key === 'Meta') { releaseAll(); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return
      const st = useTerrain.getState()
      if (e.code === 'Escape') { e.preventDefault(); if (st.sheet) st.setSheet(false); else void st.exit(); return }
      if (e.code === 'KeyT') { e.preventDefault(); if (!e.repeat) void st.exit(); return }
      if (e.code === 'KeyI' || e.code === 'Tab') { e.preventDefault(); if (!e.repeat) st.setSheet(!st.sheet); return }
      if (st.sheet) return
      const slot = slotKey(e.code)
      if (slot !== null) { e.preventDefault(); st.selectSlot(slot); return }
      if (e.code === 'KeyG') { e.preventDefault(); if (!e.repeat) doSurvey(); return }
      if (e.code === 'KeyQ') { e.preventDefault(); if (!e.repeat) terrainInput.action = { kind: 'mine', at: null }; return }
      if (e.code === 'KeyE') { e.preventDefault(); if (!e.repeat) terrainInput.action = { kind: 'place', at: null }; return }
      const move = MOVE_KEYS[e.code]
      if (!move) return
      e.preventDefault()
      // Space and Enter on a focused button never press it here: Space is JUMP.
      if (e.repeat) return
      hold(move)
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key === 'Meta') { releaseAll(); return }
      const move = MOVE_KEYS[e.code]
      if (move) { release(move); if (e.code === 'Space') e.preventDefault() }
    }
    const hidden = (): void => { if (document.visibilityState === 'hidden') releaseAll() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', releaseAll)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', hidden)
      releaseAll()
    }
  }, [])

  // The scene's pointer: drag to look, tap to mine, long press or the second button to place, hover to aim.
  const press = useRef<{ id: number; x: number; y: number; sx: number; sy: number; t: number; moved: number; timer: number; done: boolean; mouse: boolean } | null>(null)
  const ndc = (x: number, y: number): { x: number; y: number } => {
    const r = canvasRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: ((x - r.left) / r.width) * 2 - 1, y: -(((y - r.top) / r.height) * 2 - 1) }
  }
  const endPress = (): void => {
    const p = press.current
    if (p) clearTimeout(p.timer)
    press.current = null
  }

  return (
    <div className="terrainview" role="application" aria-label="TERRAIN: mine and place blocks">
      <div
        ref={canvasRef}
        className="terrainview__canvas"
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (useTerrain.getState().sheet) return
          if (e.pointerType === 'mouse' && e.button === 2) {
            terrainInput.action = { kind: 'place', at: ndc(e.clientX, e.clientY) }
            return
          }
          if (e.pointerType === 'mouse' && e.button !== 0) return
          endPress()
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          const mouse = e.pointerType === 'mouse'
          const at = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: 0, timer: 0, done: false, mouse }
          // A long press places, on a touch screen, once it has held still long enough.
          if (!mouse) {
            at.timer = window.setTimeout(() => {
              const p = press.current
              if (!p || p.id !== at.id || p.moved > TAP_SLOP) return
              p.done = true
              terrainInput.action = { kind: 'place', at: ndc(p.sx, p.sy) }
              navigator.vibrate?.(12)
            }, LONG_PRESS_MS)
          }
          press.current = at
        }}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse') terrainInput.hover = ndc(e.clientX, e.clientY)
          const p = press.current
          if (!p || p.id !== e.pointerId) return
          const dx = e.clientX - p.x, dy = e.clientY - p.y
          p.moved += Math.abs(dx) + Math.abs(dy)
          p.x = e.clientX
          p.y = e.clientY
          // Past the slop the press is a look: WALK's gain on the scene, per screen width.
          if (p.moved > TAP_SLOP) {
            const k = lookRadPerPx(canvasRef.current?.clientWidth ?? window.innerWidth)
            turnLook(dx * k, dy * k)
          }
        }}
        onPointerUp={(e) => {
          const p = press.current
          if (!p || p.id !== e.pointerId) return
          if (!p.done && p.moved <= TAP_SLOP) terrainInput.action = { kind: 'mine', at: ndc(p.sx, p.sy) }
          endPress()
        }}
        onPointerCancel={endPress}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') terrainInput.hover = null }}
      >
        <Canvas
          camera={{ fov: 72, near: 0.05, far: FOG_FAR + 8 }}
          dpr={[1, 2]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          style={{ background: BG }}
        >
          <TerrainScene />
        </Canvas>
        <span className="terrain-crosshair" aria-hidden />
      </div>

      <div className="terrain-bar">
        <span className="terrain-bar__title"><Blocks size={14} strokeWidth={2.25} aria-hidden />TERRAIN</span>
        {/* One line, always there, so nothing below it moves when it changes. */}
        <span className="terrain-bar__status">{standing}</span>
        <button className="terrain-bar__exit" onClick={(e) => { e.currentTarget.blur(); void useTerrain.getState().exit() }} title="Back to BUILD, where the build cursor was (T or Esc)">EXIT<Key>T</Key></button>
      </div>

      {/* What just happened (a refusal, a survey), under the cross, in a slot of its own: up to two lines, nothing moves. */}
      <div className="terrain-message" role="status" aria-live="polite">{message && <span className="terrain-message__text">{message}</span>}</div>

      {/* The first visit's three steps, in a slot of its own under the bar. */}
      <div className="terrain-hint" aria-live="polite">
        {!loading && hint < HINT_DONE && (
          <span className="terrain-hint__box"><span className="terrain-hint__step">{hint + 1} of 3</span>{HINT_STEPS[hint]}</span>
        )}
      </div>

      <div className="terrain-survey">
        {(target || surveying) && (
          <button className="terrain-survey__btn" disabled={surveying || loading} onClick={(e) => { e.currentTarget.blur(); doSurvey() }} title="Fill this chunk with the ground everyone computes the same (G)">
            <Radar size={16} strokeWidth={2.25} aria-hidden />{surveying ? 'SURVEYING' : 'SURVEY'}<Key>G</Key>
          </button>
        )}
      </div>

      <div className="terrain-pad" aria-label="Walk">
        <div className="terrain-pad__dirs">
          <PadButton name="forward" label="Forward"><ChevronUp size={20} strokeWidth={2.5} aria-hidden /></PadButton>
          <PadButton name="left" label="Left"><ChevronLeft size={20} strokeWidth={2.5} aria-hidden /></PadButton>
          <PadButton name="right" label="Right"><ChevronRight size={20} strokeWidth={2.5} aria-hidden /></PadButton>
          <PadButton name="back" label="Back"><ChevronDown size={20} strokeWidth={2.5} aria-hidden /></PadButton>
          {/* While floating in a chunk not surveyed, a way down (Shift or C on a keyboard); its cell is kept, so nothing moves. */}
          <span className="terrain-pad__down">{floating && <PadButton name="down" label="Down (Shift)"><ChevronsDown size={18} strokeWidth={2.5} aria-hidden /></PadButton>}</span>
        </div>
      </div>

      <div className="terrain-actions" aria-label="Mine, place, jump and look">
        <div className="terrain-actions__col">
          <button className="terrain-act" {...noCallout} onPointerDown={(e) => { e.preventDefault(); terrainInput.action = { kind: 'mine', at: null } }} aria-label="Mine the block at the middle (Q)"><Pickaxe size={16} strokeWidth={2.25} aria-hidden />MINE<Key>Q</Key></button>
          <button className="terrain-act" {...noCallout} onPointerDown={(e) => { e.preventDefault(); terrainInput.action = { kind: 'place', at: null } }} aria-label="Place a block at the middle (E)"><Box size={16} strokeWidth={2.25} aria-hidden />PLACE<Key>E</Key></button>
          <PadButton name="jump" label="Jump (Space)"><ChevronsUp size={18} strokeWidth={2.25} aria-hidden />JUMP</PadButton>
        </div>
        <OrbitSphere
          className="terrainlook"
          square
          onTurn={(dx, dy, size) => { const k = sphereRadPerPx(size); turnLook(dx * k, dy * k) }}
          label="LOOK"
          title="Drag to look around; keep dragging past the ball."
          ariaLabel="Look around. Drag to turn your view."
        />
      </div>

      <Hotbar />
      <InventorySheet />
    </div>
  )
}

/** For tests: what the cursor points at now. */
export const cursorNow = (): typeof terrainCursor.hit => terrainCursor.hit
