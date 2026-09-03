/**
 * ConfirmModal.tsx — a centred yes/no for the few actions that destroy
 * something. A real modal rather than window.confirm so the wording, which is
 * the whole point here (model vs instance), can be laid out and read.
 */

import type { ReactNode } from 'react'

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
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({ banner, title, body, figure, busy = false, confirmLabel, danger = true, cardClassName, cancelLabel = 'CANCEL', onConfirm, onCancel }: Props): JSX.Element {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onPointerDown={onCancel}>
      <div className={`modal__card ${cardClassName ?? ''}`} onPointerDown={(e) => e.stopPropagation()}>
        {banner}
        <h2 className="modal__title">{title}</h2>
        {figure !== undefined && <div className="modal__figure">{figure}</div>}
        <p className="modal__body">{body}</p>
        <div className="modal__row">
          {cancelLabel !== null && <button className="modal__cancel" onClick={onCancel} disabled={busy}>{cancelLabel}</button>}
          <button className={`modal__confirm ${danger ? 'modal__confirm--danger' : ''} ${busy ? 'is-busy' : ''}`} onClick={onConfirm} disabled={busy}>
            {busy && <span className="spin" aria-hidden="true" />}{confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
