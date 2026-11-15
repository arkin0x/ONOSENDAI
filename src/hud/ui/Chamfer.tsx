/**
 * Chamfer.tsx - a picture's frame with its top-left and bottom-right corners
 * cut at 45 degrees (owner, 2026-11-15: "the pictures should maybe have a
 * border. I think the top left and bottom right corners cut (chamfered) to
 * give it a cyberpunk vibe").
 *
 * Two clipped boxes, one inside the other (styles.css .chamfer): the outer is
 * the line's colour, the inner the fill, inset by the line's width with its
 * cut moved in to match, so the cut corners are outlined at the same width as
 * the straight sides, not just clipped off. What it frames is clipped by the
 * inner box, so a picture never pokes past a cut corner.
 *
 * One size for every picture in a row of things, THUMB_PX: the Shard Feed's
 * ("the shard picture is a good size ... Make all pictures/icons the size of
 * the shard sizes").
 */

import type { CSSProperties, ReactNode } from 'react'

/** Every row picture's width and height, in CSS pixels: the Shard Feed's thumbnails (FeedList, .feed__thumb). */
export const THUMB_PX = 80

/** `decorative` (the default) hides it from a screen reader, for a picture beside the words that name it; false keeps an <img>'s alt text heard. */
export function Chamfer({ size = THUMB_PX, className, decorative = true, children }: { size?: number; className?: string; decorative?: boolean; children: ReactNode }): JSX.Element {
  const style = { '--chamfer-size': `${size}px` } as CSSProperties
  return (
    <span className={className ? `chamfer ${className}` : 'chamfer'} style={style} aria-hidden={decorative ? 'true' : undefined}>
      <span className="chamfer__in">{children}</span>
    </span>
  )
}
