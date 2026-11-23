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
 */

import type { CSSProperties } from 'react'
import { fullnessNote, fullnessOf, fullnessWords, HIDE_WHOLE_BYTES } from '../lib/shardFullness'

interface Props {
  /** The open shard's payload, in UTF-8 bytes (BYTES ON THE WIRE). */
  payload: number
  /** How many objects it places that go out on their own (lib/shardFullness.ts placedApart). */
  apart?: number
}

export function FullnessBar({ payload, apart = 0 }: Props): JSX.Element {
  const f = fullnessOf(payload)
  const words = fullnessWords(f)
  const note = fullnessNote(f, apart)
  const style = { '--fb-share': Math.max(0, Math.min(1, f.share)) } as CSSProperties
  return (
    <div className={`fullbar fullbar--${f.level}`}>
      <div className="fullbar__head">
        <span className="fullbar__label">FULL</span>
        <span className="fullbar__pct" data-testid="fullbar-pct">{f.percent}%</span>
      </div>
      <div
        className="fullbar__track"
        style={style}
        role="meter"
        aria-label="How full this shard is for one hidden object"
        aria-valuemin={0}
        aria-valuemax={HIDE_WHOLE_BYTES}
        aria-valuenow={Math.min(f.signed, HIDE_WHOLE_BYTES)}
        aria-valuetext={words}
      >
        <span className="fullbar__fill" />
        <span className="fullbar__ticks" aria-hidden />
      </div>
      <div className="fullbar__words" data-testid="fullbar-words">
        <span className="fullbar__line" title={words}>{words}</span>
        <span className="fullbar__line fullbar__note" title={note || undefined}>{note}</span>
      </div>
    </div>
  )
}
