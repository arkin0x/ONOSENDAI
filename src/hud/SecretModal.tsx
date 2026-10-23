/**
 * SecretModal.tsx — tapping a hidden thing in the world.
 *
 * A shard or a message you found (or left) opens this: what it is, what it
 * says or looks like, who made it — with their profile — when and where, and
 * what you can do about the person: point at them, watch them, or go stand
 * where their content sits. Your own also offers to delete it, after a
 * confirmation.
 *
 * One card for everyone's things and your own (arkinox, 2026-10-20: "then
 * we can have these unified"): for a thing this device hid, the wire facts
 * that the separate wire record (DeploymentDetail) used to show, its relays,
 * the LOCAL / LIVE switch and TEST DISCOVERY, are in the event data at the
 * bottom (WireData).
 *
 * Hidden audio opens here too, with its own body (AudioCard: PLAY,
 * DOWNLOAD, RESET TRIGGER), and the creator, reactions, comments and
 * actions every item has.
 */

import { useEffect, useState } from 'react'
import { Copy, CopyPlus, Move3d, Rotate3d, Target, TvMinimal } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { regionLabel } from '../lib/loot'
import { formatAgo, formatStamp, shortHex } from '../lib/time'
import { spectate } from '../lib/spectator'
import { ProfilePic, ProfileTap } from './ProfileBadge'
import { Comments } from './Comments'
import { Reactions } from './Reactions'
import { itemKind } from '../lib/comments'
import { useProfile } from '../hooks/useProfile'
import { profileLabel } from '../store/useProfiles'
import { useCyberspace } from '../store/useCyberspace'
import { editable, useShards, type WorldItem } from '../store/useShards'
import { editPlaced } from '../store/useBuilder'
import { useWorkshop } from '../store/useWorkshop'
import { useEscape } from '../hooks/useEscape'
import { findCashuToken, textWithoutToken } from '../lib/cashu'
import { hasNftLink, textWithoutNftLinks } from '../lib/nftLink'
import { deleteWords, removeWords } from '../lib/deleteWords'
import { MessageText } from './CashuCard'
import { ChestBlock, KeyLine } from './ItemRows'
import { ConfirmModal } from './ConfirmModal'
import { ItemFace } from './ItemIcon'
import { ShardSpin } from '../scene/ShardSpin'
import { EventData } from './EventData'
import { WireData } from './WireData'
import { AudioCard } from './AudioCard'
import { BlockButton, MuteItemButton } from './BlockButton'
import { useMutes } from '../store/useMutes'

const ICON = 12

/** The id a MUTE THIS ITEM names: the lineage, else the item's own id, else (a LIVE LINK) the object's event id. */
export function muteIdOf(item: Pick<WorldItem, 'lineage' | 'key' | 'event'>): string {
  const hex = (v: string | undefined): v is string => !!v && /^[0-9a-f]{64}$/.test(v)
  return hex(item.lineage) ? item.lineage : hex(item.key) ? item.key : item.event?.id ?? ''
}

