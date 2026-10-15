/**
 * deadZone.ts: how far a press may travel and still be a tap on the bench,
 * and the hold that keeps the orbit still inside that distance.
 *
 * A finger is not a mouse. Pressing a dot on a phone rolls the fingertip a
 * dozen pixels before it lifts, and in FACE mode that roll both orbited the
 * view (OrbitControls has no threshold of its own) and lost the tap (the
 * bench dropped any press that travelled more than 8 px). Selecting a point
 * was a matter of luck (arkinox, 2026-10-09). So the slop follows the pointer
 * that pressed: wide for touch and pen, narrow for a mouse, and the orbit is
 * held at zero speed until the press has left the zone. Inside it, nothing
 * moves and a lift is a tap; past it, the drag is an orbit from there.
 */

/** Pixels a touch or pen press may travel and still be a tap. */
export const COARSE_SLOP_PX = 20
/** Pixels a mouse press may travel and still be a tap: a mouse does not roll. */
export const FINE_SLOP_PX = 8

/** The slop for a pointer type, as PointerEvent.pointerType names it. Unknown is treated as a finger. */
export function slopFor(pointerType: string | undefined | null): number {
  return pointerType === 'mouse' ? FINE_SLOP_PX : COARSE_SLOP_PX
}

let lastPointerType: string | null = null

/** Remember what kind of pointer pressed last, from the canvas's pointerdown. */
export function noteGesture(pointerType: string | undefined | null): void {
  lastPointerType = pointerType ?? null
}

/** The slop for the press in flight (or the last one): what the bench's tap handlers compare R3F's delta against. */
export function tapSlop(): number {
  return slopFor(lastPointerType)
}

/**
 * One press's dead zone. `down` starts it; `move` says whether the press is
 * still inside the zone (held) or has left it (released, for good, for this
 * press); `up` ends it. The orbit's rotate speed is zero while held.
 */
export class Hold {
  private start: { x: number; y: number } | null = null
  private held = false

  constructor(private readonly slop: () => number) {}

  down(x: number, y: number): void {
    this.start = { x, y }
    this.held = true
  }

  /** True while the press is still inside the zone. */
  move(x: number, y: number): boolean {
    if (!this.start || !this.held) return false
    if (Math.hypot(x - this.start.x, y - this.start.y) > this.slop()) this.held = false
    return this.held
  }

  /** Whether the orbit is currently held still. */
  get holding(): boolean {
    return this.held
  }

  up(): void {
    this.start = null
    this.held = false
  }
}
