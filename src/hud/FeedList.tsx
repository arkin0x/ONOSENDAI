/**
 * FeedList.tsx - the Shard Feed as a list: everyone's published objects,
 * newest first, a picture of each, who made it, and a page more as the end
 * scrolls into view.
 *
 * Shared by the two places the feed is shown: the FEED tab of PLACE OBJECT,
 * where a tap lines the object up at the build cursor, and the SHARD FEED
 * window, where each tile carries USE IN BUILDER and REMIX. The data is
 * useFeed's (sno-core's read); the pictures are useThumbs', drawn by the one
 * ThumbStage mounted here.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { nip19 } from 'nostr-tools'
import { RefreshCw } from 'lucide-react'
import type { FeedObject } from 'sno-core/feed'
import { useFeed } from '../store/useFeed'
import { useThumbs } from '../store/useThumbs'
import { useProfile } from '../hooks/useProfile'
import { profileLabel } from '../store/useProfiles'
import { ThumbStage } from '../scene/ThumbStage'

/**
 * A tile's picture, asked for once the tile is within 200 px of the list's
 * visible part. The list scrolls inside its own box, so that box is the
 * observer's root; against the page's viewport the margin did nothing.
 */
function FeedThumb({ object, root }: { object: FeedObject; root: HTMLElement | null }): JSX.Element {
  const url = useThumbs((s) => s.urls[object.id])
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (url) return
    const el = box.current
    if (!el || typeof IntersectionObserver === 'undefined') { useThumbs.getState().request(object.id, object.shard); return }
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { useThumbs.getState().request(object.id, object.shard); seen.disconnect() }
    }, { root, rootMargin: '200px' })
    seen.observe(el)
    return () => seen.disconnect()
  }, [url, object.id, object.shard, root])
  return (
    <div className="feed__thumb" ref={box}>
      {url ? <img src={url} alt="" width={80} height={80} /> : <span className="feed__thumb-wait" aria-hidden="true" />}
    </div>
  )
}

/** Who made it: their name from the profile cache, or their npub, shortened. */
function Author({ pubkey }: { pubkey: string }): JSX.Element {
  const profile = useProfile(pubkey)
  return <>{profileLabel(profile, nip19.npubEncode(pubkey))}</>
}

function Tile({ object, onPick, actions, root }: { object: FeedObject; onPick?: (o: FeedObject) => void; actions?: (o: FeedObject) => ReactNode; root: HTMLElement | null }): JSX.Element {
  const s = object.shard
  const body = (
    <>
      <FeedThumb object={object} root={root} />
      <span className="feed__text">
        <span className="feed__name">{s.name}</span>
        <span className="feed__by"><Author pubkey={object.pubkey} /></span>
        <span className="feed__meta">{s.vertices.length} v · {s.faces.length} f{s.parts?.length ? ` · ${s.parts.length} obj` : ''}</span>
      </span>
    </>
  )
  return (
    <li className="feed__tile">
      {onPick
        ? <button className="feed__pick" onClick={() => onPick(object)} title={`Place "${s.name}" at the build cursor`}>{body}</button>
        : <div className="feed__pick">{body}</div>}
      {actions && <div className="feed__acts">{actions(object)}</div>}
    </li>
  )
}

export function FeedList({ onPick, actions }: { onPick?: (o: FeedObject) => void; actions?: (o: FeedObject) => ReactNode }): JSX.Element {
  const objects = useFeed((s) => s.objects)
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
  }, [objects.length, loading, exhausted, list])

  return (
    <div className="feed">
      <ThumbStage />
      <ul className="feed__list" ref={setList}>
        {objects.map((o) => <Tile key={o.address} object={o} onPick={onPick} actions={actions} root={list} />)}
        <li className="feed__end" ref={end}>
          {loading || (objects.length === 0 && !exhausted)
            ? 'Reading the relays…'
            : objects.length === 0
              ? 'No published objects found on these relays yet.'
              : exhausted ? 'That is everything on these relays.' : ''}
        </li>
      </ul>
      <button className="feed__refresh" onClick={() => useFeed.getState().refresh()} disabled={loading} title="Read the relays again from the newest">
        <RefreshCw size={12} strokeWidth={2.25} aria-hidden /> REFRESH
      </button>
    </div>
  )
}
