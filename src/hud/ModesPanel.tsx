/**
 * ModesPanel.tsx - MODES: the pad's modes in the player's order, each with a
 * switch (owner, 2026-11-24: "make a "MODES" settings panel in the menu
 * where you can drag to reorder the modes. Fully customizable", and "also
 * make it so you can toggle MODES off so they aren't part of the rotation").
 *
 * One row per mode (store/modeOrder.ts MODES), in a chamfered frame: the
 * grip, the mode's icon in its pad color, its word, what its place makes it
 * (STARTS IN, SECOND BUTTON, MODE BUTTON, or OFF), its own key where it has
 * one, its switch, and up and down. Every row is the same height and every
 * label has its place kept, so nothing moves but the row being moved.
 *
 * Moving: drag the grip, with a finger or a mouse. The pointer is held by
 * the list, which never moves, not by the grip, whose row moves under it as
 * it passes others (Hud.tsx does the same for the menu's panels). Without
 * dragging: the up and down buttons, or ArrowUp and ArrowDown on a focused
 * grip, a place at a time.
 *
 * The top mode is always on (its switch is disabled, and a mode moved to
 * the top is switched on), so at least one is. RESET TO DEFAULT puts
 * today's pad back: HOP, WALK, VIEW, BUILD, SCAN, all on. Nothing here
 * deletes anything.
 *
 * Kept for the identity on screen, in IndexedDB. Not part of the newcomer
 * view (newcomer/reveal.ts), whose pad is the default one.
 */

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronDown, ChevronUp, Crosshair, Eye, Footprints, GripVertical, RotateCcw, ScanSearch, Wrench, type LucideIcon } from 'lucide-react'
import { Switch } from './ui/Switch'
import { Explanation } from './Explanation'
import {
  canSwitchOff, DEFAULT_MODES, modeInfo, moveModeBy, moveModeTo, resetModes, rolesOf, sameModes, setModeOn,
  updateModes, useModes, useStoredModes, type ModeId, type ModeRoles, type ModeSettings,
} from '../store/modeOrder'
import { useTutorial } from '../store/useTutorial'

/** Each mode's icon (lucide), drawn in its pad color. */
export const MODE_ICON: Record<ModeId, LucideIcon> = {
  hop: Crosshair,
  walk: Footprints,
  view: Eye,
  build: Wrench,
  scan: ScanSearch,
}

/** What a row's place makes its mode, in the row's second line. */
export function roleLabel(s: ModeSettings, roles: ModeRoles, id: ModeId): string {
  if (s.order[0] === id) return 'Starts in'
  if (s.off.includes(id)) return 'Off'
  if (roles.second === id) return 'Second button'
  return 'Mode button'
}

/** Where a row lifted at `clientY` lands among the rows of `list`: before the first other row whose middle is below it. */
export function dropIndex(rows: ReadonlyArray<{ id: string; top: number; height: number }>, lifting: string, clientY: number): number {
  let at = 0
  for (const r of rows) {
    if (r.id === lifting) continue
    if (clientY > r.top + r.height / 2) at++
  }
  return at
}

export const MODES_HINT = 'The top mode is always on.'

