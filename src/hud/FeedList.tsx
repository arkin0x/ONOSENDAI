/**
 * FeedList.tsx - the Shard Feed as a list: everyone's published objects,
 * newest first, a picture of each, who made it, and a page more as the end
 * scrolls into view.
 *
 * Shared by the two places the feed is shown: the FEED tab of PLACE OBJECT,
 * where a tap lines the object up at the build cursor, and the SHARD FEED
 * window, where each tile carries DEPLOY AN INSTANCE and REMIX, and a tap on
 * the tile opens the shard's card (usePublicShard, arkinox 2026-11-14). The data is
 * useFeed's (sno-core's read); the pictures are ShardThumb's, as in every
 * other list of shards.
 *
 * An object for sale (a listing) is a card of its own among them, newest
 * first with the rest: its preview picture, title, author, price, and
 * BUY ON <seller> with the domain the button opens beside it. It has no shape until bought, so it is never
 * placed, deployed or remixed, and its picture is the seller's GIF, loaded
 * like a profile picture (https only, no referrer), not drawn here.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { nip19 } from 'nostr-tools'
import { ExternalLink, LockKeyhole, RefreshCw } from 'lucide-react'
import { feedItems, isListing, type FeedListing, type FeedObject } from 'sno-core/feed'
import { domainShown, listingPictures, satsLabel } from '../lib/listing'
import { useSellerLink } from '../hooks/useSellerLink'
import { useFeed } from '../store/useFeed'
import { useProfile } from '../hooks/useProfile'
import { profileLabel } from '../store/useProfiles'
import { ShardThumb } from './ShardThumb'
import { Chamfer, THUMB_PX } from './ui/Chamfer'
import { useMutes } from '../store/useMutes'
import { useCyberspace } from '../store/useCyberspace'
import { withoutMuted } from '../lib/muteList'
import { matches, searchKey } from '../lib/shardSearch'
import { Highlight } from './ui/SearchField'

/** A tile's picture, at the size a listing's GIF is shown, in the chamfered frame every row picture has (owner, 2026-11-15). */
function FeedThumb({ object }: { object: FeedObject }): JSX.Element {
  return <Chamfer className="feed__thumb"><ShardThumb shard={object.shard} size={THUMB_PX} /></Chamfer>
}

/** Who made it: their name from the profile cache, or their npub, shortened. */
function Author({ pubkey }: { pubkey: string }): JSX.Element {
  const profile = useProfile(pubkey)
  return <>{profileLabel(profile, nip19.npubEncode(pubkey))}</>
}

function Tile({ object, onPick, onOpen, actions, query = '' }: { object: FeedObject; onPick?: (o: FeedObject) => void; onOpen?: (o: FeedObject) => void; actions?: (o: FeedObject) => ReactNode; query?: string }): JSX.Element {
  const s = object.shard
  const body = (
    <>
      <FeedThumb object={object} />
      <span className="feed__text">
        <span className="feed__name"><Highlight text={s.name} query={query} /></span>
        <span className="feed__by"><Author pubkey={object.pubkey} /></span>
        <span className="feed__meta">{s.vertices.length} v · {s.faces.length} f{s.parts?.length ? ` · ${s.parts.length} obj` : ''}</span>
      </span>
    </>
  )
  return (
    <li className="feed__tile">
      {onPick
        ? <button className="feed__pick" onClick={() => onPick(object)} title={`Place "${s.name}" at the build cursor`}>{body}</button>
        : onOpen
          ? <button className="feed__pick" onClick={() => onOpen(object)} title={`Open "${s.name}": who made it, reactions and comments`}>{body}</button>
          : <div className="feed__pick">{body}</div>}
      {actions && <div className="feed__acts">{actions(object)}</div>}
    </li>
  )
}

/**
 * A listing's picture: the turntable GIF, the still if that fails, and a lock
 * if neither loads. Lazy, so a card scrolled far below costs nothing yet.
 */
function ListingPic({ listing }: { listing: FeedListing }): JSX.Element {
  const pictures = listingPictures(listing)
  const [tried, setTried] = useState(0)
  const src = pictures[tried]
  return (
    <Chamfer className="feed__thumb" decorative={false}>
      {src
        ? <img src={src} alt={listing.alt ?? ''} width={THUMB_PX} height={THUMB_PX} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setTried((n) => n + 1)} />
        : <LockKeyhole size={22} strokeWidth={2} className="feed__lock" aria-hidden />}
    </Chamfer>
  )
}

