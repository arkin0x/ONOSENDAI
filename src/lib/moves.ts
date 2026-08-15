/**
 * moves.ts — the six directions the cursor can go, named by what they do on
 * screen rather than by which key or button triggers them.
 *
 * Shared by the keyboard and the touch pad. Kept in one place because the
 * out-axis convention is easy to get backwards: `out` points out of the screen
 * toward you, so pushing away is its inverse. Two copies of that reasoning would
 * eventually disagree, and a mobile pad whose R and F were flipped relative to
 * the keyboard would be a genuinely confusing bug to track down.
 */

import type { AxisDirection, ViewAxes } from './space'

export type MoveName = 'up' | 'down' | 'left' | 'right' | 'away' | 'toward'

function invert(d: AxisDirection): AxisDirection {
  return { axis: d.axis, dir: d.dir === 1 ? -1 : 1 }
}

/** Resolve a screen-relative direction against the axes currently on screen. */
export function moveDirection(axes: ViewAxes, name: MoveName): AxisDirection {
  switch (name) {
    case 'up': return axes.up
    case 'down': return invert(axes.up)
    case 'right': return axes.right
    case 'left': return invert(axes.right)
    // Away from the camera, into the screen.
    case 'away': return invert(axes.out)
    case 'toward': return axes.out
  }
}
