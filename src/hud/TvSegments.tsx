/**
 * TvSegments.tsx: Cyberspace TV's segments, for what happened on the tape
 * besides moves (arkinox, 2026-10-18).
 *
 * - A bag sealed somewhere no public hint names plays here, in an inset, on
 *   a cube that stands for it and nowhere: outlines, then sides, a key
 *   stamped on each side, the sides fading, LOCATION SECRET. A bag whose
 *   hint box is public plays in the world instead (scene/TvBoxes).
 * - An object published: the product shot, the object turning, its name.
 * - A new avatar: the same product shot, NEW LOOK, the owner's name.
 * - A comment: the news desk. "on the left third the avatar was displayed
 *   like a photograph and the right 2/3 was a box with the comment as a
 *   Quote that prints out like words being transcribed in real time". A
 *   comment on a move is public and prints as written; one on a bag is
 *   sealed to the bag's region and prints as redaction, which is what a
 *   viewer who has not found the bag can know of it.
 */

import { useEffect, useMemo, useState } from 'react'
import { useAvatarShard } from '../store/useAvatars'
import { useTv } from '../store/useTv'
import { useProfile } from '../hooks/useProfile'
import { safeNpub } from '../lib/npub'
import { objectsOf } from '../workshop/ObjectPicker'
import { avatarFromEvent } from '../lib/avatar'
import type { TapeItem } from '../lib/tv/director'
import { ShardSpin } from '../scene/ShardSpin'
import { ProfilePic } from './ProfileBadge'
import { ItemIcon } from './ItemIcon'
import { STATIC_MS } from '../scene/TvScreenEffect'

/** Seconds per character as a quote prints, and how long before it starts. */
export const TYPE_S = 0.045
const TYPE_DELAY_S = 0.8

function nameOf(pubkey: string, profileName: string | null | undefined): string {
  if (profileName) return profileName.toUpperCase()
  const npub = safeNpub(pubkey)
  return npub ? `${npub.slice(0, 12)}…` : `${pubkey.slice(0, 8)}…`
}

/** Seconds since the segment came on (after its static), ticking while it is up. */
function useSegmentClock(key: string): number {
  const [t, setT] = useState(0)
  useEffect(() => {
    const t0 = performance.now() + STATIC_MS
    setT(0)
    const id = window.setInterval(() => setT(Math.max(0, (performance.now() - t0) / 1000)), 40)
    return () => window.clearInterval(id)
  }, [key])
  return t
}

/**
 * A sealed comment's place in the quote: blocks the length of words, as a
 * censor's pen leaves them, the same every time for the same comment.
 */
export function redaction(id: string, length = 64): string {
  let out = ''
  let i = 0
  while (out.length < length) {
    const n = 2 + (parseInt(id.slice((i * 2) % 60, (i * 2) % 60 + 2), 16) % 8)
    out += `${'█'.repeat(n)} `
    i++
  }
  return out.trim()
}

/** What a quote prints: its words, or the redaction standing in for them. */
export function quoteOf(item: Extract<TapeItem, { kind: 'comment' }>): string {
  return item.text ?? redaction(item.id)
}

function BagInset({ item }: { item: Extract<TapeItem, { kind: 'bag' }> }): JSX.Element {
  return (
    <div className="tvseg tvseg--bag" key={item.id}>
      <div className="tvseg__stage">
        <div className="tvbag">
          {['front', 'back', 'left', 'right', 'top', 'bottom'].map((f, i) => (
            <div key={f} className={`tvbag__face tvbag__face--${f}`} style={{ ['--i' as string]: i }}>
              <ItemIcon type="key" size={52} className="tvbag__key" />
            </div>
          ))}
        </div>
      </div>
      <div className="tvseg__caption">
        <span className="tvseg__kicker">A BAG IS SEALED</span>
        <span className="tvseg__title">LOCATION SECRET</span>
        {item.height !== null && <span className="tvseg__note">A REGION 2^{item.height} GIBSONS ACROSS</span>}
      </div>
    </div>
  )
}

