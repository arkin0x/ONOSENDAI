/**
 * The orbit ball: a lit globe to drag the view round with.
 *
 * Made for the workshop (arkinox, 2026-10-10: "not being able to orbit
 * hurts"), where a drag on it turns the view about the shard and a tap sends
 * the view home. WALK uses the same ball in the bottom left to look around
 * (arkinox, 2026-10-23: "bring back the sphere we have in the workshop and
 * use it to look"). Pointer capture keeps a drag alive after the finger
 * leaves the ball, until it lifts. What a drag and a tap do is the caller's.
 */

import { useRef } from 'react'
import { noCallout } from '../../hooks/useRepeatable'

interface OrbitSphereProps {
  /** A drag of dx, dy CSS pixels since the last move. */
  onTurn: (dx: number, dy: number) => void
  /** A tap with no drag. Nothing when absent. */
  onTap?: () => void
  /** The small word on the ball. */
  label: string
  title: string
  ariaLabel: string
  /** Added to `benchorb`, for where the ball stands. */
  className?: string
}

export function OrbitSphere({ onTurn, onTap, label, title, ariaLabel, className }: OrbitSphereProps): JSX.Element {
  const last = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)
  const down = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (!e.isPrimary) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    last.current = { x: e.clientX, y: e.clientY }
    moved.current = false
  }
  const move = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (!last.current) return
    const dx = e.clientX - last.current.x
    const dy = e.clientY - last.current.y
    if (dx === 0 && dy === 0) return
    last.current = { x: e.clientX, y: e.clientY }
    moved.current = true
    onTurn(dx, dy)
  }
  const up = (): void => {
    if (!last.current) return
    last.current = null
    if (!moved.current) onTap?.()
  }
  return (
    <button
      className={className ? `benchorb ${className}` : 'benchorb'}
      title={title}
      aria-label={ariaLabel}
      {...noCallout}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <span className="benchorb__sub">{label}</span>
    </button>
  )
}
