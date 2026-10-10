/**
 * PanelSlot.tsx - the frame around each menu panel. A tap on the panel's
 * title line folds the panel to that line and a second tap unfolds it;
 * folded, a grip at the right end of the line drags the panel to another
 * place, or to the other column (arkinox, 2026-10-10).
 *
 * The panels themselves are untouched: the slot catches the tap as it bubbles
 * up from inside the header, the CSS under .slot hides the body, and the
 * title gets its role, tab stop and aria-expanded from here. The title (the
 * h2) rather than the whole header carries the role, because headers hold
 * buttons of their own and a button inside a button is not valid ARIA; the
 * tap target is still the whole line.
 */

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import { usePanelLayout, type PanelId } from '../store/usePanelLayout'

/**
 * What a tap on the title line must not fold: the header's own controls. A
 * Radix switch root is a button, so it is covered; anything else that acts on
 * a tap says so with data-no-collapse.
 */
export const CONTROL = 'button, a, input, label, select, textarea, [role=switch], [role=button], [data-no-collapse]'

/** As much of an element as foldsAt reads, so a test can hand it a fake. */
export interface ElementLike {
  parentElement: ElementLike | null
  matches(selector: string): boolean
}

/**
 * Whether a tap at `target` is on the title line `head` itself: inside it,
 * and not inside a control in it. The walk stops at the head, so the head's
 * own role (the title is a button to the keyboard) does not count.
 */
export function foldsAt(target: ElementLike | null, head: ElementLike | null): boolean {
  if (!head || !target) return false
  let el: ElementLike | null = target
  while (el && el !== head) {
    if (el.matches(CONTROL)) return false
    el = el.parentElement
  }
  return el === head
}

/** The panel's title line: the header directly under the section the slot wraps. Modals a panel opens have headers of their own, deeper down, which are not it. */
export function headOf(slot: HTMLElement | null): HTMLElement | null {
  return slot?.querySelector<HTMLElement>(':scope > .panel > .panel__head') ?? null
}

/** The title inside the title line, the element that holds the keyboard's attention. */
export function titleOf(slot: HTMLElement | null): HTMLElement | null {
  return slot?.querySelector<HTMLElement>(':scope > .panel > .panel__head > h2') ?? null
}

interface Props {
  id: PanelId
  /** Shown at the top of the left column by a priority state (Hud.tsx), not at its saved place: no grip, since there is no place to drag it from. */
  lead: boolean
  /** Under the pointer, being dragged. */
  lifting: boolean
  onGrab: (id: PanelId, e: ReactPointerEvent<HTMLButtonElement>) => void
  children: ReactNode
}

export function PanelSlot({ id, lead, lifting, onGrab, children }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const collapsed = usePanelLayout((s) => s.collapsed[id] === true)

  // The title's role, tab stop and state, set on the DOM after each render
  // rather than in the panel's markup: the panels are not edited for this.
  // React leaves attributes it did not set alone, and a panel's header is
  // the same node across its re-renders, so once set they stay.
  useEffect(() => {
    const title = titleOf(ref.current)
    if (!title) return
    title.setAttribute('role', 'button')
    title.setAttribute('tabindex', '0')
    title.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
  })

  const toggle = (): void => usePanelLayout.getState().toggle(id)

  const onClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (foldsAt(e.target instanceof Element ? e.target : null, headOf(ref.current))) toggle()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    if (e.target !== titleOf(ref.current)) return
    e.preventDefault()
    toggle()
  }

  const cls = ['slot', collapsed && 'slot--collapsed', lifting && 'slot--lifting'].filter(Boolean).join(' ')

  return (
    <div ref={ref} className={cls} data-panel-id={id} onClick={onClick} onKeyDown={onKeyDown}>
      {children}
      {collapsed && !lead && (
        <button
          type="button"
          className="slot__grip"
          title="Drag to move this panel"
          aria-label="Drag to move this panel"
          onPointerDown={(e) => onGrab(id, e)}
        >
          <GripVertical size={14} strokeWidth={2} aria-hidden />
        </button>
      )}
    </div>
  )
}
