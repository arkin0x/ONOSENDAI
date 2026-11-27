/**
 * Swatch.tsx - a block's picture: its 16 by 16 tile (lib/terrain/tiles.ts)
 * over its face colour, glowing for a kind that glows. The hotbar, the bag and
 * the survey card all draw blocks with it.
 */

import type { CSSProperties } from 'react'
import { blockKind } from '../lib/terrain/blocks'
import { tileUrl } from '../lib/terrain/tiles'

export function Swatch({ id, size = 22 }: { id: number; size?: number }): JSX.Element {
  const k = blockKind(id)
  const url = k ? tileUrl(k) : ''
  const style = { '--sw-face': k?.color ?? 'transparent', '--sw-edge': k?.edge ?? 'transparent', width: size, height: size, ...(url ? { backgroundImage: `url(${url})` } : {}) } as CSSProperties
  return <span className={`terrain-swatch${k?.glow ? ' terrain-swatch--glow' : ''}`} style={style} aria-hidden />
}
