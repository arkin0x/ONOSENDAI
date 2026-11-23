/**
 * BloomCard.tsx - a seed's card (DECK-0008): what grew, from which DNA, how
 * old, and anything that keeps it from growing. Opened from the bloom in the
 * world or from a list, inside the hidden-thing card (SecretModal).
 */

import { useEffect, useMemo } from 'react'
import { CardSpin } from '../scene/CardSpin'
import { ProfileBadge } from './ProfileBadge'
import { growAnyway, useBlooms, wantSeeds } from '../store/useBlooms'
import { seedItemOf } from '../lib/seeds/seedItem'
import { standBloom } from '../lib/seeds/orientation'
import { bloomDays, bloomStateLine } from '../lib/seeds/bloomWords'
import type { NostrEvent } from '../lib/events'

export function BloomCard({ event }: { event: NostrEvent | undefined }): JSX.Element | null {
  const seed = useMemo(() => (event ? seedItemOf(event) : null), [event])
  const view = useBlooms((s) => (seed ? s.views[seed.id] : undefined))
  // A seed opened from a list, out of view, still grows for its card.
  useEffect(() => { if (seed) wantSeeds([seed]) }, [seed])
  if (!seed) return null

  const days = bloomDays(view)
  const line = bloomStateLine(view)
  const g = view?.growth
  return (
    <div className="bloom">
      <h3 className="secret__look-name">{view?.dna?.name ?? seed.title ?? 'seed'}</h3>
      {/* Turned as it stands (§5.7); the card has no Earth to stand it on. */}
      {view?.shard && <div className="secret__spin"><CardSpin shard={standBloom(view.shard, seed.stand, 1)} /></div>}
      {line && <p className="bloom__state">{line}</p>}
      {view?.status === 'heavy' && (
        <button className="secret__act bloom__anyway" onClick={() => growAnyway(seed.id)}>GROW ANYWAY</button>
      )}
      <dl className="bloom__facts">
        {days !== null && <><dt>AGE</dt><dd>{days === 1 ? '1 day' : `${days} days`}</dd></>}
        {g && <><dt>GENERATION</dt><dd>{g.generation}{g.generation < g.targetGeneration ? ` of ${g.targetGeneration}` : ''}</dd></>}
        <dt>PLANTED</dt><dd>block {(view?.planted ?? seed.planted).toLocaleString('en-US')}</dd>
        {seed.scale !== 0 && <><dt>SCALE</dt><dd>2^{seed.scale}</dd></>}
      </dl>
      <div className="bloom__who">
        <span className="secret__label">Planter</span>
        <ProfileBadge pubkey={seed.planter} tappable />
      </div>
      {view?.dna && (
        <div className="bloom__who">
          <span className="secret__label">DNA by</span>
          <ProfileBadge pubkey={view.dna.author} tappable />
        </div>
      )}
    </div>
  )
}
