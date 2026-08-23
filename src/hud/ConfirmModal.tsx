/**
 * ConfirmModal.tsx — a centred yes/no for the few actions that destroy
 * something. A real modal rather than window.confirm so the wording, which is
 * the whole point here (model vs instance), can be laid out and read.
 */

interface Props {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({ title, body, confirmLabel, danger = true, onConfirm, onCancel }: Props): JSX.Element {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onPointerDown={onCancel}>
      <div className="modal__card" onPointerDown={(e) => e.stopPropagation()}>
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
