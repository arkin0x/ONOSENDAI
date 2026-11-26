/**
 * KeyItemInfo.tsx: INFO on a key item, and the card it opens (owner,
 * 2026-11-16: "i want to be able to react to a key item too ... a full modal
 * like the shard modal. call the action button 'info'").
 *
 * Laid out as the shard's card (SecretModal ItemCard): KEY ITEM and the
 * shared ✕ on the head line, the name in the title bar, the key's model
 * turning (or its picture or icon in the chamfered frame when it wears no
 * model), its description, status chips, who left it, then the reactions
 * and the comments every surface names for it (lib/commentSubjects), so a
 * reaction or a comment from KEY ITEMS > MINE, from DISCOVERED NEARBY, from
 * an opened chest or from the item's own card in the world is in one place.
 *
 * Reactions answer what the card's reactions answer (reactionTargetOf): the
 * key item's lineage, its kind and its hider, never its bag, its bag's key or
 * its secret. A key with no thread (one a tutorial guide sealed, one pasted
 * from another device, one whose bag cannot be told) still opens here, with
 * one line saying why it has no reactions or comments.
 */

import { nameLabel } from '../lib/nameLabel'
import { useEffect, useMemo, useState } from 'react'
import { Key } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import type { NostrEvent } from '../lib/events'
import type { CommentSubject } from '../lib/comments'
import { reactionTargetOf } from '../lib/commentSubjects'
import { itemLineage, type KeyItem } from '../lib/hidden'
import { chestsOpenedBy, holdsItem } from '../lib/inventory'
import { shortHex } from '../lib/time'
import { useItemModel } from '../hooks/useItemModel'
import { useProfile } from '../hooks/useProfile'
import { CardSpin } from '../scene/CardSpin'
import { useCyberspace } from '../store/useCyberspace'
import { useInventory } from '../store/useInventory'
import { useItemFeed } from '../store/useItemFeed'
import { profileLabel } from '../store/useProfiles'
import { useShards } from '../store/useShards'
import { Comments } from './Comments'
import { ItemThumb } from './ItemThumb'
import { ProfilePic, ProfileTap } from './ProfileBadge'
import { Reactions } from './Reactions'
import { ModalClose } from './ui/ModalClose'
import { Stacked, useModalStack } from './modalStack'
import { CopyValue } from './ui/CopyValue'

/** The action's word on every key item row (owner, 2026-11-16). */
export const INFO = 'INFO'
/** The card's head. */
export const KEY_ITEM_LABEL = 'KEY ITEM'
/** Why a key a tutorial guide sealed has no thread: its bag was never on a relay, and a comment would name the guide key in public. */
export const GUIDE_NO_THREAD = 'The tutorial made this key on your device, so it has no reactions or comments.'
/** Why a key that cannot tell where it was found has none: the thread hangs on the bag it was found in. */
export const NOWHERE_NO_THREAD = 'Reactions and comments live where a key was found, and this copy does not know where that was.'
/** The chip on a key you hold, and on one you do not (yet). */
export const IN_YOUR_ITEMS = 'IN YOUR ITEMS'
export const NOT_TAKEN = 'NOT TAKEN'
/** The picture's side when the key wears no model. */
const PREVIEW_PX = 120

/** What the card shows of a key item, from wherever INFO was pressed. Nothing secret is read from it but the item's public key. */
export interface KeyInfoSource {
  /** The find's or the held row's event id, to tell whether it is held. */
  id?: string
  /** The key item's own event: its signer forged it. */
  event?: NostrEvent
  key: KeyItem
  /** Who forged it: the item event's signer. */
  forger: string
  /** Its signature checked out (or a signed chest vouched for it); otherwise who forged it is a claim. */
  verified?: boolean
  /** Who hid it: the author of the bag it was found in, when that can be told. */
  hider: string | null
  /** A tutorial guide key sealed it. */
  guide: boolean
  /** The thread every surface names for it (lib/commentSubjects), or null when it has none. */
  subject: CommentSubject | null
}

/** INFO, and the card it opens over the list it was pressed in, which is there again when it closes. */
export function KeyInfo({ info }: { info: KeyInfoSource }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={`chest__act ${open ? 'is-on' : ''}`} onClick={() => setOpen(true)} title="Who left it, what it opens, reactions and comments">{INFO}</button>
      {open && <KeyItemModal info={info} onClose={() => setOpen(false)} />}
    </>
  )
}

/** The key's model turning, as the shard's card turns a shard; until it arrives, and without one, its picture or icon in the chamfered frame. */
function Preview({ k }: { k: KeyItem }): JSX.Element {
  const loaded = useItemModel(k.model)
  if (loaded) return <div className="secret__spin"><CardSpin shard={loaded.shard} /></div>
  return <div className="secret__spin keyinfo__thumb"><ItemThumb type="key" image={k.image} size={PREVIEW_PX} /></div>
}

