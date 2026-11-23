/**
 * PartFormBadge.tsx: the one mark that says whether a placed object is a LINK
 * to a public object (green, lucide `link`) or SEALED, a copy carried with
 * what you hide (orange, lucide `lock`) (lib/partForm.ts; owner, 2026-11-22;
 * SEALED, not COPY, since STAMP's COPY means something else, 2026-11-23). The bench
 * puts one in a corner of every placed object (workshop/PartBadges), and the
 * SHARD sheet beside the publish status; the same component everywhere, so
 * the two can never disagree.
 *
 * Drawn as a small chamfered tile, its top-left and bottom-right corners cut
 * like the item thumbnails, on near-black ink with a lit edge in its colour,
 * so it reads over a bright bench as well as a dark one (inspired by the
 * sci-fi HUD badge sets: designerjer's "Sci-fi Tangerine UI Badges" and the
 * HUD/FUI collections on Dribbble). The icon carries the meaning, the colour
 * repeats it, and the label says it in words for a screen reader and a hover.
 */

import { Link, Lock } from 'lucide-react'
import { FORM_LABEL, type PartForm } from '../lib/partForm'

export function PartFormBadge({ form, size = 'small' }: { form: PartForm; size?: 'small' | 'inline' }): JSX.Element {
  const Icon = form === 'link' ? Link : Lock
  return (
    <span className={`partform-wrap partform-wrap--${size}`} role="img" aria-label={FORM_LABEL[form]} title={FORM_LABEL[form]}>
      <span className={`partform partform--${form} partform--${size}`}>
        <Icon size={size === 'inline' ? 12 : 13} strokeWidth={2.5} aria-hidden />
      </span>
      {/* Beside the publish status, the word too: a phone shows no hover. */}
      {size === 'inline' && <span className={`partform-word partform-word--${form}`} aria-hidden>{form === 'link' ? 'LINK' : 'SEALED'}</span>}
    </span>
  )
}
