/**
 * ModalClose.tsx - the one ✕ every modal and sheet closes with, top right on
 * the title's line (owner, 2026-11-15: "i want the modals to have consistent
 * close buttons. check them all. good examples: shard feed, avatar modal.
 * bad example: key items, avatars").
 *
 * The look is the Shard Feed's and the avatar card's: a small square with a
 * thin border and the ✕ glyph they draw. It is drawn at 26px, and its fingertip is 44px
 * (an invisible margin around it, styles.css .modal-close::before), so a
 * phone hits it without the oversized box KEY ITEMS had.
 *
 * It only closes: what closing means stays the modal's own `onClose`, the
 * same one its Escape and its tap outside already call.
 */

interface Props {
  onClose: () => void
  /** Its accessible name and tooltip. "Close" unless the modal hides rather than closes. */
  label?: string
  /** The tooltip, when it says more than the name (a keyboard hint). */
  title?: string
  /** While the modal cannot close (a confirmation under way): greyed, as its tap outside does nothing then. */
  disabled?: boolean
  className?: string
}

export function ModalClose({ onClose, label = 'Close', title, disabled = false, className }: Props): JSX.Element {
  return (
    <button
      type="button"
      className={className ? `modal-close ${className}` : 'modal-close'}
      onClick={onClose}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
    >
      ✕
    </button>
  )
}
