/**
 * ConfirmModal.tsx — a centred yes/no for the few actions that destroy
 * something. A real modal rather than window.confirm so the wording, which is
 * the whole point here (model vs instance), can be laid out and read.
 */

import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEscape } from '../hooks/useEscape'

interface Props {
  /** Something to show above the title, such as the HOSAKA banner. */
  banner?: ReactNode
  title: string
  body: ReactNode
  /** A large figure between the title and the body, such as a price. */
  figure?: ReactNode
  /** The confirm is in progress: locked, with a spinner. */
  busy?: boolean
  confirmLabel: string
  danger?: boolean
  /** An extra class on the card, for a border that is not the destructive red. */
  cardClassName?: string
  /** The cancel button's label; null for a modal with nothing to cancel,
   * which has the one button. Tapping the backdrop still calls onCancel. */
  cancelLabel?: string | null
  /**
   * What a tap on the backdrop does instead of onCancel, for a modal whose
   * cancel button is itself an answer, where a stray tap must never pick it:
   * the held-chain prompt sets itself aside rather than choosing.
   */
  onBackdrop?: () => void
  /** Wraps the body in its own scroll box, for an explanation longer than a phone screen. */
  scroll?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({ banner, title, body, figure, busy = false, confirmLabel, danger = true, cardClassName, cancelLabel = 'CANCEL', onBackdrop, scroll = false, onConfirm, onCancel }: Props): JSX.Element {
  // Escape is a tap on the backdrop: it answers nothing, so a held-chain
  // prompt sets itself aside and every other one cancels. Opened over another
  // modal, this is the more recent one, so it closes first (arkinox,
  // 2026-10-01). While busy it still takes the press, so the modal under it
  // does not close, but does nothing: the confirm is already under way.
  useEscape('modal', true, () => { if (!busy) (onBackdrop ?? onCancel)() })
  // Through a portal: every .panel has a backdrop-filter, which makes it a
  // stacking context, so a fixed modal rendered inside one panel would be
  // painted under the panels that follow it in the column.
  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onPointerDown={onBackdrop ?? onCancel}>
      <div className={`modal__card ${cardClassName ?? ''}`} onPointerDown={(e) => e.stopPropagation()}>
        {banner}
        <h2 className="modal__title">{title}</h2>
        {figure !== undefined && <div className="modal__figure">{figure}</div>}
        {/* A div, not a paragraph: an explanation's lists and tables are not
            valid inside a <p>. */}
        <div className={`modal__body ${scroll ? 'modal__body--scroll' : ''}`}>{body}</div>
        <div className="modal__row">
          {cancelLabel !== null && <button className="modal__cancel" onClick={onCancel} disabled={busy}>{cancelLabel}</button>}
          <button className={`modal__confirm ${danger ? 'modal__confirm--danger' : ''} ${busy ? 'is-busy' : ''}`} onClick={onConfirm} disabled={busy}>
            {busy && <span className="spin" aria-hidden="true" />}{confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