export function SecretModal(): JSX.Element | null {
  const selected = useShards((s) => s.selectedSecret)
  // Subscribed so a block or a mute re-reads the item below and closes the card.
  useMutes((s) => s.muted)
  const item = useShards((s) => (s.selectedSecret ? s.secretByEvent(s.selectedSecret) : null))
  const me = useCyberspace((s) => s.identity.pubkey)
  const targeted = useCyberspace((s) => (item?.author ? !!s.targets[item.author] : false))
  const author = item?.author ?? ''
  const profile = useProfile(author || null)
  const [copied, setCopied] = useState(false)
  // REMOVE FROM CHEST, for a thing revealed from a chest of yours: whether it
  // is working, and the sentence when it could not. Above the early return,
  // as every hook here must be.
  const [removing, setRemoving] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // The confirmation card over this modal, for DELETE or REMOVE FROM CHEST
  // (arkinox, 2026-10-10: "we need a confirmation step").
  const [confirming, setConfirming] = useState<'delete' | 'remove' | null>(null)
  // The row this device hid it as (it is among `mine`): only then are there
  // wire facts to show. Never for a thing revealed from a chest, which is in
  // the chest's sealed contents and not a bag entry of its own.
  const wire = useShards((s) => (item && !item.chestId ? s.mine.find((d) => d.eventId === item.key) ?? null : null))
  // EDIT: a shard of yours this device can move (useShards editable).
  const movable = !!wire && editable(wire, me)
  // The chest a revealed thing came out of, by name, for the card's question.
  const chestName = useShards((s) => {
    const id = item?.chestId
    if (!id) return null
    return s.mine.find((d) => d.eventId === id)?.chest?.name ?? s.discovered[id]?.chest?.name ?? null
  })

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
    const label = item.type === 'message' ? name : item.type === 'key' ? item.keyItem?.name ?? 'key' : item.type === 'chest' ? item.chest?.name ?? 'chest' : item.type === 'audio' ? item.audio?.title ?? 'audio' : item.shard?.name ?? 'shard'
    useCyberspace.getState().focusItem(item.at, item.plane, label, item.type === 'shard' ? item.shard?.unit ?? 0 : 0)
  }
  // Where it was found, for what is taken out of a chest here.
  const place = { lookupId: item.lookupId ?? '', bagId: item.bagId ?? '', at: { x: item.at.x.toString(), y: item.at.y.toString(), z: item.at.z.toString() }, plane: item.plane, height: item.height }
  const watch = (): void => { close(); void spectate(author) }
  // A message with a Cashu token in it copies only the words around the
  // token: the token has its own COPY TOKEN on the card, and a message that
  // is nothing but a token has no words, so it offers no COPY TEXT at all.
  // A nonfungible.cash claim link is the same: COPY LINK is on its card.
  const coin = item.type === 'message' && findCashuToken(item.text) !== null
  const nft = item.type === 'message' && hasNftLink(item.text)
  const words = coin || nft ? textWithoutToken(textWithoutNftLinks(item.text)) : item.text ?? ''
  // A shard copies into your workshop as a model; a message copies its text.
  const copy = (): void => {
    if (item.type === 'shard' && item.shard) useWorkshop.getState().importShard(item.shard)
    else if (words) void navigator.clipboard?.writeText(words)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }
  const target = (): void => useCyberspace.getState().toggleTarget(author, profile?.name ?? null)
  // The confirmation card's words, and what its confirm does: DELETE closes
  // this modal too and deletes; REMOVE FROM CHEST keeps it up with REMOVING…
  // until the chest is sealed again, or shows why it was not.
  const card = confirming === 'delete' ? deleteWords(item) : confirming === 'remove' ? removeWords(item, chestName) : null
  const confirmed = (): void => {
    setConfirming(null)
    if (confirming === 'delete') { close(); void useShards.getState().deleteInstance(item.key); return }
    setRemoving(true); setRefusal(null)
    void useShards.getState().removeFromChest(item.key).then((why) => { setRemoving(false); if (why) setRefusal(why); else close() }, (err: unknown) => { setRemoving(false); setRefusal(err instanceof Error ? err.message : String(err)) })
  }

  return (
    <div className="modal modal--top" role="dialog" aria-modal="true" aria-label="Hidden content" onPointerDown={close}>
      <div className="modal__card secret" onPointerDown={(e) => e.stopPropagation()}>
        <div className="secret__head">
          {/* The badge each kind of hidden thing opens under: its icon, or a
              keypair item's own picture (ItemFace), and its name. A kind 'key'
              is an ITEM to the reader (arkinox, 2026-10-10: "keys ARE items"). */}
          <span className={`secret__badge secret__badge--${coin ? 'cashu' : item.type}`}><ItemFace type={item.type} coin={coin} image={item.keyItem?.image} size={11} />{item.type === 'key' ? 'ITEM' : item.type.toUpperCase()}</span>
          {mine && <span className="secret__mine">YOURS</span>}
          <button className="secret__close" onClick={close} aria-label="Close">✕</button>
        </div>

        {item.type === 'message' ? (
          <MessageText text={item.text ?? ''} tags={item.event?.tags} words={(t) => <blockquote className="secret__message">{t}</blockquote>} />
        ) : item.type === 'key' && item.keyItem ? (
          <div className="secret__shard"><KeyLine name={item.keyItem.name} author={author} /></div>
        ) : item.type === 'chest' && item.chest ? (
          <div className="secret__shard"><ChestBlock id={item.key} chest={item.chest} author={author} verified place={place} /></div>
        ) : item.type === 'audio' && item.audio ? (
          // MUTE THIS ITEM and BLOCK (#464) are in the card's actions below, as for every item.
          <AudioCard id={item.key} triggerId={item.lineage ?? item.key} audio={item.audio} />
        ) : (
          <div className="secret__shard">
            <span className="secret__shard-name">{item.shard?.name}</span>
            <span className="secret__shard-meta">{item.shard?.vertices.length} v · {item.shard?.faces.length} f · {item.shard?.mode.toUpperCase()} · unit 2^{item.shard?.unit}</span>
          </div>
        )}

        {/* The shard itself, turning, as the avatar card shows one (arkinox,
            2026-10-13): what you tapped, seen whole, before who left it. */}
        {item.type === 'shard' && item.shard && (
          <div className="secret__spin"><ShardSpin shard={item.shard} /></div>
        )}

        <div className="secret__creator">
          <span className="secret__label">Left by</span>
          <div className="secret__person">
            <ProfileTap pubkey={author}><ProfilePic pubkey={author} size={40} /></ProfileTap>
            <div className="secret__person-text">
              <ProfileTap pubkey={author} className="secret__name">{name}{mine ? ' (you)' : ''}</ProfileTap>
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
              target={{ id: item.lineage ?? item.key, pubkey: item.target?.pubkey ?? author, kind: item.target?.kind ?? itemKind(item.type), address: item.target?.address }}
              alsoTell={[author]}
            />}

        {item.author && item.lookupId && (
          <Comments subject={{ author: item.author, lookupId: item.lookupId, itemId: item.lineage ?? item.key, type: item.type, target: item.target, at: item.at, height: item.height }} />
        )}

        {/* The actions between two rules: the comments above, the event data
            below (arkinox, 2026-10-20). */}
        <hr className="secret__rule" />

        <div className="secret__actions">
          <button className="secret__act" onClick={goTo} title="Go to it"><Rotate3d size={ICON} strokeWidth={2.25} aria-hidden />VIEW</button>
          {(item.type === 'shard' || item.type === 'message') && (!(coin || nft) || words) && (
            <button className="secret__act" onClick={copy} title={item.type === 'shard' ? 'Copy this model into your workshop' : coin ? 'Copy the words around the token' : nft ? 'Copy the words around the NFT link' : 'Copy the text'}>
              {item.type === 'shard' ? <CopyPlus size={ICON} strokeWidth={2.25} aria-hidden /> : <Copy size={ICON} strokeWidth={2.25} aria-hidden />}
              {copied ? 'COPIED' : item.type === 'shard' ? 'COPY TO WORKSHOP' : 'COPY TEXT'}
            </button>
          )}
          {!mine && (
            <>
              <button className={`secret__act ${targeted ? 'is-on' : ''}`} onClick={target}><Target size={ICON} strokeWidth={2.25} aria-hidden />{targeted ? 'TARGETED' : 'TARGET'} CREATOR</button>
              <button className="secret__act" onClick={watch}><TvMinimal size={ICON} strokeWidth={2.25} aria-hidden />SPECTATE</button>
              {/* Muted by its lineage when it has one, so a move by its hider
                  (a new id, the same d) stays muted; a LIVE LINK, whose key
                  names the bag and the entry, by the object's event id
                  (store/useMutes). */}
              <MuteItemButton id={muteIdOf(item)} onMuted={close} />
              <BlockButton pubkey={author} onBlocked={close} />
            </>
          )}
          {/* A thing revealed from a chest of yours is part of that chest's
              sealed contents, not a bag entry: it comes out by sealing the
              chest again without it (useShards removeFromChest). DELETE's
              bag rewrite could not reach it, and did nothing (arkinox,
              2026-10-10). */}
          {/* Both destructive buttons open the confirmation card below first;
              the work itself runs from the card's confirm. */}
          {/* EDIT moves it: the deploy bar comes up with the ghost on it, the
              shard itself breathing where it stands until the move lands
              (arkinox, 2026-10-16). */}
          {movable && (
            <button className="secret__act" title="Move it: aim the ghost, then deploy. The old one is taken down and its comments and reactions stay with it" onClick={() => { close(); editPlaced(item.key) }}><Move3d size={ICON} strokeWidth={2.25} aria-hidden />EDIT</button>
          )}
          {mine && !item.chestId && (
            <button
              className="secret__act secret__act--danger"
              title="Rewrite this region's bag without it, or delete the whole envelope when it is the last thing of yours there. Copies others already took stay with them. This cannot be undone."
              onClick={() => setConfirming('delete')}
            >DELETE</button>
          )}
          {mine && item.chestId && (
            <button
              className="secret__act secret__act--danger"
              disabled={removing}
              title="Open the chest, seal it again without this, and republish the bag"
              onClick={() => setConfirming('remove')}
            >{removing ? 'REMOVING…' : 'REMOVE FROM CHEST'}</button>
          )}
        </div>
        {refusal && <p className="secret__status" role="status">{refusal}</p>}

        {item.event && (
          <>
            <hr className="secret__rule" />
            <EventData event={item.event}>
              {/* Keyed by the row, so a test result never carries over to another item. */}
              {wire && <WireData key={wire.eventId} dep={wire} />}
            </EventData>
          </>
        )}

        {/* The card sits over this modal, which stays up behind it: CANCEL,
            Escape and a tap on its backdrop come back here unchanged. It is
            rendered inside this card on purpose: ConfirmModal goes to the
            body through a portal, but React still bubbles its pointer events
            up this tree, and only this card's stopPropagation keeps a tap on
            the confirmation's backdrop from reaching the close on ours.
            Escape reaches it first because it opened later (useEscape). */}
        {card && (
          <ConfirmModal
            title={card.title}
            body={card.lines.map((line) => <span key={line} className="modal__line">{line}</span>)}
            confirmLabel={confirming === 'delete' ? 'DELETE' : 'REMOVE FROM CHEST'}
            onConfirm={confirmed}
            onCancel={() => setConfirming(null)}
          />
        )}
      </div>
    </div>
  )
}
