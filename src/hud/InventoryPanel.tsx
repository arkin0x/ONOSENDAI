/**
 * InventoryPanel.tsx: ITEMS, what this identity holds (Keys and Chests B1 §3.3).
 *
 * The third of the three bag panels: HIDDEN BAGS (later), DISCOVERED BAGS
 * (opened where it stands) and this one, what you hold, kept per identity in
 * IndexedDB (store/useInventory.ts). The keypair items you hold first
 * (arkinox, 2026-10-10: "keys ARE items", so the panel is ITEMS and the
 * forged thing is an item; the TypeScript names keep saying key): each with
 * its picture when it has one (ItemFace), its name, who forged it, where it
 * was found and when, and which DISCOVERED chests it opens, computed from the
 * lock tags of chests seen. Then what was taken out of chests: coins with the
 * Cashu card and its mint state, shards with MOVE TO WORKSHOP, messages, and
 * chests, which open here as they do where they were found. COPY puts an item
 * on the clipboard as text (`cyberspace-key:` and its event) and PASTE reads
 * one back, so an item crosses devices. DELETE takes an item off this
 * identity's list after a confirmation naming it and saying what is lost
 * (arkinox, 2026-11-01: "I can't delete items"). It publishes and retracts
 * nothing, and the item can be found and TAKEN again. DELETE is only on an
 * ARCHIVED row, red, in its ACTIONS, and only the confirmation removes
 * anything (owner, 2026-11-14: "Delete should only happen after
 * confirmation from a red DELETE button in the archive item's actions. No
 * X Buttons"). Nothing under MINE or INVENTORY deletes; ARCHIVE first. An item you forged can be PUBLISHED to the ITEM FEED (a kind
 * 33340 listing, lib/itemListing.ts): its name, picture and public key, never
 * its private key, so anyone can seal a chest to it (arkinox, 2026-10-13).
 * The confirmation says it cannot be taken back. PLACE puts a new instance
 * of something you made at the build cursor, with every setting it has: an
 * item (the same key), a message or a sound, never what was found or taken
 * from someone else (arkinox, 2026-11-06; useShards placeCopyOf). ARCHIVE
 * files a row away under ARCHIVED, the second view in the KEY ITEMS or
 * OTHER LOOT modal, beside MINE or INVENTORY, and UNARCHIVE brings it back (arkinox,
 * 2026-11-06). An archived key still opens and seals what it did; DELETE of
 * the last copy of a key your chests or doors are sealed to is refused, and
 * offers ARCHIVE instead.
 *
 * Each row shows one ACTIONS button, and its actions open in a line under
 * the row (arkinox, 2026-11-12: "make a single 'Actions' button per item that
 * reveals all these actions. Right now this is too much clutter"). One row's
 * actions are open at a time; Escape or a tap outside the row closes them.
 * LISTED is said on the row's line, not as a button: it is not an action.
 *
 * The panel itself is two buttons side by side, KEY ITEMS and OTHER LOOT,
 * each with its lucide icon and opening a modal of that kind alone (owner,
 * 2026-11-14: "My list of these items is getting too long and I think we
 * need to consolidate it just like we did with the other menu panels"). The
 * rows, their ACTIONS, ARCHIVED and PASTE are in those modals (ItemsModal),
 * and KEY ITEMS also has FEED, the published key items not yet found. There
 * is no X on a row and no CLEAR ALL (owner, 2026-11-14: "I'm afraid to press
 * Clear All ... get rid of it").
 */

import { takeIntoKeeping, you } from '../lib/carried'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { create } from 'zustand'
import { ConfirmModal } from './ConfirmModal'
import { useEscape } from '../hooks/useEscape'
import { useItemFeed } from '../store/useItemFeed'
import { Key, Sparkles, type LucideIcon } from 'lucide-react'
import { useProfile } from '../hooks/useProfile'
import { cashuLabel, readCashuToken } from '../lib/cashu'
import { hasNftLink } from '../lib/nftLink'
import { ItemThumb } from './ItemThumb'
import { Copyable, HeldRowLine } from './HeldRowLine'
import { KeyListingRow } from './KeyListingRow'
import { ModalClose } from './ui/ModalClose'
import { chestsOpenedBy, heldKeypairs, isKeyItem, keyText, splitPanels, type HeldItem } from '../lib/inventory'
import { regionLabel } from '../lib/loot'
import { provenanceOf } from '../lib/provenance'
import { safeNpub } from '../lib/npub'
import { formatAgo, formatStamp } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { useInventory } from '../store/useInventory'
import { profileLabel } from '../store/useProfiles'
import { itemStillNeeded, placeCopyOf, useShards } from '../store/useShards'
import { useWorkshop } from '../store/useWorkshop'
import { MessageText } from './CashuCard'
import { AudioCard } from './AudioCard'
import { itemLineage } from '../lib/hidden'
import { Explanation } from './Explanation'
import { ChestBlock, KeyComments, Unsigned } from './ItemRows'
import { heldBagAuthor, subjectOfHeld, subjectOfWorldItem } from '../lib/commentSubjects'
import { useCashu, cashuStateLabel } from './useCashu'
import { useMutes } from '../store/useMutes'
import { hidesThing } from '../lib/muteList'
import { BlockButton, MuteItemButton } from './BlockButton'
import { searchListings } from '../lib/itemListing'
import { BackupTrouble, RelayTrouble } from './RelayTrouble'
import { Stacked, leaveModals, useModalStack } from './modalStack'

