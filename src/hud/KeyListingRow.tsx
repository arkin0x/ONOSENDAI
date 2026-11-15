/**
 * KeyListingRow.tsx: a published key item (a kind 33340 listing, the ITEM
 * FEED), as a row, and OPENS WITH, the row a locked door or chest shows for
 * the key item it is locked to.
 *
 * KeyListingRow is the FEED's row (KEY ITEMS > FEED): the listing's
 * picture in the shared chamfered thumbnail, its name, who listed it (their
 * picture opens their profile) and when, a chip for whether you hold it, and
 * DETAILS with its keys to copy and its words. Nothing here publishes.
 *
 * OPENS WITH (owner, 2026-11-15: "if a door or chest is locked to a key item
 * that is published, i want to display the key item picture and name on the
 * door modal (or chest modal, etc) in the same style its displayed in the
 * items/nearby"): under a locked door or chest, wherever one is shown
 * (ItemRows ChestBlock), the listing of the key item its lock is sealed to,
 * matched by the item's public key as the FEED matches, so a renamed copy
 * is still the one. A lock whose key nobody listed shows nothing at all,
 * not even that there is no listing: only what the public listing says is
 * ever drawn, never the hider's own words or anything secret. The feed is
 * read once a session for this (useItemFeed ensure), the whole feed and not
 * one listing per lock, so no relay is asked about a particular lock.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useProfile } from '../hooks/useProfile'
import { listingForLock, type ItemListing } from '../lib/itemListing'
import { heldKeypairs } from '../lib/inventory'
import { hidesThing } from '../lib/muteList'
import { safeNpub } from '../lib/npub'
import { useCyberspace } from '../store/useCyberspace'
import { useInventory } from '../store/useInventory'
import { useItemFeed } from '../store/useItemFeed'
import { useMutes } from '../store/useMutes'
import { profileLabel } from '../store/useProfiles'
import { Copyable, HeldRowLine } from './HeldRowLine'
import { ItemThumb } from './ItemThumb'
import { ProfilePic, ProfileTap } from './ProfileBadge'

/** The heading over the key item a lock is sealed to. */
export const OPENS_WITH = 'OPENS WITH'
/** The chip on a listed key item you have not found (the FEED's word). */
export const NOT_FOUND = 'NOT FOUND'
/** The chip on one you hold (the word a found key's line says once taken, ItemRows KeyLine). */
export const IN_YOUR_ITEMS = 'IN YOUR ITEMS'

/**
 * A published key item as a row: its picture, name, who listed it and when,
 * NOT FOUND or IN YOUR ITEMS, and DETAILS. `size` is the picture's side, for
 * a narrow column (a bag's list, a chest inside a chest).
 */
export function KeyListingRow({ listing, held, size }: { listing: ItemListing; held: boolean; size?: number }): JSX.Element {
  const profile = useProfile(listing.lister)
  const who = profileLabel(profile, safeNpub(listing.lister))
  const [open, setOpen] = useState(false)
  return (
    <li className="secrets__row held__row held__row--item" style={size ? ({ '--chamfer-size': `${size}px` } as CSSProperties) : undefined}>
      <ItemThumb type="key" image={listing.image} size={size} />
      <HeldRowLine
        name={listing.name}
        title={listing.about || listing.name}
        source={<span className="items-feed__src"><span>listed by</span><ProfileTap pubkey={listing.lister} className="items-feed__who" title={who}><ProfilePic pubkey={listing.lister} size={12} /><span className="items-feed__name">{who}</span></ProfileTap></span>}
        at={listing.createdAt}
        chips={held
          ? <span className="item__chip tag items-feed__held" title="It is in your ITEMS">{IN_YOUR_ITEMS}</span>
          : <span className="item__chip tag items-feed__unfound" title="You have not found this item. Find it to hold it">{NOT_FOUND}</span>}
      />
      <span className="held__acts">
        <button className={`chest__act ${open ? 'is-on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>DETAILS</button>
      </span>
      {open && (
        <div className="held__details">
          <dl>
            <Copyable label="item" value={safeNpub(listing.itemPubkey)} title={safeNpub(listing.itemPubkey)} />
            <Copyable label="hex" value={listing.itemPubkey} title={listing.itemPubkey} />
            <dt>Listed by</dt><dd>{who}</dd>
            {listing.about && <><dt>About</dt><dd>{listing.about}</dd></>}
          </dl>
        </div>
      )}
    </li>
  )
}

/**
 * The listing of the key item `lock` is sealed to, or null: not listed, not
 * read yet, or listed only by someone you muted or blocked (the FEED leaves
 * those out too). Asks for the feed once a session.
 */
export function useLockListing(lock: string): ItemListing | null {
  useEffect(() => { useItemFeed.getState().ensure() }, [])
  const listings = useItemFeed((s) => s.listings)
  const muted = useMutes((s) => s.muted)
  const me = useCyberspace((s) => s.identity.pubkey)
  return useMemo(() => listingForLock(listings, lock, (l) => hidesThing(muted, { authors: [l.lister], ids: [l.id] }, me)), [listings, lock, muted, me])
}

/**
 * OPENS WITH over the listed key item a locked door or chest is sealed to,
 * with whether you hold it. Nothing when its key is not listed.
 */
export function OpensWith({ lock, size }: { lock: string; size?: number }): JSX.Element | null {
  const listing = useLockListing(lock)
  const held = useInventory((s) => heldKeypairs(s.items).has(lock))
  if (!listing) return null
  return (
    <div className="lockkey">
      <span className="legend__label lockkey__label">{OPENS_WITH}</span>
      <ul className="secrets__list held__list lockkey__list">
        <KeyListingRow listing={listing} held={held} size={size} />
      </ul>
    </div>
  )
}
