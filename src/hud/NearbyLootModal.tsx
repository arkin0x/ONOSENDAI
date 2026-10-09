/**
 * NearbyLootModal.tsx — what has been decrypted where you stand.
 *
 * The green box is the region your keys open; this is the list of what is in
 * it: every shard, message, key and chest this client has opened or placed
 * whose region holds the anchor, nearest first. Reached from the found chip,
 * which says how many, and from NEARBY on the DISCOVERED panel. VIEW flies to
 * the thing the way the bag record's VIEW does. A key row says it is held; a
 * chest row opens here when you hold what opens it (ItemRows).
 */

import { useMemo } from 'react'
import { useNearbyLoot, type NearbyItem } from '../hooks/useNearbyLoot'
import { useProfile } from '../hooks/useProfile'
import { findCashuToken } from '../lib/cashu'
import { hiddenGlyph, messagePreview } from '../lib/hidden'
import type { HeldPlace } from '../lib/inventory'
import { formatDistance } from 'sno-core/scale'
import { useCyberspace } from '../store/useCyberspace'
import { profileLabel } from '../store/useProfiles'
import { useShards } from '../store/useShards'
import { rememberNearbyReturn } from '../lib/nearbyReturn'
import { ProfilePic } from './ProfileBadge'
import { ChestBlock, KeyLine } from './ItemRows'
import { nip19 } from 'nostr-tools'
import { useEscape } from '../hooks/useEscape'

function safeNpub(pubkey: string): string {
  try { return nip19.npubEncode(pubkey) } catch { return pubkey }
}

/** Where a nearby item was found, for what is taken out of a chest here. */
function placeOf(item: NearbyItem): HeldPlace {
  return { lookupId: item.lookupId ?? '', bagId: item.bagId ?? '', at: { x: item.at.x.toString(), y: item.at.y.toString(), z: item.at.z.toString() }, plane: item.plane, height: item.height }
}

/** The first line: the message itself, the shard named in quotes with its size, or the key's or chest's name. */
function labelOf(item: NearbyItem): string {
  if (item.type === 'message') return findCashuToken(item.text) ? '₿ cashu token' : messagePreview(item.text ?? '', 160)
  if (item.type === 'key') return item.keyItem?.name ?? 'key'
  if (item.type === 'chest') return item.chest?.name ?? 'chest'
  const shard = item.shard
  return shard ? `\u201c${shard.name}\u201d shard \u00b7 ${shard.vertices.length} vertices \u00b7 ${shard.faces.length} faces` : 'shard'
}

/** The second line: where it is, in the words the panels use. */
function whereOf(item: NearbyItem): string {
  return `${item.plane === 1 ? 'Ideaspace' : 'Dataspace'}, height ${item.height}`
}

function Row({ item, me, onView }: { item: NearbyItem; me: string; onView: (item: NearbyItem) => void }): JSX.Element {
  const profile = useProfile(item.author ?? null)
  const author = item.author ?? ''
  const name = author === me ? 'you' : profileLabel(profile, safeNpub(author))
  return (
    <li className="secrets__row nearby__row">
      <span className="nearby__glyph" aria-hidden="true">{hiddenGlyph(item.type, item.type === 'message' && findCashuToken(item.text) !== null)}</span>
      <div className="nearby__body">
        {item.type === 'key' && item.keyItem
          ? <KeyLine name={item.keyItem.name} author={author} />
          : item.type === 'chest' && item.chest
            ? <ChestBlock id={item.key} chest={item.chest} author={author} place={placeOf(item)} />
            : <span className="nearby__label">{labelOf(item)}</span>}
        <span className="nearby__where">{whereOf(item)}</span>
        <span className="nearby__meta">
          {author && <ProfilePic pubkey={author} size={14} />}
          <span>{name}</span>
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
  // Escape closes it as a tap outside does (arkinox, 2026-10-01).
  useEscape('modal', open, () => useShards.getState().setNearbyOpen(false))
  if (!open) return null
  const close = (): void => useShards.getState().setNearbyOpen(false)
  const view = (item: NearbyItem): void => {
    // Where to come back to, spectation and link included, before looking away.
    rememberNearbyReturn()
    close()
    const unit = item.type === 'shard' ? item.shard?.unit ?? 0 : 0
    useCyberspace.getState().focusItem(item.at, item.plane, labelOf(item).toUpperCase(), unit)
  }
  return (
    <div className="modal" role="dialog" aria-label="Discovered nearby" aria-modal="true" onPointerDown={close}>
      <div className="modal__card secrets__box" onPointerDown={(e) => e.stopPropagation()}>
        <header className="panel__head secrets__head">
          <h2>Discovered nearby</h2>
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
