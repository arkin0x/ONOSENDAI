/**
 * FullnessBar.tsx: how full the open shard is against what one hidden object
 * holds (lib/shardFullness.ts), as a bar and in words, under BYTES ON THE
 * WIRE in the SHARD sheet (owner, 2026-11-23: "add a bar indicating how
 * 'full' your shard is getting ... so we have a visual").
 *
 * Drawn as a segmented HUD meter in a chamfered frame, top-left and
 * bottom-right corners cut like the item thumbnails, a lit edge on the fill
 * and a gap every tenth (inspired by the segmented status and capacity
 * meters in the HUD/FUI collections on Dribbble: pbranigan's "HUD FUI
 * Inspiration", albemala's "Sci-Fi Futuristic UIs"). Calm cyan until it is
 * close to full, amber from NEAR_FULL, red past the limit: nothing shouts
 * until it matters.
 *
 * Two lines of words under it, each one line at a phone's width and both
 * always there (the second may be empty), so nothing under the bar moves
 * when a shard grows past the limit or places its first object.
 *
 * STAMP's library (StampLibrary) shows the same bar with what one stamp of
 * the chosen shard would add (`next`): a hatched run after the fill, the
 * percent "now to then", and the colour of what it would be, so the warning
 * comes before the tap. It puts its own words in the two lines.
 */

import type { CSSProperties } from 'react'
import { fullnessNote, fullnessOf, fullnessWords, HIDE_WHOLE_BYTES } from '../lib/shardFullness'

interface Props {
  /** The open shard's payload, in UTF-8 bytes (BYTES ON THE WIRE). */
  payload: number
  /** How many objects it places that go out on their own (lib/shardFullness.ts placedApart). */
  apart?: number
  /** The payload one stamp would leave (STAMP's library): a hatched run after the fill. */
  next?: number | null
  /** Words for the first line in place of the usual ones. */
  words?: string
  /** Words for the second line in place of the usual ones. */
  note?: string
}

const clamp = (n: number): number => Math.max(0, Math.min(1, n))

export function FullnessBar({ payload, apart = 0, next = null, words: ownWords, note: ownNote }: Props): JSX.Element {
  const f = fullnessOf(payload)
  const then = next === null ? null : fullnessOf(next)
  // What a stamp would leave, when it grows the shard: the bar shows it, in the colour it would be.
  const grown = then && then.payload > f.payload ? then : null
  const words = ownWords ?? fullnessWords(grown ?? f)
  const note = ownNote ?? fullnessNote(grown ?? f, apart)
  const level = (grown ?? f).level
  const style = { '--fb-share': clamp(f.share), '--fb-next': grown ? clamp(grown.share) - clamp(f.share) : 0 } as CSSProperties
  return (
    <div className={`fullbar fullbar--${level}`}>
      <div className="fullbar__head">
        <span className="fullbar__label">FULL</span>
        <span className="fullbar__pct" data-testid="fullbar-pct">
          {f.percent}%{grown && grown.percent !== f.percent && <> <span className="fullbar__to">TO</span> {grown.percent}%</>}
        </span>
      </div>
      <div
        className="fullbar__track"
        style={style}
        role="meter"
        aria-label="How full this shard is for one hidden object"
        aria-valuemin={0}
        aria-valuemax={HIDE_WHOLE_BYTES}
        aria-valuenow={Math.min(f.signed, HIDE_WHOLE_BYTES)}
        aria-valuetext={fullnessWords(f)}
      >
        <span className="fullbar__fill" />
        {grown && <span className="fullbar__next" data-testid="fullbar-next" />}
        <span className="fullbar__ticks" aria-hidden />
      </div>
      <div className="fullbar__words" data-testid="fullbar-words">
        <span className="fullbar__line" title={words}>{words}</span>
        <span className="fullbar__line fullbar__note" title={note || undefined}>{note}</span>
      </div>
    </div>
  )
}