/** One person: picture, name, nip05, npub and bio, as the shard's card draws who left it. */
function Person({ pubkey, label, note }: { pubkey: string; label: string; note?: string }): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const profile = useProfile(pubkey || null)
  let npub = pubkey
  try { npub = nip19.npubEncode(pubkey) } catch { /* shown as hex */ }
  return (
    <div className="secret__creator">
      <span className="secret__label">{label}</span>
      <div className="secret__person">
        <ProfileTap pubkey={pubkey}><ProfilePic pubkey={pubkey} size={40} /></ProfileTap>
        <div className="secret__person-text">
          <ProfileTap pubkey={pubkey} className="secret__name">{profileLabel(profile, npub)}{pubkey === me ? ' (you)' : ''}</ProfileTap>
          {profile?.nip05 && <span className="secret__nip05">{profile.nip05.replace(/^_@/, '')}</span>}
          <CopyValue className="secret__npub" value={npub} shown={shortHex(npub, 14, 8)} />
        </div>
      </div>
      {note && <p className="keyinfo__role">{note}</p>}
      {profile?.about && <p className="secret__about">{profile.about}</p>}
    </div>
  )
}

/**
 * LEFT BY: who hid it, when the bag it was found in can be told, and whether
 * they forged it too; FORGED BY when only its forger is known (a key pasted
 * in, or one whose bag is gone); the tutorial for a key a guide sealed.
 */
function LeftBy({ info }: { info: KeyInfoSource }): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const forger = useProfile(info.forger || null)
  if (info.guide) {
    return (
      <div className="secret__creator">
        <span className="secret__label">Left by</span>
        <div className="secret__person-text"><span className="secret__name">the tutorial</span></div>
      </div>
    )
  }
  if (!info.hider) return <Person pubkey={info.forger} label="Forged by" />
  const forgerName = nameLabel(info.forger, me, forger?.name)
  const note = info.forger === info.hider ? 'Forged it and hid it.' : `Hid it. Forged by ${forgerName}.`
  return <Person pubkey={info.hider} label="Left by" note={note} />
}

/** The card: closed by ✕, a tap outside or Escape (modalStack). */
export function KeyItemModal({ info, onClose }: { info: KeyInfoSource; onClose: () => void }): JSX.Element {
  useModalStack(true, onClose)
  const { key, subject } = info
  const lineage = itemLineage(info.event)
  const held = useInventory((s) => holdsItem(s.items, info.id ?? '', lineage, info.event?.pubkey, undefined, key.itemPubkey))
  const discovered = useShards((s) => s.discovered)
  const opens = useMemo(() => chestsOpenedBy(key, Object.values(discovered).filter((h) => h.type === 'chest' && h.chest).map((h) => ({ id: h.eventId, chest: h.chest! }))).length, [key, discovered])
  // LISTED by anyone, from the ITEM FEED as read this session (read once a session, as a lock's card reads it).
  const listed = useItemFeed((s) => s.listings.some((l) => l.itemPubkey === key.itemPubkey))
  useEffect(() => { useItemFeed.getState().ensure() }, [])
  // A key a tutorial guide sealed never has a thread here, whatever a caller handed in: no event may name the guide key.
  const reaction = useMemo(() => (subject && !info.guide ? reactionTargetOf(subject) : null), [subject, info.guide])
  return (
    <Stacked>
      {/* Its pointer stays here: the list under it must not read a tap on this card as a tap outside itself. */}
      <div className="modal modal--top" role="dialog" aria-modal="true" aria-label={`Key item ${key.name}`} onPointerDown={(e) => { e.stopPropagation(); onClose() }} onClick={(e) => e.stopPropagation()}>
        <div className="modal__card secret" onPointerDown={(e) => e.stopPropagation()}>
          <div className="secret__head">
            <span className="secret__badge secret__badge--key"><Key size={11} strokeWidth={2.25} aria-hidden />{KEY_ITEM_LABEL}</span>
            <ModalClose onClose={onClose} />
          </div>
          <div className="secret__shard"><span className="secret__shard-name">{key.name}</span></div>
          <Preview k={key} />
          {key.about && <p className="keyinfo__about">{key.about}</p>}
          <span className="held__chips keyinfo__chips">
            {held
              ? <span className="item__chip secrets__found" title="It is in your ITEMS">{IN_YOUR_ITEMS}</span>
              : <span className="item__chip item__chip--dim" title="TAKE puts it in your ITEMS">{NOT_TAKEN}</span>}
            {opens > 0 && <span className="item__chip secrets__found" title="Discovered chests whose lock is this item">opens {opens} chest{opens === 1 ? '' : 's'}</span>}
            {listed && <span className="item__chip secrets__found" title="Listed in the ITEM FEED: anyone can seal a chest to it">LISTED</span>}
            {info.verified === false && <span className="item__chip item__chip--dim" title="This item carries no signature, so who forged it is a claim">UNSIGNED</span>}
          </span>
          <LeftBy info={info} />
          {subject && reaction && !info.guide ? (
            <>
              <Reactions target={reaction.target} alsoTell={reaction.alsoTell} />
              <Comments subject={subject} />
            </>
          ) : (
            <p className="comments__empty keyinfo__nothread">{info.guide ? GUIDE_NO_THREAD : NOWHERE_NO_THREAD}</p>
          )}
        </div>
      </div>
    </Stacked>
  )
}
