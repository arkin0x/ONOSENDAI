/**
 * SecretModal.tsx — tapping a hidden thing in the world.
 *
 * A shard or a message you found (or left) opens this: what it is, what it
 * says or looks like, who made it — with their profile — when and where, and
 * what you can do about the person: point at them, watch them, or go stand
 * where their content sits. Your own also offers to delete it.
 *
 * This is the "who is this and what do I do about them" view. The Stash panel's
 * deployment detail is the "manage my own on the wire" view; the two are
 * reached differently and answer different questions.
 */

import { useEffect, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { regionLabel } from '../lib/loot'
import { formatAgo, formatStamp, shortHex } from '../lib/time'
import { spectate } from '../lib/spectator'
import { ProfilePic } from './ProfileBadge'
import { Comments } from './Comments'
import { Reactions } from './Reactions'
import { itemKind } from '../lib/comments'
import { useProfile } from '../hooks/useProfile'
import { profileLabel } from '../store/useProfiles'
import { useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { useWorkshop } from '../store/useWorkshop'
import { useEscape } from '../hooks/useEscape'
import { findCashuToken, textWithoutToken } from '../lib/cashu'
import { MessageText } from './CashuCard'

export function SecretModal(): JSX.Element | null {
  const selected = useShards((s) => s.selectedSecret)
  const item = useShards((s) => (s.selectedSecret ? s.secretByEvent(s.selectedSecret) : null))
  const me = useCyberspace((s) => s.identity.pubkey)
  const targeted = useCyberspace((s) => (item?.author ? !!s.targets[item.author] : false))
  const author = item?.author ?? ''
  const profile = useProfile(author || null)
  const [copied, setCopied] = useState(false)

  // A selection that no longer resolves (deleted, scrolled out) closes itself.
  useEffect(() => { if (selected && !item) useShards.getState().selectSecret(null) }, [selected, item])
  // Escape closes it as a tap outside does (arkinox, 2026-10-01).
  useEscape('modal', item !== null && author !== '', () => useShards.getState().selectSecret(null))

  if (!item || !author) return null

  const npub = nip19.npubEncode(author)
  const name = profileLabel(profile, npub)
  const mine = item.author === me
  const close = (): void => useShards.getState().selectSecret(null)

  const goTo = (): void => {
    close()
    useCyberspace.getState().focusItem(item.at, item.plane, item.type === 'message' ? name : item.shard?.name ?? 'shard', item.type === 'shard' ? item.shard?.unit ?? 0 : 0)
  }
  const watch = (): void => { close(); void spectate(author) }
  // A message with a Cashu token in it copies only the words around the
  // token: the token has its own COPY TOKEN on the card, and a message that
  // is nothing but a token has no words, so it offers no COPY TEXT at all.
  const coin = item.type === 'message' && findCashuToken(item.text) !== null
  const words = coin ? textWithoutToken(item.text) : item.text ?? ''
  // A shard copies into your Stash as a model; a message copies its text.
  const copy = (): void => {
    if (item.type === 'shard' && item.shard) useWorkshop.getState().importShard(item.shard)
    else if (words) void navigator.clipboard?.writeText(words)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }
  const target = (): void => useCyberspace.getState().toggleTarget(author, profile?.name ?? null)

  return (
    <div className="modal modal--top" role="dialog" aria-modal="true" aria-label="Hidden content" onPointerDown={close}>
      <div className="modal__card secret" onPointerDown={(e) => e.stopPropagation()}>
        <div className="secret__head">
          <span className={`secret__badge secret__badge--${item.type}`}>{item.type === 'message' ? '✎ MESSAGE' : '◇ SHARD'}</span>
          {mine && <span className="secret__mine">YOURS</span>}
          <button className="secret__close" onClick={close} aria-label="Close">✕</button>
        </div>

        {item.type === 'message' ? (
          <MessageText text={item.text ?? ''} words={(t) => <blockquote className="secret__message">{t}</blockquote>} />
        ) : (
          <div className="secret__shard">
            <span className="secret__shard-name">{item.shard?.name}</span>
            <span className="secret__shard-meta">{item.shard?.vertices.length} v · {item.shard?.faces.length} f · {item.shard?.mode.toUpperCase()} · unit 2^{item.shard?.unit}</span>
          </div>
        )}

        <div className="secret__creator">
          <span className="secret__label">Left by</span>
          <div className="secret__person">
            <ProfilePic pubkey={author} size={40} />
            <div className="secret__person-text">
              <span className="secret__name">{name}{mine ? ' (you)' : ''}</span>
              {profile?.nip05 && <span className="secret__nip05">{profile.nip05.replace(/^_@/, '')}</span>}
              <span className="secret__npub" title={npub}>{shortHex(npub, 14, 8)}</span>
            </div>
          </div>
          {profile?.about && <p className="secret__about">{profile.about}</p>}
        </div>

        <dl className="secret__facts">
          <div><dt>Placed</dt><dd title={item.createdAt ? formatStamp(item.createdAt) : ''}>{item.createdAt ? formatAgo(item.createdAt) : 'unknown'}</dd></div>
          <div><dt>Region</dt><dd>{regionLabel(item.height)}</dd></div>
          <div><dt>Plane</dt><dd>{item.plane === 0 ? 'dataspace' : 'ideaspace'}</dd></div>
        </dl>

        {/* Reactions carry no words, only the item's id, so they need no seal
            (arkinox, 2026-09-28): the item's author and the hider are told. */}
        {/* A LIVE LINK (a public object, yours or another author's) is reacted to as that
            object alone: its author is told, the hider and the bag are not
            named (isForeignItem). */}
        {item.target?.id && item.target.public
          ? <Reactions target={{ id: item.target.id, pubkey: item.target.pubkey, kind: item.target.kind, address: item.target.address }} />
          : <Reactions
              target={{ id: item.key, pubkey: item.target?.pubkey ?? author, kind: item.target?.kind ?? itemKind(item.type) }}
              alsoTell={[author]}
            />}

        {item.author && item.lookupId && (
          <Comments subject={{ author: item.author, lookupId: item.lookupId, itemId: item.key, type: item.type, target: item.target, at: item.at, height: item.height }} />
        )}

        <div className="secret__actions">
          <button className="secret__act" onClick={goTo}>GO TO IT</button>
          {(!coin || words) && (
            <button className="secret__act" onClick={copy} title={item.type === 'shard' ? 'Copy this model into your Stash' : coin ? 'Copy the words around the token' : 'Copy the text'}>
              {copied ? 'COPIED' : item.type === 'shard' ? 'COPY TO STASH' : 'COPY TEXT'}
            </button>
          )}
          {!mine && (
            <>
              <button className={`secret__act ${targeted ? 'is-on' : ''}`} onClick={target}>{targeted ? 'TARGETED' : 'TARGET'} CREATOR</button>
              <button className="secret__act" onClick={watch}>SPECTATE</button>
            </>
          )}
          {mine && (
            <button className="secret__act secret__act--danger" onClick={() => { close(); void useShards.getState().deleteInstance(item.key) }}>DELETE</button>
          )}
        </div>
      </div>
    </div>
  )
}
