/**
 * ItemFeedPicker.tsx: the ITEM FEED, opened from a chest's lock (arkinox,
 * 2026-10-13): "when sealing a chest, there should be an Item Feed button to
 * choose an item that already exists and is published."
 *
 * Every verified listing your relays hold (store/useItemFeed.ts), newest
 * first, searchable by name. Choosing one seals the chest to that item's
 * public key, though you have never held it: whoever holds it opens the
 * chest.
 */

import { useEffect, useMemo, useState } from 'react'
import { useProfile } from '../hooks/useProfile'
import { useEscape } from '../hooks/useEscape'
import { searchListings, type ItemListing } from '../lib/itemListing'
import { safeNpub } from '../lib/npub'
import { formatAgo, formatStamp } from '../lib/time'
import { profileLabel } from '../store/useProfiles'
import { useItemFeed } from '../store/useItemFeed'
import { ItemFace } from './ItemIcon'
import { useMutes } from '../store/useMutes'
import { hidesThing } from '../lib/muteList'
import { useCyberspace } from '../store/useCyberspace'

function Row({ listing, onPick }: { listing: ItemListing; onPick: (l: ItemListing) => void }): JSX.Element {
  const profile = useProfile(listing.lister)
  return (
    <li className="secrets__row held__row">
      <ItemFace className="chest__glyph chest__glyph--key" type="key" image={listing.image} />
      <span className="item__line">
        <span className="item__name" title={listing.about || listing.name}>{listing.name}</span>
        <span className="item__meta">
          listed by {profileLabel(profile, safeNpub(listing.lister))} · <span title={formatStamp(listing.createdAt)}>{formatAgo(listing.createdAt)}</span>
        </span>
      </span>
      <span className="held__acts">
        <button className="chest__act" onClick={() => onPick(listing)} title="Seal the chest to this item">SEAL TO IT</button>
      </span>
    </li>
  )
}

export function ItemFeedPicker({ onPick, onClose }: { onPick: (l: ItemListing) => void; onClose: () => void }): JSX.Element {
  const listings = useItemFeed((s) => s.listings)
  const loading = useItemFeed((s) => s.loading)
  const [q, setQ] = useState('')
  // Read fresh each time it opens: a listing published a minute ago belongs here.
  useEffect(() => { void useItemFeed.getState().load() }, [])
  useEscape('modal', true, onClose)
  // Nothing listed by someone blocked, or muted by its id (store/useMutes).
  const muted = useMutes((s) => s.muted)
  const me = useCyberspace((s) => s.identity.pubkey)
  const shown = useMemo(() => searchListings(listings, q).filter((l) => !hidesThing(muted, { authors: [l.lister], ids: [l.id] }, me)), [listings, q, muted, me])
  return (
    <div className="modal" role="dialog" aria-label="Item feed" aria-modal="true" onPointerDown={onClose}>
      <div className="modal__card secrets__box" onPointerDown={(e) => e.stopPropagation()}>
        <header className="panel__head secrets__head">
          <h2>Item feed</h2>
          <span className="tag">{loading && listings.length === 0 ? 'READING…' : `${listings.length} LISTED`}</span>
          <button className="targets__remove secrets__close" onClick={onClose} aria-label="Close" title="Close">✕</button>
        </header>
        <input className="avatars__input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items by name" aria-label="Search items" autoFocus />
        <ul className="secrets__list">
          {shown.length === 0 && (
            <li className="secrets__empty">{loading ? 'Reading the item feed…' : listings.length === 0 ? 'No items are listed on your relays yet.' : 'No listed item matches.'}</li>
          )}
          {shown.map((l) => <Row key={l.itemPubkey} listing={l} onPick={onPick} />)}
        </ul>
      </div>
    </div>
  )
}
