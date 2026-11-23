/**
 * FullnessBar.tsx: how full the open shard is against what one hide holds
 * whole (lib/shardFullness.ts), as a bar and in words, under BYTES ON THE
 * WIRE in the SHARD sheet (owner, 2026-11-23), and in STAMP's library with
 * what a stamp would add (`next`).
 *
 * Drawn as a segmented HUD meter in a chamfered frame, top-left and
 * bottom-right corners cut like the item thumbnails, a lit edge on the fill
 * and a tick every tenth (inspired by the segmented status and capacity
 * meters in the HUD/FUI collections on Dribbble: pbranigan's "HUD FUI
 * Inspiration", albemala's "Sci-Fi Futuristic UIs"). Calm cyan until it is
 * close to full, amber from NEAR_FULL, red past the limit: nothing shouts
 * until it matters. What a stamp would add shows as a hatched run after the
 * fill, in the colour the result would be.
 *
 * The words keep their two lines whatever they say, so nothing under the bar
 * moves when a shard grows past a line, or a note about placed objects comes
 * or goes.
 */

import { fullnessOf, fullnessWords, HIDE_WHOLE_BYTES, type Fullness } from '../lib/shardFullness'

interface Props {
  /** The open shard's payload, in UTF-8 bytes (BYTES ON THE WIRE). */
  payload: number
  /** The payload a stamp would leave, when one is chosen: shown as a hatched run after the fill. */
  next?: number | null
  /** How many objects it places that go out on their own (lib/shardFullness.ts placedApart). */
  apart?: number
  /** Words in place of the usual ones under the bar (STAMP's own). */
  words?: string
}

const pct = (share: number): string => `${Math.max(0, Math.min(1, share)) * 100}%`

export function FullnessBar({ payload, next = null, apart = 0, words }: Props): JSX.Element {
  const now: Fullness = fullnessOf(payload)
  const then: Fullness | null = next === null ? null : fullnessOf(next)
  // The bar takes the colour of what it would be after the stamp, so the warning comes before the tap.
  const level = then && then.share > now.share ? then.level : now.level
  const note = apart > 0
    ? `Counts this shard itself. The ${apart === 1 ? 'object' : `${apart} objects`} it places ${apart === 1 ? 'goes' : 'go'} out on ${apart === 1 ? 'its' : 'their'} own.`
    : ''
  return (
    <div className={`fullbar fullbar--${level}`}>
      <div className="fullbar__head">
        <span className="fullbar__label">FULL</span>
        <span className="fullbar__pct" data-testid="fullbar-pct">
          {now.percent}%{then && then.payload !== now.payload ? <> <span className="fullbar__arrow">to</span> {then.percent}%</> : null}
        </span>
      </div>
      <div
        className="fullbar__track"
        role="meter"
        aria-label="How full this shard is for one hide"
        aria-valuemin={0}
        aria-valuemax={HIDE_WHOLE_BYTES}
        aria-valuenow={Math.min(now.signed, HIDE_WHOLE_BYTES)}
        aria-valuetext={fullnessWords(now)}
      >
        <span className="fullbar__fill" style={{ width: pct(now.share) }} />
        {then && then.share > now.share && (
          <span className="fullbar__next" data-testid="fullbar-next" style={{ left: pct(now.share), width: pct(Math.min(1, then.share) - Math.min(1, now.share)) }} />
        )}
        <span className="fullbar__ticks" aria-hidden />
      </div>
      <div className="fullbar__words" data-testid="fullbar-words">
        <span>{words ?? fullnessWords(now)}</span>
        <span className="fullbar__note">{note}</span>
      </div>
    </div>
  )
}