/** How a held item came to be held, in a word for the row. */
const SOURCE: Record<HeldItem['source'], string> = { forged: 'forged by you', found: 'found', taken: 'taken', pasted: 'pasted' }

/**
 * Where a held item was obtained (arkinox, 2026-10-30: "a record of where
 * the item was obtained and to View the chest where it was found or the
 * coordinate"): the chest it came out of with VIEW CHEST, or the place it
 * was found with VIEW, its coordinate to copy, and when it was taken. Each
 * VIEW frames the place as every other VIEW does. The record is this
 * identity's own inventory row (lib/provenance.ts).
 */
export function Provenance({ item }: { item: HeldItem }): JSX.Element | null {
  const p = provenanceOf(item)
  if (!p) return null
  // Out into the world: the ITEMS modal (and anything under it) closes, so it does not cover the place (modalStack).
  const view = (label: string): void => { leaveModals(); useCyberspace.getState().viewAt(p.at, p.plane, label.toUpperCase(), 0, { item: true }) }
  const where = `${regionLabel(p.height)} · ${p.plane === 0 ? 'dataspace' : 'ideaspace'}`
  return (
    <>
      {p.chest
        ? <><dt>Found in</dt><dd>chest “{p.chest.name}” <button className="chest__act" onClick={() => view(p.chest!.name)} title="Fly to the chest it came out of">VIEW CHEST</button></dd></>
        : <><dt>Found at</dt><dd>{where} <button className="chest__act" onClick={() => view(item.name)} title="Fly to where it was found">VIEW</button></dd></>}
      {p.chest && <><dt>Where</dt><dd>{where}</dd></>}
      {p.coordinate && <Copyable label="Coordinate" value={p.coordinate} title={p.coordinate} />}
      <dt>{item.source === 'forged' ? 'Forged' : 'Taken'}</dt><dd title={formatStamp(p.when)}>{formatAgo(p.when)}</dd>
    </>
  )
}

/** The PUBLISH confirmation (arkinox, 2026-10-13: "appropriate warnings about irreversibility"). */
const LISTING_WARNING = [
  'Publishing lists this item in the ITEM FEED: its name, picture, description and public key go to your relays, and anyone can then seal a chest to it.',
  '',
  'The item itself stays secret. Its private key is not published, and only people who hold the item can open what is sealed to it.',
  '',
  'This cannot be undone. You can ask relays to delete the listing later, but relays and other people may already have kept copies, and chests sealed to this item stay sealed to it. Treat it as permanent.',
].join('\n')

/** DELETE on a row no longer archived: refused, never done. */
const NOT_ARCHIVED = 'Archive it first. Only an archived item can be deleted.'

/**
 * What the DELETE confirmation says is lost, by kind (owner, 2026-11-14):
 * plain words, the money first. A Cashu coin not known to be redeemed is
 * sats; a message with an NFT claim link may be an NFT; a key item is its
 * secret key. Nothing is published or retracted by any of them.
 */
export function deleteWarning(item: Pick<HeldItem, 'type' | 'text'>, coinState?: string): string {
  const back = 'It comes back only if you find it and TAKE it again.'
  if (item.type === 'key') return `Its secret key leaves this device. COPY it first if you want a way back. ${back}`
  if (item.type === 'message' && readCashuToken(item.text ?? null).raw !== null) {
    if (coinState === 'redeemed') return `This coin is already redeemed. ${back}`
    if (coinState === 'unclaimed') return 'This coin is not redeemed. Deleting it loses the sats. Open its CARD and redeem it first.'
    return 'This coin may not be redeemed. If it is not, deleting it loses the sats. Open its CARD and check first.'
  }
  if (item.type === 'message' && hasNftLink(item.text)) return 'This message holds an NFT claim link. If you have not claimed it, deleting it loses the NFT.'
  if (item.type === 'chest') return `This chest and anything still sealed in it leave your ITEMS, coins and their sats included. ${back}`
  return `It leaves your ITEMS on this device. ${back}`
}

/** ARCHIVE, or UNARCHIVE on a row already filed away: the row moves between INVENTORY and ARCHIVED. */
export function ArchiveButton({ item }: { item: Pick<HeldItem, 'id' | 'archived'> }): JSX.Element {
  return item.archived
    ? <button className="chest__act" onClick={() => useInventory.getState().unarchive(item.id)} title="Back to MINE or INVENTORY">UNARCHIVE</button>
    : <button className="chest__act" onClick={() => useInventory.getState().archive(item.id)} title="File it away under ARCHIVED. It still opens what it opens">ARCHIVE</button>
}