function ObjectSpot({ item }: { item: Extract<TapeItem, { kind: 'object' }> }): JSX.Element | null {
  const found = useMemo(() => objectsOf([item.event])[0] ?? null, [item.event])
  if (!found) return null
  return (
    <div className="tvseg tvseg--object" key={item.id}>
      <div className="tvseg__stage"><ShardSpin shard={found.shard} size={220} /></div>
      <div className="tvseg__caption">
        <span className="tvseg__kicker">NEW OBJECT</span>
        <span className="tvseg__title">{found.shard.name.toUpperCase()}</span>
      </div>
    </div>
  )
}

function AvatarSpot({ item }: { item: Extract<TapeItem, { kind: 'avatar' }> }): JSX.Element | null {
  const profile = useProfile(item.pubkey)
  const shard = useMemo(() => avatarFromEvent(item.event), [item.event])
  if (!shard) return null
  return (
    <div className="tvseg tvseg--object" key={item.id}>
      <div className="tvseg__stage"><ShardSpin shard={shard} size={220} /></div>
      <div className="tvseg__caption">
        <span className="tvseg__kicker">NEW LOOK</span>
        <span className="tvseg__title">{nameOf(item.pubkey, profile?.name)}</span>
      </div>
    </div>
  )
}

function CommentDesk({ item }: { item: Extract<TapeItem, { kind: 'comment' }> }): JSX.Element {
  const profile = useProfile(item.pubkey)
  const about = useProfile(item.about ?? undefined)
  const shard = useAvatarShard(item.pubkey)
  const t = useSegmentClock(item.id)
  const quote = quoteOf(item)
  const shown = Math.max(0, Math.min(quote.length, Math.floor((t - TYPE_DELAY_S) / TYPE_S)))
  const on = item.on === 'bag'
    ? 'ON A SEALED BAG'
    : item.about && item.about !== item.pubkey ? `ON ${nameOf(item.about, about?.name)}'S MOVE` : 'ON A MOVE'
  return (
    <div className="tvseg tvseg--comment" key={item.id}>
      <figure className="tvdesk__photo">
        {shard ? <ShardSpin shard={shard} size={180} /> : <ProfilePic pubkey={item.pubkey} size={150} />}
        <figcaption>{nameOf(item.pubkey, profile?.name)}</figcaption>
      </figure>
      <blockquote className={`tvdesk__quote${item.text === null ? ' tvdesk__quote--sealed' : ''}`}>
        <p>
          <span className="tvdesk__mark" aria-hidden>“</span>
          {quote.slice(0, shown)}
          {shown < quote.length && <span className="tvdesk__caret" aria-hidden>▌</span>}
          {shown >= quote.length && <span className="tvdesk__mark" aria-hidden>”</span>}
        </p>
        <footer>{nameOf(item.pubkey, profile?.name)} · {on}{item.text === null ? ' · SEALED TO ITS REGION' : ''}</footer>
      </blockquote>
    </div>
  )
}

/** The segment on screen, if the shot is one. */
export function TvSegment(): JSX.Element | null {
  const shot = useTv((s) => s.shot)
  const item = shot?.item
  if (!item) return null
  if (item.kind === 'bag') return item.hint ? null : <BagInset item={item} />
  if (item.kind === 'object') return <ObjectSpot item={item} />
  if (item.kind === 'avatar') return <AvatarSpot item={item} />
  if (item.kind === 'comment') return <CommentDesk item={item} />
  return null
}

/** What the chiron says a segment's author did. */
export function segmentDoing(item: TapeItem): string {
  if (item.kind === 'bag') return item.hint ? 'SEALED A BAG · HINT BOX PUBLIC' : 'SEALED A BAG'
  if (item.kind === 'object') return 'PUBLISHED AN OBJECT'
  if (item.kind === 'avatar') return 'CHANGED THEIR AVATAR'
  if (item.kind === 'reaction') return 'REACTED'
  return item.on === 'bag' ? 'COMMENTED ON A BAG' : 'COMMENTED ON A MOVE'
}
