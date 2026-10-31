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
 * one back, so an item crosses devices. Nothing here is destructive; BURN
 * comes later. An item you forged can be PUBLISHED to the ITEM FEED (a kind
 * 33340 listing, lib/itemListing.ts): its name, picture and public key, never
 * its private key, so anyone can seal a chest to it (arkinox, 2026-10-13).
 * The confirmation says it cannot be taken back.
 */

import { takeIntoKeeping, you } from '../lib/carried'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ConfirmModal } from './ConfirmModal'
import { useItemFeed } from '../store/useItemFeed'
import { X } from 'lucide-react'
import { useProfile } from '../hooks/useProfile'
import { cashuLabel, readCashuToken } from '../lib/cashu'
import { hasNftLink } from '../lib/nftLink'
import { ItemFace, ItemIcon } from './ItemIcon'
import { ShardThumb } from './ShardThumb'
import { chestsOpenedBy, clearsWithAll, keyText, splitPanels, type HeldItem } from '../lib/inventory'
import { regionLabel } from '../lib/loot'
import { provenanceOf } from '../lib/provenance'
import { safeNpub } from '../lib/npub'
import { formatAgo, formatStamp, shortHex } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { useInventory } from '../store/useInventory'
import { profileLabel } from '../store/useProfiles'
import { useShards } from '../store/useShards'
import { useWorkshop } from '../store/useWorkshop'
import { MessageText } from './CashuCard'
import { AudioCard } from './AudioCard'
import { itemLineage } from '../lib/hidden'
import { Explanation } from './Explanation'
import { ChestBlock, Unsigned } from './ItemRows'
import { useCashu, cashuStateLabel } from './useCashu'
import { useMutes } from '../store/useMutes'
import { hidesThing } from '../lib/muteList'
import { BlockButton, MuteItemButton } from './BlockButton'

/** How a held item came to be held, in a word for the row. */
const SOURCE: Record<HeldItem['source'], string> = { forged: 'forged by you', found: 'found', taken: 'taken', pasted: 'pasted' }

function Copyable({ label, value, title }: { label: string; value: string; title: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <>
      <dt>{label}</dt>
      <dd><button className="lootd__copy" title={`${title} (click to copy)`} onClick={copy}>{copied ? 'copied' : shortHex(value, 14, 8)}</button></dd>
    </>
  )
}

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
  const view = (label: string): void => useCyberspace.getState().focusItem(p.at, p.plane, label.toUpperCase(), 0)
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