/**
 * DELETE, red, and its confirmation, naming the item and saying what is lost
 * (deleteWarning). Nothing goes until DELETE FOREVER in the confirmation;
 * CANCEL, Escape or a tap outside keeps it. Drawn only on an ARCHIVED row
 * (KeyRow, TakenRow), and checked again against the store at each step,
 * so a row unarchived meanwhile is refused, never deleted. The last copy of
 * a key one of your chests or doors is sealed to is refused, naming them
 * (useShards itemStillNeeded).
 */
export function DeleteItem({ item, asking = false, coinState }: { item: Pick<HeldItem, 'id' | 'name'> & Partial<HeldItem>; asking?: boolean; coinState?: string }): JSX.Element {
  const filedAway = (): boolean => !!useInventory.getState().items[item.id]?.archived
  const [confirming, setConfirming] = useState(asking)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const ask = (): void => {
    if (!filedAway()) { setRefusal(NOT_ARCHIVED); return }
    const why = item.type && item.event ? itemStillNeeded({ id: item.id, type: item.type, key: item.key, name: item.name, event: item.event, place: item.place ?? null }, useShards.getState().mine, useInventory.getState().items, useCyberspace.getState().identity.pubkey) : null
    setRefusal(why)
    if (!why) setConfirming(true)
  }
  const remove = async (): Promise<void> => {
    if (!filedAway()) { setConfirming(false); setRefusal(NOT_ARCHIVED); return }
    setBusy(true)
    setRefusal(null)
    const gone = await useInventory.getState().remove(item.id)
    setBusy(false)
    // Gone, this row has left the list with it, or it is still drawn (another identity's row of the same id): the confirmation closes either way.
    if (gone) { setConfirming(false); return }
    setConfirming(false)
    setRefusal('Could not delete it from this device. It is still held.')
  }
  return (
    <>
      <button className="chest__act chest__act--danger" onClick={ask} title="Delete it from this device. Asks first">DELETE</button>
      {refusal && <span className="held__refusal" role="status">{refusal}</span>}
      {confirming && (
        <ConfirmModal
          title={`Delete \u201c${item.name}\u201d?`}
          body={deleteWarning({ type: item.type ?? 'key', text: item.text }, coinState)}
          confirmLabel="DELETE FOREVER"
          cancelLabel="CANCEL"
          danger
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}

/**
 * PLACE on a row of your own make (useShards placeCopyOf): a new instance at
 * the build cursor, BUILD mode coming up on it. Nothing for anything else.
 */
function PlaceButton({ item, onRefused }: { item: HeldItem; onRefused: (why: string | null) => void }): JSX.Element | null {
  const me = useCyberspace((s) => s.identity.pubkey)
  if (typeof placeCopyOf(item, me) === 'string') return null
  const place = (): void => {
    const why = useShards.getState().placeFromItems(item.id)
    onRefused(why)
    // Lined up at the build cursor: the modal goes, so the scene it is placed in is in view.
    if (!why) leaveModals()
  }
  return <button className="chest__act" onClick={place} title="Place a new instance of it at the build cursor, with every setting it has">PLACE</button>
}

/** What tapKeepsActions reads of a tapped element. */
interface Tapped { closest: (selector: string) => { classList: { contains: (name: string) => boolean } } | null }

/**
 * Whether a tap leaves row `id`'s ACTIONS open: a tap in the row, or in a
 * confirmation it opened (a modal of its own). A tap anywhere else closes
 * them, the rest of the KEY ITEMS or OTHER LOOT modal around the row included.
 */
export function tapKeepsActions(target: Tapped | null, id: string): boolean {
  if (!target) return false
  if (target.closest(`[data-actions-row="${id}"]`)) return true
  const modal = target.closest('.modal')
  return !!modal && !modal.classList.contains('items-modal')
}

/** Which row's ACTIONS are open: one at a time across ITEMS, so opening another closes the last. */
export const useOpenActions = create<{ open: string | null }>(() => ({ open: null }))

/**
 * A row's ACTIONS button and the labelled line of actions it opens under
 * the row. Closed again by its button, by Escape (before the KEY ITEMS or
 * OTHER LOOT modal it is in, being opened after it, focus going back to
 * ACTIONS), by a tap outside the row (a click, so a scroll on a phone leaves
 * it open), the rest of that modal included, never by a tap in a
 * confirmation it opened, and when the row leaves the list or stops being
 * drawn (`shown`).
 */
function useRowActions(id: string, name: string, shown = true): { button: JSX.Element; group: (acts: ReactNode) => JSX.Element | null; close: () => void } {
  const open = useOpenActions((s) => s.open === id) && shown
  const close = useCallback((): void => { if (useOpenActions.getState().open === id) useOpenActions.setState({ open: null }) }, [id])
  const gid = `held-actions-${id}`
  useEscape('modal', open, () => {
    const focused = typeof document === 'undefined' ? null : document.activeElement
    close()
    if (focused?.closest?.(`#${gid}`)) document.getElementById(`${gid}-toggle`)?.focus()
  })
  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const tap = (e: MouseEvent): void => {
      if (!tapKeepsActions(e.target instanceof Element ? e.target : null, id)) close()
    }
    document.addEventListener('click', tap, true)
    return () => document.removeEventListener('click', tap, true)
  }, [open, id, close])
  useEffect(() => close, [close])
  return {
    button: <button id={`${gid}-toggle`} className={`chest__act ${open ? 'is-on' : ''}`} onClick={() => useOpenActions.setState({ open: open ? null : id })} aria-expanded={open} aria-controls={open ? gid : undefined} aria-label={`Actions for ${name}`} title={`What you can do with ${name}`}>ACTIONS</button>,
    group: (acts) => (open ? <span className="held__menu" id={gid} role="group" aria-label={`Actions for ${name}`}>{acts}</span> : null),
    close,
  }
}

/** A held keypair item: its picture or the kind's icon, name, who forged it, where and when, what it opens, and ACTIONS: DETAILS, COMMENT, COPY, PLACE, PUBLISH, ARCHIVE, and DELETE once archived. */
function KeyRow({ item, opens }: { item: HeldItem; opens: number }): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const profile = useProfile(item.author || null)
  const who = item.author === me ? 'you' : profileLabel(profile, safeNpub(item.author))
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard?.writeText(keyText(item)).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    })
  }
  const pubkey = item.key?.itemPubkey ?? ''
  // PUBLISH TO ITEM FEED: only on an item you forged, signed as yours.
  const mine = item.author === me && item.verified && !!item.key
  useItemFeed((s) => s.listings)
  const listed = mine && useItemFeed.getState().listedBy(pubkey, me)
  const busy = useItemFeed((s) => s.publishing === pubkey)
  const [confirming, setConfirming] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const actions = useRowActions(item.id, item.name)
  // COMMENT opens the thread of the bag it was found in, the one its card there opens (lib/commentSubjects).
  // The very item standing in the world here (yours, or found here) names its card's thread itself.
  const bagAuthor = useShards((s) => heldBagAuthor(item, { discovered: s.discovered, mine: s.mine, me }))
  const standing = useShards((s) => !!s.discovered[item.id] || s.mine.some((d) => d.eventId === item.id))
  const commentSubject = useMemo(() => {
    if (item.place?.guide) return null
    const world = standing ? useShards.getState().secretByEvent(item.id) : null
    return world ? subjectOfWorldItem(world) : subjectOfHeld(item, bagAuthor)
  }, [item, bagAuthor, standing])
  const list = async (): Promise<void> => {
    if (!item.key) return
    setRefusal(null)
    const why = await useItemFeed.getState().publish(item.key)
    setConfirming(false)
    if (why) setRefusal(why)
  }
  return (
    // Laid out as an OTHER LOOT row (HeldRowLine): the picture at the Shard
    // Feed's size, the name on its own line, where and when under it, what
    // it opens and LISTED as chips, ACTIONS under the words on the right, so
    // it never squeezes the name (owner, 2026-11-15).
    <li className="secrets__row held__row held__row--item" data-actions-row={item.id}>
      <ItemThumb type="key" image={item.key?.image} model={item.key?.model} />
      <HeldRowLine
        name={item.name}
        source={item.source === 'forged' ? 'forged by you' : `forged by ${who}`}
        how={item.source === 'forged' ? 'hidden' : SOURCE[item.source]}
        at={item.at}
        chips={<>
          {opens > 0 && <span className="item__chip secrets__found" title="Discovered chests whose lock is this item">opens {opens} chest{opens === 1 ? '' : 's'}</span>}
          {listed && <span className="item__chip secrets__found" title="Listed in the ITEM FEED: anyone can seal a chest to it">LISTED</span>}
          {item.archived && <span className="item__chip item__chip--dim" title="Filed away under ARCHIVED. It still opens what it opens">ARCHIVED</span>}
          {!item.verified && <Unsigned />}
        </>}
      />
      <span className="held__acts">{actions.button}</span>
      {actions.group(
        <>
          <button className={`chest__act ${open ? 'is-on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>DETAILS</button>
          {commentSubject && <KeyComments subject={commentSubject} name={item.name} author={item.author} image={item.key?.image} />}
          <button className={`chest__act ${copied ? 'is-on' : ''}`} onClick={copy} title="Copy the item as text, to paste into ITEMS on another device">{copied ? 'COPIED' : 'COPY'}</button>
          <PlaceButton item={item} onRefused={setRefusal} />
          {mine && !listed && (
            <button className="chest__act" disabled={busy} onClick={() => setConfirming(true)} title="Publish this item to the ITEM FEED so anyone can seal a chest to it">{busy ? 'LISTING…' : 'PUBLISH'}</button>
          )}
          <ArchiveButton item={item} />
          {item.archived && <DeleteItem item={item} />}
        </>,
      )}
      {refusal && <span className="held__refusal" role="status">{refusal}</span>}
      {confirming && (
        <ConfirmModal
          title={`Publish “${item.name}” to the ITEM FEED?`}
          body={<span className="modal__pre">{LISTING_WARNING}</span>}
          confirmLabel="PUBLISH ITEM"
          cancelLabel="CANCEL"
          danger
          busy={busy}
          onConfirm={() => void list()}
          onCancel={() => setConfirming(false)}
        />
      )}
      {open && (
        <div className="held__details">
          <dl>
            <Copyable label="item" value={safeNpub(pubkey)} title={safeNpub(pubkey)} />
            <Copyable label="hex" value={pubkey} title={pubkey} />
            <dt>Forged by</dt><dd>{who}</dd>
            <Provenance item={item} />
            {item.key?.about && <><dt>About</dt><dd>{item.key.about}</dd></>}
          </dl>
        </div>
      )}
    </li>
  )
}

/**
 * The two buttons of the ITEMS panel and the modals they open (owner,
 * 2026-11-14): their words, and the lucide icon drawn before them ("Dont use
 * emojis, use appropriate lucide icons").
 */
export const KEY_ITEMS_LABEL = 'KEY ITEMS'
export const OTHER_LOOT_LABEL = 'OTHER LOOT'
export const KIND_ICON: Record<'keys' | 'loot', LucideIcon> = { keys: Key, loot: Sparkles }
/** Over the key items you hold: the second half of arkinox's heading (2026-11-09), its first half now the modal's title. */
export const KEY_ITEMS_NOTE = 'MAY UNLOCK DOORS OR CHESTS'
export const NO_KEY_ITEMS = 'No key items yet.'
export const NO_OTHER_LOOT = 'No other loot yet.'
/**
 * KEY ITEMS > FEED, in a line (owner, 2026-11-14: "a list of items that can
 * be used to lock doors and chests that have been publicly published", and
 * "make it clear in the key items feed that the user still needs to find
 * those items").
 */
export const FEED_LINE = 'Published key items. Find one to hold it, or lock a door or chest to one.'

/** A button's words: its label and how many, 0 included ("KEY ITEMS · 3"). */
export function kindLabel(label: string, count: number): string {
  return `${label} · ${count}`
}

/** How long MOVED INTO WORKSHOP stays in a row's place before the row leaves the list (arkinox, 2026-10-11). */
export const MOVED_NOTICE_MS = 5000

/**
 * A taken audio's moderation row: MUTE THIS AUDIO always (its id is its own,
 * or its lineage), BLOCK AUTHOR only when its author is a fact. A chest's
 * unsigned entry names an author it may not be (review of #465): blocking
 * that claim would block someone who never made it. Never on your own.
 */
export function takenAudioModeration(item: Pick<HeldItem, 'id' | 'author' | 'verified' | 'event'>, me: string, close: () => void): ReactNode {
  if (item.author === me) return undefined
  return (
    <>
      <MuteItemButton id={itemLineage(item.event) ?? item.id} label="MUTE THIS AUDIO" onMuted={close} />
      {item.verified && <BlockButton pubkey={item.author} onBlocked={close} />}
    </>
  )
}

/**
 * Something taken out of a chest: a coin, a shard, a message or a chest,
 * with what each can do. A shard MOVES into the workshop: the row turns
 * into MOVED INTO WORKSHOP for five seconds and then leaves the list
 * (arkinox, 2026-10-11). No X (owner, 2026-11-14): ARCHIVE is in its
 * ACTIONS, and only an archived row has DELETE, which asks first and says
 * when a coin's sats would be lost.
 */
export function TakenRow({ item }: { item: HeldItem }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [details, setDetails] = useState(false)
  const me = useCyberspace((s) => s.identity.pubkey)
  const [moved, setMoved] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const { raw, token } = readCashuToken(item.type === 'message' ? item.text : null)
  const cashu = useCashu(raw ? item.text : null)
  const coin = raw !== null
  const label = coin ? (token ? cashuLabel(token) : 'cashu token') : item.name
  // Never open behind MOVED INTO WORKSHOP, so Escape is not spent on it.
  const actions = useRowActions(item.id, label, !moved)
  // A chest's contents are listed across the whole row, under its words and ACTIONS, as DISCOVERED NEARBY lists them (ChestBlock contentsIn).
  const [contents, setContents] = useState<HTMLElement | null>(null)
  const moveToWorkshop = (): void => {
    if (!item.shard || moved) return
    actions.close()
    // Its carried parts keyed under you, so your copy keeps them when you hide it (R15).
    useWorkshop.getState().importShard(takeIntoKeeping(item.shard, you()))
    setMoved(true)
    // Held by the store, not this row: the row leaves the list even when the menu closes first.
    window.setTimeout(() => useInventory.getState().clearTaken([item.id]), MOVED_NOTICE_MS)
  }
  if (moved) {
    return (
      <li className="secrets__row held__row held__row--moved" role="status">
        <span className="held__moved">MOVED INTO WORKSHOP</span>
      </li>
    )
  }
  return (
    // Laid out as a key item row (HeldRowLine), the same picture size for every kind (owner, 2026-11-15).
    <li className="secrets__row held__row held__row--loot" data-actions-row={item.id}>
      <ItemThumb type={item.type} coin={coin} shard={item.type === 'shard' ? item.shard : undefined} />
      {item.type === 'chest' && item.chest
        ? <ChestBlock id={item.id} chest={item.chest} author={item.author} verified={item.verified} place={item.place} sealer={item.verified ? item.event.pubkey : undefined} contentsIn={contents} />
        : (
          <HeldRowLine
            name={label}
            source={item.from ? `from “${item.from.chestName}”` : SOURCE[item.source]}
            at={item.at}
            chips={<>
              {coin && <span className={`item__chip shards__cashu shards__cashu--${cashu.state}`}>{cashuStateLabel(cashu.state)}</span>}
              {item.archived && <span className="item__chip item__chip--dim" title="Filed away under ARCHIVED">ARCHIVED</span>}
              {!item.verified && <Unsigned />}
            </>}
          />
        )}
      <span className="held__acts">{actions.button}</span>
      {actions.group(
        <>
          {item.type === 'shard' && <button className="chest__act" onClick={moveToWorkshop} title="Move this model into your workshop">MOVE TO WORKSHOP</button>}
          {item.type === 'message' && <button className={`chest__act ${open ? 'is-on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{coin || hasNftLink(item.text) ? 'CARD' : 'READ'}</button>}
          {item.type === 'audio' && item.audio && <button className={`chest__act ${open ? 'is-on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Play it or save it">LISTEN</button>}
          {item.place && <button className={`chest__act ${details ? 'is-on' : ''}`} onClick={() => setDetails((d) => !d)} aria-expanded={details}>DETAILS</button>}
          <PlaceButton item={item} onRefused={setRefusal} />
          <ArchiveButton item={item} />
          {item.archived && <DeleteItem item={{ ...item, name: label }} coinState={coin ? cashu.state : undefined} />}
        </>,
      )}
      {refusal && <span className="held__refusal" role="status">{refusal}</span>}
      {details && (
        <div className="held__details">
          <dl><Provenance item={item} /></dl>
        </div>
      )}
      {open && item.type === 'audio' && item.audio && (
        <div className="held__details">
          <AudioCard
            id={`held:${item.id}`}
            triggerId={itemLineage(item.event) ?? item.id}
            audio={item.audio}
            who={{ authors: [item.author], ids: [item.id, itemLineage(item.event)] }}
            moderation={takenAudioModeration(item, me, () => setOpen(false))}
          />
        </div>
      )}
      {open && item.type === 'message' && (
        <div className="held__details">
          <MessageText text={item.text ?? ''} tags={item.event?.tags} words={(t) => <blockquote className="secret__message">{t}</blockquote>} />
        </div>
      )}
      {item.type === 'chest' && item.chest && <div className="held__contents" ref={setContents} />}
    </li>
  )
}

/** Which ITEMS modal is open: KEY ITEMS, OTHER LOOT, or neither. A store, so the tutorial or a test can open one. */
export type ItemsKind = 'keys' | 'loot'
export const useItemsModal = create<{ open: ItemsKind | null }>(() => ({ open: null }))

/** How many FEED rows are drawn at first, and how many more each time the end scrolls into view. */
export const FEED_PAGE = 100

/**
 * KEY ITEMS > FEED: the published key items (kind 33340 listings, the ITEM
 * FEED a chest or door lock picks from), read fresh when it opens, newest
 * first, searchable by name. Never your own listings, nothing by someone
 * blocked or muted, and never a key item you hold: one you have found is in
 * MINE (or ARCHIVED) only, matched by its keypair as ITEMS matches keys, so
 * a renamed or re-listed copy is still the one you hold (owner, 2026-11-14).
 * The read is one page of the relays' newest (useItemFeed); the rows are
 * drawn a hundred at a time, more as the end scrolls into view.
 */
function FeedList({ held, scroller }: { held: ReadonlySet<string>; scroller: RefObject<HTMLDivElement | null> }): JSX.Element {
  const listings = useItemFeed((s) => s.listings)
  const loading = useItemFeed((s) => s.loading)
  const trouble = useItemFeed((s) => s.trouble)
  const muted = useMutes((s) => s.muted)
  const me = useCyberspace((s) => s.identity.pubkey)
  const [q, setQ] = useState('')
  const [shownCount, setShownCount] = useState(FEED_PAGE)
  useEffect(() => { void useItemFeed.getState().load() }, [])
  const feed = useMemo(
    () => searchListings(listings, q).filter((l) => l.lister !== me && !held.has(l.itemPubkey) && !hidesThing(muted, { authors: [l.lister], ids: [l.id] }, me)),
    [listings, q, muted, me, held],
  )
  const end = useRef<HTMLLIElement | null>(null)
  useEffect(() => {
    if (!end.current || typeof IntersectionObserver === 'undefined') return
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShownCount((n) => n + FEED_PAGE)
    }, { root: scroller.current, rootMargin: '200px' })
    seen.observe(end.current)
    return () => seen.disconnect()
  }, [feed.length, shownCount, scroller])
  return (
    <>
      <input className="avatars__input" value={q} onChange={(e) => { setQ(e.target.value); setShownCount(FEED_PAGE) }} placeholder="Search items by name" aria-label="Search the feed" />
      {trouble && !loading && <RelayTrouble trouble={trouble} onRetry={() => void useItemFeed.getState().load()} />}
      {!loading && <BackupTrouble onRetry={() => void useItemFeed.getState().load()} />}
      <ul className="secrets__list held__list">
        {feed.length === 0 && !(trouble && !loading && listings.length === 0) && (
          <li className="secrets__empty">{loading ? 'Reading the item feed…' : q.trim() ? 'No listed item matches.' : 'No one else has listed a key item yet.'}</li>
        )}
        {feed.slice(0, shownCount).map((l) => <KeyListingRow key={l.itemPubkey} listing={l} held={false} />)}
        {feed.length > shownCount && <li ref={end} className="secrets__empty" aria-hidden>…</li>}
      </ul>
    </>
  )
}

/**
 * The modal a button of the panel opens, listing that kind alone
 * (lib/inventory.ts isKeyItem has the rule). Stacked (modalStack): over the
 * menu, which is there again when it closes by ✕, a tap outside or Escape;
 * a confirmation, a profile or anything else opened from a row stacks over
 * it, and Escape steps back one at a time. Its list scrolls inside it.
 *
 * KEY ITEMS has MINE, the key items you hold with their ACTIONS, PASTE
 * under them (an item copied as text is a key item), FEED, the published
 * key items you have not found (owner, 2026-11-14: "Put a mine and feed
 * button filters at the top of the key items modal"), and ARCHIVED once a
 * key item is filed away. OTHER LOOT has INVENTORY, the rest of what you
 * hold, and ARCHIVED likewise. No CLEAR ALL (owner, 2026-11-14).
 */
function ItemsModal({ kind }: { kind: ItemsKind }): JSX.Element {
  const items = useInventory((s) => s.items)
  const discovered = useShards((s) => s.discovered)
  // Nothing by someone blocked, or muted by its id, is listed (store/useMutes); never what you forged.
  const muted = useMutes((s) => s.muted)
  const me = useCyberspace((s) => s.identity.pubkey)
  const close = useCallback((): void => useItemsModal.setState({ open: null }), [])
  useModalStack(true, close)
  const { keys, taken, archived } = useMemo(
    () => splitPanels([], Object.values(items).filter((it) => !hidesThing(muted, { authors: [it.author], ids: [it.id, itemLineage(it.event)] }, me))).loot,
    [items, muted, me],
  )
  const archivedHere = useMemo(() => archived.filter((it) => isKeyItem(it) === (kind === 'keys')), [archived, kind])
  // Every keypair held, archived too, muted or not: a key item you hold is never in FEED.
  const held = useMemo(() => heldKeypairs(items), [items])
  // Which DISCOVERED chests each item opens, from the lock tags of chests seen.
  const chests = useMemo(() => Object.values(discovered).filter((h) => h.type === 'chest' && h.chest).map((h) => ({ id: h.eventId, chest: h.chest! })), [discovered])
  // Whether your forged items are already listed is read from the ITEM FEED,
  // once a session, and only when you hold something you forged.
  const forgedAny = kind === 'keys' && keys.some((k) => k.author === me && k.verified)
  useEffect(() => { if (forgedAny && useItemFeed.getState().readAt === 0) void useItemFeed.getState().load() }, [forgedAny])

  const scroller = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<'mine' | 'feed' | 'archived'>('mine')
  const showing = view === 'archived' && archivedHere.length === 0 ? 'mine' : view
  const [paste, setPaste] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const doPaste = (): void => {
    const r = useInventory.getState().paste(paste)
    setNote(r.ok ? (r.already ? `Already in your ITEMS: ${r.item?.name}.` : `Held: ${r.item?.name}.`) : r.reason ?? 'Not an item.')
    if (r.ok) setPaste('')
  }

  const rows = showing === 'archived' ? archivedHere : kind === 'keys' ? keys : taken
  const row = (it: HeldItem): JSX.Element => (isKeyItem(it) ? <KeyRow key={it.id} item={it} opens={it.key ? chestsOpenedBy(it.key, chests).length : 0} /> : <TakenRow key={it.id} item={it} />)
  const tab = (id: typeof view, label: string): JSX.Element => (
    <button className={`tag tag--tap ${showing === id ? 'is-on' : ''}`} role="tab" aria-selected={showing === id} onClick={() => setView(id)}>{label}</button>
  )
  const title = kind === 'keys' ? KEY_ITEMS_LABEL : OTHER_LOOT_LABEL
  const Icon = KIND_ICON[kind]
  return (
    <Stacked>
      <div className={`modal items-modal items-modal--${kind}`} role="dialog" aria-modal="true" aria-label={kind === 'keys' ? 'Key items' : 'Other loot'} onPointerDown={close}>
        <div className="modal__card secrets__box items-modal__card" onPointerDown={(e) => e.stopPropagation()}>
          <header className="panel__head secrets__head">
            <h2 className="items-modal__title"><Icon className="items-modal__icon" size={14} strokeWidth={2.5} aria-hidden />{title}</h2>
            <ModalClose onClose={close} />
          </header>
          {(kind === 'keys' || archivedHere.length > 0) && (
            <div className="held__views">
              <span className="held__tabs" role="tablist">
                {tab('mine', kind === 'keys' ? `MINE ${keys.length}` : `INVENTORY ${taken.length}`)}
                {kind === 'keys' && tab('feed', 'FEED')}
                {archivedHere.length > 0 && tab('archived', `ARCHIVED ${archivedHere.length}`)}
              </span>
            </div>
          )}
          <div className="items-modal__scroll" ref={scroller}>
            {showing === 'feed' ? (
              <>
                <p className="items-modal__note">{FEED_LINE}</p>
                <FeedList held={held} scroller={scroller} />
              </>
            ) : (
              <>
                {showing === 'mine' && kind === 'keys' && keys.length > 0 && <span className="legend__label">{KEY_ITEMS_NOTE}</span>}
                <ul className="secrets__list held__list">
                  {rows.length === 0 && <li className="secrets__empty">{kind === 'keys' ? NO_KEY_ITEMS : NO_OTHER_LOOT}</li>}
                  {rows.map(row)}
                </ul>
              </>
            )}
          </div>
          {kind === 'keys' && showing === 'mine' && (
            <>
              {/* An item from another device, as COPY wrote it. The prefix is the wire format and keeps its name. */}
              <form className="loot__paste" onSubmit={(e) => { e.preventDefault(); doPaste() }}>
                <input className="avatars__input" value={paste} onChange={(e) => { setPaste(e.target.value); setNote(null) }} placeholder="cyberspace-key:…" spellCheck={false} autoComplete="off" aria-label="An item as text" />
                <button className="avatars__go" type="submit" disabled={!paste.trim()} title="Hold an item copied from ITEMS on another device">PASTE</button>
              </form>
              {note && <p className="notice" role="status">{note}</p>}
            </>
          )}
        </div>
      </div>
    </Stacked>
  )
}

/**
 * ITEMS in the menu: two buttons and nothing else (owner, 2026-11-14: "I
 * want to have everything replaced with two buttons ... My list of these
 * items is getting too long"), each with how many it holds, 0 included, each
 * opening its modal (ItemsModal). Side by side, half the width each, as
 * CREATE's row of buttons is and with its classes, a lucide icon before the
 * words (owner, 2026-11-14: "buttons should be 50/50 width, same relative
 * size as CREATE menu buttons. Dont use emojis"). Archived rows are not counted, as the old chip did
 * not count them. THIS SESSION stays in the head when storage could not be
 * opened, since then nothing held outlasts the page.
 */
function KindButton({ kind, label }: { kind: ItemsKind; label: string }): JSX.Element {
  const Icon = KIND_ICON[kind]
  return (
    <button className="avatars__go shards__compose-open items-kinds__go" onClick={() => useItemsModal.setState({ open: kind })} aria-haspopup="dialog">
      <Icon className="shards__build-icon" size={13} strokeWidth={2.5} aria-hidden /><span className="items-kinds__label">{label}</span>
    </button>
  )
}

export function InventoryPanel(): JSX.Element {
  const items = useInventory((s) => s.items)
  const storage = useInventory((s) => s.storage)
  const muted = useMutes((s) => s.muted)
  const self = useCyberspace((s) => s.identity.pubkey)
  const open = useItemsModal((s) => s.open)
  // The menu unmounts this panel when it hides (an offer, a secret, a phone's BUILD): the modal goes with it, and does not come back by itself with the menu.
  useEffect(() => () => useItemsModal.setState({ open: null }), [])
  const { keys, taken } = useMemo(
    () => splitPanels([], Object.values(items).filter((it) => !hidesThing(muted, { authors: [it.author], ids: [it.id, itemLineage(it.event)] }, self))).loot,
    [items, muted, self],
  )
  return (
    <section className="panel panel--loot">
      <header className="panel__head">
        {/* ITEMS (arkinox, 2026-10-10): what you hold. The CSS classes still say loot. */}
        <h2>Items</h2>
        {storage === 'memory' && <span className="loot__tags"><span className="tag" title="IndexedDB could not be opened; what you hold lasts this session only">THIS SESSION</span></span>}
      </header>
      <div className="shards__modes items-kinds">
        <KindButton kind="keys" label={kindLabel(KEY_ITEMS_LABEL, keys.length)} />
        <KindButton kind="loot" label={kindLabel(OTHER_LOOT_LABEL, taken.length)} />
      </div>
      {open && <ItemsModal key={open} kind={open} />}
      <Explanation>Key items open doors and chests. Other loot is everything you've taken from chests.</Explanation>
    </section>
  )
}