/** An object for sale: never placed (no shape until bought), bought from its seller's page. */
export function ListingTile({ listing, query = '' }: { listing: FeedListing; query?: string }): JSX.Element {
  const title = listing.title || 'Untitled'
  const link = useSellerLink(listing)
  return (
    <li className="feed__tile feed__tile--sale">
      <div className="feed__pick" title="For sale: its shape is sealed until bought">
        <ListingPic listing={listing} />
        <span className="feed__text">
          <span className="feed__name"><Highlight text={title} query={query} /></span>
          <span className="feed__by"><Author pubkey={listing.pubkey} /></span>
          <span className="feed__price">{satsLabel(listing.priceSats)}</span>
        </span>
      </div>
      {link && (
        <div className="feed__acts">
          {/* The domain is the link's own, so a seller's chosen name cannot hide where it goes. */}
          <a className="feed__act feed__act--buy" href={link.url} target="_blank" rel="noopener noreferrer" title={link.url}>
            <ExternalLink size={12} strokeWidth={2.25} aria-hidden />
            <span className="feed__buy-label">BUY ON {link.label}</span>
            <span className="feed__buy-domain">{domainShown(link.domain)}</span>
          </a>
        </div>
      )}
    </li>
  )
}

/** A feed entry's name, as the search matches it: an object's name, a listing's title. */
export function feedName(o: FeedObject | FeedListing): string {
  return isListing(o) ? o.title || 'Untitled' : o.shard.name
}

/**
 * `query` is the search typed under the list (PLACE OBJECT, the hide bar's
 * Model): only entries whose name holds it are shown, the matched part
 * marked. Pages keep coming while the end of the list is in view, so a
 * search reaches past the first page.
 */
export function FeedList({ onPick, onOpen, actions, query = '' }: { onPick?: (o: FeedObject) => void; onOpen?: (o: FeedObject) => void; actions?: (o: FeedObject) => ReactNode; query?: string }): JSX.Element {
  const allObjects = useFeed((s) => s.objects)
  const allListings = useFeed((s) => s.listings)
  // Less what the mute list hides: someone blocked, or one muted by its id (store/useMutes).
  const muted = useMutes((s) => s.muted)
  const me = useCyberspace((s) => s.identity.pubkey)
  const objects = useMemo(() => withoutMuted(allObjects, muted, me), [allObjects, muted, me])
  const listings = useMemo(() => withoutMuted(allListings, muted, me), [allListings, muted, me])
  // Objects and listings, newest first, merged once per change (not per render).
  const all = useMemo(() => feedItems({ objects, listings }), [objects, listings])
  const key = searchKey(query)
  const items = useMemo(() => (key === '' ? all : all.filter((o) => matches(feedName(o), key))), [all, key])
  const loading = useFeed((s) => s.loading)
  const exhausted = useFeed((s) => s.exhausted)
  const end = useRef<HTMLLIElement>(null)
  // The list's own scroll box: the root every observer here measures against.
  const [list, setList] = useState<HTMLUListElement | null>(null)

  // The first page on first sight; the feed is kept after that (useFeed).
  useEffect(() => { useFeed.getState().start() }, [])

  // The next page when the end of the list comes into view. Re-armed when a
  // page finishes as well as when the count changes: a page that brought
  // nothing new (every newest event sealed, say) left the end in view with
  // no change to observe, and the list stalled (review of #233).
  useEffect(() => {
    const el = end.current
    if (!el || !list || loading || exhausted || typeof IntersectionObserver === 'undefined') return
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) useFeed.getState().more()
    }, { root: list, rootMargin: '120px' })
    watch.observe(el)
    return () => watch.disconnect()
  }, [items.length, loading, exhausted, list])

  return (
    <div className="feed">
      <ul className="feed__list" ref={setList}>
        {items.map((o) => isListing(o)
          ? <ListingTile key={o.address} listing={o} query={key} />
          : <Tile key={o.address} object={o} onPick={onPick} onOpen={onOpen} actions={actions} query={key} />)}
        <li className="feed__end" ref={end}>
          {loading || (items.length === 0 && !exhausted)
            ? key !== '' && items.length === 0 ? 'No matches yet. Reading the relays…' : 'Reading the relays…'
            : items.length === 0
              ? key !== '' ? 'No matches' : 'No published objects found on these relays yet.'
              : exhausted ? 'That is everything on these relays.' : ''}
        </li>
      </ul>
      <button className="feed__refresh" onClick={() => useFeed.getState().refresh()} disabled={loading} title="Read the relays again from the newest">
        <RefreshCw size={12} strokeWidth={2.25} aria-hidden /> REFRESH
      </button>
    </div>
  )
}
