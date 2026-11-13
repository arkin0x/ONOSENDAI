/**
 * bloomWords.ts - what the bloom card says about a seed's state, in a few
 * words each (arkinox's voice: short, plain, no paragraphs).
 */

import { BLOCKS_PER_GENERATION } from 'sno-core/seeds'
import type { BloomView } from './bloomEngine'
import { previewLastDay } from './plant'

/** The one line the card shows under the bloom for a state, or null when the bloom is simply growing. */
export function bloomStateLine(v: BloomView | undefined): string | null {
  if (!v) return 'Reading the seed.'
  switch (v.status) {
    case 'reading': return 'Fetching its DNA.'
    case 'dna-missing': return 'Its DNA was not found.'
    case 'dna-invalid': return `Its DNA was refused. ${v.error ?? ''}`.trim()
    case 'mixed': return 'Mixed DNA, coming soon.'
    case 'underpaid': return 'Its work is short of its price. Not grown.'
    case 'no-clock': return 'Waiting for blocks.'
    case 'waiting': return 'Waiting for blocks.'
    case 'pending': return 'Pending. It grows once its block settles.'
    case 'cannot-grow': return 'It can never grow: its time is before the chain.'
    case 'heavy': return 'Too heavy to grow here.'
    case 'growing': return 'Growing.'
    case 'error': return `It did not grow. ${v.error ?? ''}`.trim()
    case 'grown':
      return v.growth?.behind ? (v.growth.missingBlock !== undefined ? `Behind: block ${v.growth.missingBlock.toLocaleString('en-US')} is missing.` : 'Behind.') : null
  }
}

/** Whole days of blocks since it was planted: its age over 144. */
export function bloomDays(v: BloomView | undefined): number | null {
  if (!v || v.planted === undefined || v.clock === undefined) return null
  return Math.max(0, Math.floor((v.clock - v.planted) / BLOCKS_PER_GENERATION))
}

/**
 * A seed's growth in a row (DISCOVERED NEARBY's SEEDS): "day 12 of 41" on the
 * same clock the card's AGE reads (NTH's newest anchor), "fully grown" from
 * the DNA's last day on (plant.ts previewLastDay, the day SEED's slider ends
 * on), while it is grown or growing; in any other state the card's line for
 * it, without its full stop: a seed too heavy to grow here, or one that did
 * not grow, keeps its planted height and clock, and is not at its age.
 */
export function bloomGrowthWords(v: BloomView | undefined): string {
  const days = bloomDays(v)
  if (v && (v.status === 'grown' || v.status === 'growing') && days !== null && v.dna) {
    const last = previewLastDay(v.dna)
    return days >= last ? 'fully grown' : `day ${days} of ${last}`
  }
  return (bloomStateLine(v) ?? 'Growing.').replace(/\.$/, '')
}
