/**
 * FlyArrows.tsx - the 3D forward and reverse arrows, one pair for every
 * button that moves you along your line of sight.
 *
 * arkinox, 2026-11-02: WALK's FORWARD and BACKWARD wear "the 3D forward
 * icon" and its reverse, and VIEW's free-fly buttons wear the same two, so
 * the pair lives here and not in either pad.
 *
 * Each is a flat arrow lying on the ground, drawn in perspective: FORWARD
 * points away from you, narrowing toward its tip; REVERSE points at you,
 * its head wide and near. The faces that turn toward the eye are drawn as a
 * darker edge under the top, so the arrow reads as a solid with thickness
 * and not as a flat up or down arrow, which on the pad means jump and down.
 * Both draw in currentColor, so a key's mode tint colors them.
 */

interface ArrowProps {
  /** Width and height in CSS pixels. */
  size?: number
  className?: string
}

/** The darker faces: the arrow's thickness, seen where it faces you. */
const EDGE_OPACITY = 0.45

/** An arrow lying on the ground pointing away from you: forward. Its shaft widens toward you. */
export function ForwardArrow3D({ size = 22, className }: ArrowProps): JSX.Element {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      {/* The edges that face you: the shaft's near end and the head's back. */}
      <g fill="currentColor" opacity={EDGE_OPACITY}>
        <path d="M6 19 H18 L17.6 21.8 H6.4 Z" />
        <path d="M4.5 10.5 H9.4 L9.3 12 H4.8 Z" />
        <path d="M14.6 10.5 H19.5 L19.2 12 H14.7 Z" />
      </g>
      <path fill="currentColor" d="M12 3 L19.5 10.5 H14.6 L18 19 H6 L9.4 10.5 H4.5 Z" />
    </svg>
  )
}

/** The same arrow turned round on the ground, pointing at you: reverse. Its tail narrows away from you. */
export function ReverseArrow3D({ size = 22, className }: ArrowProps): JSX.Element {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      {/* The edges that face you: the head's two near sides. */}
      <g fill="currentColor" opacity={EDGE_OPACITY}>
        <path d="M1.5 11 L12 20 L12 22.8 L1.8 14 Z" />
        <path d="M22.5 11 L12 20 L12 22.8 L22.2 14 Z" />
      </g>
      <path fill="currentColor" d="M10.4 3 H13.6 L16.4 11 H22.5 L12 20 L1.5 11 H7.6 Z" />
    </svg>
  )
}