/** A held keypair item: its picture or the kind's icon, name, who forged it, where and when, what it opens, DETAILS and COPY. */
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
  const list = async (): Promise<void> => {
    if (!item.key) return
    setRefusal(null)
    const why = await useItemFeed.getState().publish(item.key)
    setConfirming(false)
    if (why) setRefusal(why)
  }
  return (
    <li className="secrets__row held__row">
      <ItemFace className="chest__glyph chest__glyph--key" type="key" image={item.key?.image} />
      <span className="item__line">
        <span className="item__name" title={item.name}>{item.name}</span>
        <span className="item__meta">
          {item.source === 'forged' ? 'forged by you' : `forged by ${who}`} · {item.source === 'forged' ? 'hidden' : SOURCE[item.source]} <span title={formatStamp(item.at)}>{formatAgo(item.at)}</span>
          {opens > 0 && <> · <span className="secrets__found" title="Discovered chests whose lock is this item">opens {opens} chest{opens === 1 ? '' : 's'}</span></>}
          {!item.verified && <> · <Unsigned /></>}
        </span>
      </span>
      <span className="held__acts">
        <button className={`chest__act ${open ? 'is-on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>DETAILS</button>
        <button className={`chest__act ${copied ? 'is-on' : ''}`} onClick={copy} title="Copy the item as text, to paste into ITEMS on another device">{copied ? 'COPIED' : 'COPY'}</button>
        {mine && (
          <button className={`chest__act ${listed ? 'is-on' : ''}`} disabled={listed || busy} onClick={() => setConfirming(true)} title={listed ? 'Listed in the ITEM FEED: anyone can seal a chest to it' : 'Publish this item to the ITEM FEED so anyone can seal a chest to it'}>{busy ? 'LISTING…' : listed ? 'LISTED' : 'PUBLISH'}</button>
        )}
      </span>
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

/** How long MOVED INTO WORKSHOP stays in a row's place before the row leaves the list (arkinox, 2026-10-11). */
export const MOVED_NOTICE_MS = 5000

/** Whether a message's text is a Cashu coin: money, so it is never cleared with the rest. */
const isCoin = (text: string | undefined): boolean => readCashuToken(text ?? null).raw !== null
/**
 * What CLEAR ALL leaves: coins, and messages holding a nonfungible.cash claim
 * link. A cleared row can never be taken again, so an unclaimed NFT swept up
 * with the rest would be out of reach for good (review of #440). An NFT row
 * keeps its own X, since whether it was claimed is never known here.
 */
const keptFromAll = (text: string | undefined): boolean => isCoin(text) || hasNftLink(text)

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
 * (arkinox, 2026-10-11). The X clears a row off the list; a coin has it
 * only once redeemed, since a cleared coin's card is out of reach.
 */
export function TakenRow({ item }: { item: HeldItem }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [details, setDetails] = useState(false)
  const me = useCyberspace((s) => s.identity.pubkey)
  const [moved, setMoved] = useState(false)
  const { raw, token } = readCashuToken(item.type === 'message' ? item.text : null)
  const cashu = useCashu(raw ? item.text : null)
  const coin = raw !== null
  const label = coin ? (token ? cashuLabel(token) : 'cashu token') : item.name
  const moveToWorkshop = (): void => {
    if (!item.shard || moved) return
    // Its carried parts keyed under you, so your copy keeps them when you hide it (R15).
    useWorkshop.getState().importShard(takeIntoKeeping(item.shard, you()))
    setMoved(true)
    // Held by the store, not this row: the row leaves the list even when the menu closes first.
    window.setTimeout(() => useInventory.getState().clearTaken([item.id]), MOVED_NOTICE_MS)
  }
  const clearable = !coin || cashu.state === 'redeemed'
  if (moved) {
    return (
      <li className="secrets__row held__row held__row--moved" role="status">
        <span className="held__moved">MOVED INTO WORKSHOP</span>
      </li>
    )
  }
  return (
    <li className="secrets__row held__row">
      {item.type === 'shard' && item.shard ? <ShardThumb shard={item.shard} /> : <ItemIcon className={`chest__glyph chest__glyph--${coin ? 'cashu' : item.type}`} type={item.type} coin={coin} />}
      {item.type === 'chest' && item.chest
        ? <ChestBlock id={item.id} chest={item.chest} author={item.author} verified={item.verified} place={item.place} sealer={item.verified ? item.event.pubkey : undefined} />
        : (
          <span className="item__line">
            <span className="item__name" title={label}>{label}</span>
            <span className="item__meta">
              {item.from ? `from “${item.from.chestName}”` : SOURCE[item.source]} · <span title={formatStamp(item.at)}>{formatAgo(item.at)}</span>
              {coin && <> · <span className={`shards__cashu shards__cashu--${cashu.state}`}>{cashuStateLabel(cashu.state)}</span></>}
              {!item.verified && <> · <Unsigned /></>}
            </span>
          </span>
        )}
      <span className="held__acts">
        {item.type === 'shard' && <button className="chest__act" onClick={moveToWorkshop} title="Move this model into your workshop">MOVE TO WORKSHOP</button>}
        {item.type === 'message' && <button className={`chest__act ${open ? 'is-on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{coin || hasNftLink(item.text) ? 'CARD' : 'READ'}</button>}
        {item.type === 'audio' && item.audio && <button className={`chest__act ${open ? 'is-on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Play it or save it">LISTEN</button>}
        {item.place && <button className={`chest__act ${details ? 'is-on' : ''}`} onClick={() => setDetails((d) => !d)} aria-expanded={details}>DETAILS</button>}
        {clearable && (
          <button className="held__clear" onClick={() => useInventory.getState().clearTaken([item.id])} title="Clear it from TAKEN" aria-label={`Clear ${label} from TAKEN`}>
            <X size={14} aria-hidden />
          </button>
        )}
      </span>
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
    </li>
  )
}

export function InventoryPanel(): JSX.Element {
  const items = useInventory((s) => s.items)
  const storage = useInventory((s) => s.storage)
  const discovered = useShards((s) => s.discovered)
  // Nothing by someone blocked, or muted by its id, is listed (store/useMutes); never what you forged.
  const muted = useMutes((s) => s.muted)
  const self = useCyberspace((s) => s.identity.pubkey)
  const { keys, taken } = useMemo(
    () => splitPanels([], Object.values(items).filter((it) => !hidesThing(muted, { authors: [it.author], ids: [it.id, itemLineage(it.event)] }, self))).loot,
    [items, muted, self],
  )
  // Which DISCOVERED chests each item opens, from the lock tags of chests seen.
  const chests = useMemo(() => Object.values(discovered).filter((h) => h.type === 'chest' && h.chest).map((h) => ({ id: h.eventId, chest: h.chest! })), [discovered])
  const [paste, setPaste] = useState('')
  const [note, setNote] = useState<string | null>(null)
  // Whether your forged items are already listed is read from the ITEM FEED,
  // once a session, and only when you hold something you forged.
  const me = useCyberspace((s) => s.identity.pubkey)
  const forgedAny = keys.some((k) => k.author === me && k.verified)
  useEffect(() => { if (forgedAny && useItemFeed.getState().readAt === 0) void useItemFeed.getState().load() }, [forgedAny])
  const doPaste = (): void => {
    const r = useInventory.getState().paste(paste)
    setNote(r.ok ? (r.already ? `Already in your ITEMS: ${r.item?.name}.` : `Held: ${r.item?.name}.`) : r.reason ?? 'Not an item.')
    if (r.ok) setPaste('')
  }
  const count = keys.length + taken.length

  return (
    <section className="panel panel--loot">
      <header className="panel__head">
        {/* ITEMS (arkinox, 2026-10-10): what you hold. The CSS classes still say loot. */}
        <h2>Items</h2>
        <span className="loot__tags">
          {storage === 'memory' && <span className="tag" title="IndexedDB could not be opened; what you hold lasts this session only">THIS SESSION</span>}
          <span className="tag">{count === 0 ? 'NOTHING HELD' : `${keys.length} ITEM${keys.length === 1 ? '' : 'S'}${taken.length > 0 ? ` · ${taken.length} TAKEN` : ''}`}</span>
        </span>
      </header>

      {/* Two sections, so each keeps its heading: the keypair items you hold,
          then what was taken out of chests. */}
      {keys.length > 0 && (
        <div className="shards__section">
          <span className="legend__label">Items you hold</span>
          <ul className="secrets__list held__list">
            {keys.map((k) => <KeyRow key={k.id} item={k} opens={k.key ? chestsOpenedBy(k.key, chests).length : 0} />)}
          </ul>
        </div>
      )}

      {taken.length > 0 && (
        <div className="shards__section">
          <span className="held__takenhead">
            <span className="legend__label">Taken</span>
            <button className="tag tag--tap" onClick={() => useInventory.getState().clearTaken(taken.filter((t) => clearsWithAll(t, keptFromAll)).map((t) => t.id))} title="Clear everything from TAKEN except coins and NFT links, which are cleared one at a time">CLEAR ALL</button>
          </span>
          <ul className="secrets__list held__list">
            {taken.map((t) => <TakenRow key={t.id} item={t} />)}
          </ul>
        </div>
      )}

      {count === 0 && <p className="avatars__empty">Nothing held yet.</p>}

      {/* An item from another device, as COPY wrote it. The prefix is the wire format and keeps its name. */}
      <form className="loot__paste" onSubmit={(e) => { e.preventDefault(); doPaste() }}>
        <input className="avatars__input" value={paste} onChange={(e) => { setPaste(e.target.value); setNote(null) }} placeholder="cyberspace-key:…" spellCheck={false} autoComplete="off" aria-label="An item as text" />
        <button className="avatars__go" type="submit" disabled={!paste.trim()} title="Hold an item copied from ITEMS on another device">PASTE</button>
      </form>
      {note && <p className="notice" role="status">{note}</p>}

      <Explanation>
        What you hold: items you took or forged, and what you took out of
        chests. A chest sealed to one of these items opens with OPEN where it
        is found, in DISCOVERED BAGS. Kept on this device per identity; COPY
        and PASTE carry an item to another device as text.
      </Explanation>
    </section>
  )
}
