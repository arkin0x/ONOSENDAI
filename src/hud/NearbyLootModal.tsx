/**
 * NearbyLootModal.tsx — what has been decrypted where you stand.
 *
 * The green box is the region your keys open; this is the list of what is in
 * it: every shard and message this client has opened or placed whose region
 * holds the anchor, nearest first. Reached from the found chip, which says
 * how many, and from NEARBY on the Loot panel. VIEW flies to the thing the
 * way the loot record's VIEW does.
 */

import { useMemo } from 'react'
import { useNearbyLoot, type NearbyItem } from '../hooks/useNearbyLoot'
import { useProfile } from '../hooks/useProfile'
import { findCashuToken } from '../lib/cashu'
import { messagePreview } from '../lib/hidden'
import { regionLabel } from '../lib/loot'
import { formatDistance } from '../lib/scale'
import { useCyberspace } from '../store/useCyberspace'
import { profileLabel } from '../store/useProfiles'
import { useShards } from '../store/useShards'
import { ProfilePic } from './ProfileBadge'
import { nip19 } from 'nostr-tools'

function safeNpub(pubkey: string): string {
  try { return nip19.npubEncode(pubkey) } catch { return pubkey }
}

function labelOf(item: NearbyItem): string {
  if (item.type === 'message') return findCashuToken(item.text) ? '₿ cashu token' : messagePreview(item.text ?? '', 60)
  return item.shard?.name ?? 'shard'
}

function Row({ item, me, onView }: { item: NearbyItem; me: string; onView: (item: NearbyItem) => void }): JSX.Element {
  const profile = useProfile(item.author ?? null)
  const author = item.author ?? ''
  const name = author === me ? 'you' : profileLabel(profile, safeNpub(author))
  return (
    <li className="secrets__row nearby__row">
      <span className="nearby__glyph" aria-hidden="true">{item.type === 'message' ? (findCashuToken(item.text) ? '₿' : '✎') : '◇'}</span>
      <div className="nearby__body">
        <span className="nearby__label">{labelOf(item)}</span>
        <span className="nearby__meta">
          {author && <ProfilePic pubkey={author} size={14} />}
          <span>{name}</span>
          <span>· {regionLabel(item.height)}</span>
          <span>· {item.distance === 0n ? 'right here' : `${formatDistance(item.distance)} away`}</span>
        </span>
      </div>
      <button className="avatars__go nearby__view" onClick={() => onView(item)} title="Fly to it">VIEW ▸</button>
    </li>
  )
}

export function NearbyLootModal(): JSX.Element | null {
  const open = useShards((s) => s.nearbyOpen)
  const me = useCyberspace((s) => s.identity.pubkey)
  const items = useNearbyLoot()
  const list = useMemo(() => items, [items])
  if (!open) return null
  const close = (): void => useShards.getState().setNearbyOpen(false)
  const view = (item: NearbyItem): void => {
    close()
    const unit = item.type === 'shard' ? item.shard?.unit ?? 0 : 0
    useCyberspace.getState().focusOn(item.at, item.plane, labelOf(item).toUpperCase(), unit)
  }
  return (
    <div className="modal" role="dialog" aria-label="Nearby loot" aria-modal="true" onPointerDown={close}>
      <div className="modal__card secrets__box" onPointerDown={(e) => e.stopPropagation()}>
        <header className="panel__head secrets__head">
          <h2>Nearby loot</h2>
          <span className="tag">{list.length === 0 ? 'NOTHING HERE' : `${list.length} DECRYPTED HERE`}</span>
          <button className="targets__remove secrets__close" onClick={close} aria-label="Close" title="Close">✕</button>
        </header>
        <div className="secrets__summary">
          <span>Hop actions produce region keys that decrypt hidden things nearby.</span>
        </div>
        <ul className="secrets__list">
          {list.length === 0 && <li className="secrets__empty">Nothing decrypted in this region. A rescan is triggered after every movement action.</li>}
          {list.map((item) => <Row key={item.key} item={item} me={me} onView={view} />)}
        </ul>
      </div>
    </div>
  )
}