export function ModesPanel(): JSX.Element {
  const s = useStoredModes()
  const roles = rolesOf(s)
  const touring = useTutorial((t) => t.active)
  const listRef = useRef<HTMLOListElement>(null)
  const drag = useRef<{ id: ModeId; pointerId: number } | null>(null)
  const [lifting, setLifting] = useState<ModeId | null>(null)
  // A row moved by a button or a key keeps the focus on what moved it.
  const refocus = useRef<{ id: ModeId; part: 'up' | 'down' | 'grip' } | null>(null)
  useEffect(() => {
    const want = refocus.current
    if (!want) return
    refocus.current = null
    const row = listRef.current?.querySelector<HTMLElement>(`[data-mode="${want.id}"]`)
    let el = row?.querySelector<HTMLButtonElement>(`.modes__${want.part}`) ?? null
    // At an end its button is disabled: the other one, then the grip.
    if (el?.disabled) el = row?.querySelector<HTMLButtonElement>(want.part === 'up' ? '.modes__down' : '.modes__up') ?? null
    if (!el || el.disabled) el = row?.querySelector<HTMLButtonElement>('.modes__grip') ?? null
    el?.focus()
  })

  // What a move did, for a screen reader: "WALK: 1 of 5".
  const [said, setSaid] = useState('')
  const announce = (id: ModeId): void => {
    const s2 = useModes.getState().saved ?? DEFAULT_MODES
    setSaid(`${modeInfo(id).word}: ${s2.order.indexOf(id) + 1} of ${s2.order.length}`)
  }
  const move = (id: ModeId, delta: number, part: 'up' | 'down' | 'grip'): void => {
    refocus.current = { id, part }
    updateModes((cur) => moveModeBy(cur, id, delta))
    announce(id)
  }

  const grab = (id: ModeId, e: ReactPointerEvent<HTMLButtonElement>): void => {
    const list = listRef.current
    if (!list || drag.current || e.button !== 0) return
    try { list.setPointerCapture(e.pointerId) } catch { return }
    e.preventDefault()
    drag.current = { id, pointerId: e.pointerId }
    setLifting(id)
  }
  const over = (e: ReactPointerEvent<HTMLOListElement>): void => {
    const d = drag.current
    const list = listRef.current
    if (!d || e.pointerId !== d.pointerId || !list) return
    const rows = [...list.querySelectorAll<HTMLElement>(':scope > [data-mode]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { id: el.dataset.mode as string, top: r.top, height: r.height }
    })
    const to = dropIndex(rows, d.id, e.clientY)
    updateModes((cur) => moveModeTo(cur, d.id, to))
  }
  // Up, cancel and a lost capture all end it; each place was kept as it was reached.
  const drop = (): void => {
    if (!drag.current) return
    const { id } = drag.current
    drag.current = null
    setLifting(null)
    announce(id)
  }
  const gripKey = (id: ModeId, e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    move(id, e.key === 'ArrowUp' ? -1 : 1, 'grip')
  }

  const isDefault = sameModes(s, DEFAULT_MODES)
  const last = s.order.length - 1

  return (
    <section className="panel panel--modes">
      <header className="panel__head"><h2>Modes</h2></header>
      <ol
        ref={listRef}
        className={`modes__list${lifting ? ' is-dragging' : ''}`}
        aria-label="Modes, in order"
        onPointerMove={over}
        onPointerUp={drop}
        onPointerCancel={drop}
        onLostPointerCapture={drop}
      >
        {s.order.map((id, i) => {
          const info = modeInfo(id)
          const Icon = MODE_ICON[id] ?? Crosshair
          const off = s.off.includes(id)
          const role = roleLabel(s, roles, id)
          const lockedOn = !canSwitchOff(s, id)
          const switchId = `modes-switch-${id}`
          return (
            <li
              key={id}
              data-mode={id}
              className={`modes__row is-${id}${off ? ' is-off' : ''}${i === 0 ? ' is-start' : ''}${roles.second === id ? ' is-second' : ''}${lifting === id ? ' is-lifting' : ''}`}
            >
              <button
                type="button"
                className="modes__grip"
                title={`Drag to move ${info.word}, or use the arrow keys`}
                aria-label={`Move ${info.word}, ${i + 1} of ${s.order.length}: drag, or press the up and down arrow keys`}
                onPointerDown={(e) => grab(id, e)}
                onKeyDown={(e) => gripKey(id, e)}
              >
                <GripVertical size={16} strokeWidth={2} aria-hidden />
              </button>
              <span className="modes__icon" aria-hidden>
                <span className="modes__icon-in"><Icon size={18} strokeWidth={2} /></span>
              </span>
              <label className="modes__text" htmlFor={switchId}>
                <span className="modes__word">{info.word}</span>
                <span className="modes__role">{role}</span>
              </label>
              <span className="modes__key" aria-hidden={!info.key}>
                {info.key && <kbd title={`${info.key} opens ${info.word} wherever it is in the list`}>{info.key}</kbd>}
              </span>
              <Switch
                id={switchId}
                className="modes__switch"
                checked={!off}
                disabled={lockedOn}
                title={lockedOn ? 'The mode you start in is always on' : off ? `Turn ${info.word} on` : `Turn ${info.word} off: out of the turns${info.key ? `, still opens with ${info.key}` : ''}`}
                aria-label={info.word}
                onCheckedChange={(on) => updateModes((cur) => setModeOn(cur, id, on))}
              />
              <span className="modes__moves">
                <button type="button" className="modes__up" disabled={i === 0} aria-label={`Move ${info.word} up`} title="Move up" onClick={() => move(id, -1, 'up')}>
                  <ChevronUp size={16} strokeWidth={2.25} aria-hidden />
                </button>
                <button type="button" className="modes__down" disabled={i === last} aria-label={`Move ${info.word} down`} title="Move down" onClick={() => move(id, 1, 'down')}>
                  <ChevronDown size={16} strokeWidth={2.25} aria-hidden />
                </button>
              </span>
            </li>
          )
        })}
      </ol>
      <span className="modes__said" aria-live="polite">{said}</span>
      <p className="modes__hint">{touring ? 'The tutorial uses the default order while it runs.' : MODES_HINT}</p>
      <button type="button" className="cham-btn modes__reset" disabled={isDefault} onClick={() => resetModes()}>
        <span className="modes__reset-in"><RotateCcw size={14} strokeWidth={2.25} aria-hidden />RESET TO DEFAULT</span>
      </button>
      <Explanation>
        The top mode is the one you start in. The next mode that is on is the
        second button, beside the mode button, where WALK is at first. The
        rest take turns on the mode button, in this order. A mode turned off
        leaves the turns but still opens by its key (B for BUILD, N for SCAN),
        from the tutorial and from links. Drag a grip to move a mode, or use
        the arrows. Kept for this identity on this device.
      </Explanation>
    </section>
  )
}
