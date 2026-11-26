/**
 * LetterSeal.tsx: a hidden message's seal and folded letter, drawn for the
 * HUD (owner, 2026-11-26: "love the broken seal for read"), the same shapes
 * the world draws (scene/LetterField.tsx), from direction 6's drawing.
 *
 * - Seal: the hexagon in its author's colour bearing their initial, whole;
 *   or broken in two down its crack, the halves turned apart. `cracking`
 *   starts it whole and plays the crack (the card opening; styles.css
 *   .seal--cracking), with its timing from the card.
 * - LetterThumb: the folded letter with its seal, whole or broken, in the
 *   80px chamfered frame every row picture wears (ui/Chamfer).
 */

import type { CSSProperties } from 'react'
import { Chamfer, THUMB_PX } from './ui/Chamfer'

/** The hexagon, pointed top and bottom, in a 40 by 46 box. */
const HEX = '20,1 39,12 39,34 20,45 1,34 1,12'
/** Its halves down a jagged crack, each in the same box. */
const HALF_L = '20,1 23,14 17.5,23 22,32 20,45 1,34 1,12'
const HALF_R = '20,1 39,12 39,34 20,45 22,32 17.5,23 23,14'

/** Text on the wax: near black, pressed in. */
const INK = '#140d03'

export function Seal({ colour, initial, broken, cracking = false, size = 40, className }: {
  colour: string
  initial: string
  broken: boolean
  /** Start whole and crack open (the card opening). */
  cracking?: boolean
  /** Its width, CSS pixels. */
  size?: number
  className?: string
}): JSX.Element {
  const state = cracking ? 'cracking' : broken ? 'broken' : 'whole'
  const style = { '--seal': colour, width: size, height: (size * 46) / 40 } as CSSProperties
  return (
    <span className={`seal seal--${state}${className ? ` ${className}` : ''}`} style={style} aria-hidden="true">
      <svg viewBox="-12 -2 64 50" className="seal__svg">
        {state === 'whole' ? (
          <g>
            <polygon points={HEX} fill={colour} stroke="rgba(255,255,255,0.75)" strokeWidth="1.2" />
            <text x="20" y="29.5" textAnchor="middle" fontSize="19" fontWeight="700" fill={INK} className="seal__initial">{initial}</text>
          </g>
        ) : (
          <>
            <g className="seal__half seal__half--l">
              <polygon points={HALF_L} fill={colour} stroke="rgba(255,255,255,0.6)" strokeWidth="1.1" />
            </g>
            <g className="seal__half seal__half--r">
              <polygon points={HALF_R} fill={colour} stroke="rgba(255,255,255,0.6)" strokeWidth="1.1" />
            </g>
            {/* The initial goes with the crack: it shows only while the seal is whole. */}
            {state === 'cracking' && <text x="20" y="29.5" textAnchor="middle" fontSize="19" fontWeight="700" fill={INK} className="seal__initial seal__initial--fading">{initial}</text>}
          </>
        )}
      </svg>
    </span>
  )
}

/** The folded letter in a 150 by 98 box: its outline, corners cut, and the flap's fold to the seal. */
const PAPER = '12,0 150,0 150,86 138,98 0,98 0,12'
const FLAP = '0,12 75,58 150,0'

/** The letter with its seal, whole or broken, as a row's picture. */
export function LetterThumb({ colour, initial, broken, size = THUMB_PX }: { colour: string; initial: string; broken: boolean; size?: number }): JSX.Element {
  const w = Math.round(size * 0.78)
  return (
    <Chamfer className={`itemthumb letterthumb${broken ? ' letterthumb--read' : ''}`} size={size}>
      <span className="letterthumb__paper" style={{ width: w, height: (w * 98) / 150 }}>
        <svg viewBox="-3 -3 156 104" width="100%" height="100%" aria-hidden="true">
          <polygon points={PAPER} className="letterthumb__sheet" />
          <polyline points={FLAP} className="letterthumb__fold" />
        </svg>
        <Seal colour={colour} initial={initial} broken={broken} size={Math.round(w * 0.3)} className="letterthumb__seal" />
      </span>
    </Chamfer>
  )
}
