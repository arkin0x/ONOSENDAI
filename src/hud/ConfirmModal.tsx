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
  body: string
  confirmLabel: string
  danger?: boolean
  /** An extra class on the card, for a border that is not the destructive red. */
  cardClassName?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({ banner, title, body, confirmLabel, danger = true, cardClassName, onConfirm, onCancel }: Props): JSX.Element {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onPointerDown={onCancel}>
      <div className={`modal__card ${cardClassName ?? ''}`} onPointerDown={(e) => e.stopPropagation()}>
        {banner}
        <h2 className="modal__title">{title}</h2>
        <p className="modal__body">{body}</p>
        <div className="modal__row">
          <button className="modal__cancel" onClick={onCancel}>CANCEL</button>
          <button className={`modal__confirm ${danger ? 'modal__confirm--danger' : ''}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
