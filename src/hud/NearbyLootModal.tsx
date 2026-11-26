/**
 * NearbyLootModal.tsx — what has been decrypted where you stand.
 *
 * The green box is the region your keys open; this is the list of what is in
 * it: every shard, message, key and chest this client has opened or placed
 * whose region holds the anchor, newest first (arkinox, 2026-10-13), nearest
 * first among things made in the same second, undated things last. Reached from the found chip,
 * which says how many, and from NEARBY on the DISCOVERED panel. VIEW flies to
 * the thing the way the bag record's VIEW does. A key row has TAKE until it
 * is held, and INFO (KeyItemInfo); a chest row has its OPEN, and a door row its OPEN or CLOSE, beside
 * VIEW and the same size, VIEW on the right (arkinox, 2026-11-12). A seed's
 * row names its DNA, how far it has grown and who planted it; its name opens
 * its card (BloomCard) over the list and its VIEW frames the bloom at the seed's scale
 * (arkinox, 2026-11-13: "we need to add seeds to this modal").
 * Every row has INFO beside VIEW, the owner's word for an item's card
 * (KeyItemInfo, 2026-11-16): it opens the same card a tap on the thing in
 * the world opens (SecretModal), so a thing that cannot be tapped there, a
 * shard that is only fog, glow or points, still has its card, its reactions,
 * its comments and its owner's actions (arkinox, 2026-11-22: "I can't tap on
 * a shard when it's only fog. I should be able to trigger its modal from the
 * Nearby modal"). A key row's INFO is its key card, as before.
 * Tabs sort the list by kind, ITEMS first (lib/nearbyTabs.ts); every opening
 * starts on the first tab, left to right, with anything in it (arkinox,
 * 2026-11-01), and RETURN from a VIEW comes back to the tab it left.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNearbyLoot, type NearbyItem } from '../hooks/useNearbyLoot'
import { useProfile } from '../hooks/useProfile'
import { findCashuToken } from '../lib/cashu'
import { hiddenLabel, messagePreview } from '../lib/hidden'
import { ItemThumb } from './ItemThumb'
import type { HeldPlace } from '../lib/inventory'
import { safeNpub } from '../lib/npub'
import { formatDistance } from 'sno-core/scale'
import { useCyberspace } from '../store/useCyberspace'
import { profileLabel } from '../store/useProfiles'
import { useShards } from '../store/useShards'
import { rememberNearbyReturn } from '../lib/nearbyReturn'
import { ProfileTap } from './ProfileBadge'
import { ChestBlock, KeyLine, listedOnce, useChestOpen } from './ItemRows'
import { isGuideKey, subjectOfWorldItem } from '../lib/commentSubjects'
import { KeyInfo, type KeyInfoSource } from './KeyItemInfo'
import { useModalStack } from './modalStack'
import { NEARBY_TABS, byTab, firstFilledTab, type NearbyTab } from '../lib/nearbyTabs'
import { lockWord, useOpenedChests } from '../store/useOpenedChests'
import { GoArrow } from './ui/GoArrow'
import { useBlooms, wantSeeds } from '../store/useBlooms'
import { seedOfEvent, viewScaleOf, type SeedItem } from '../lib/seeds/seedItem'
import { bloomGrowthWords } from '../lib/seeds/bloomWords'
import { ModalClose } from './ui/ModalClose'
import { INFO } from './KeyItemInfo'
import { LocateFixed, Navigation2 } from 'lucide-react'
import type { CSSProperties } from 'react'
import { authorColour } from '../lib/authorColour'
import { sealInitial } from '../lib/letterReveal'
import { readId } from '../lib/messagesRead'
import { blockWords, sealedBlock } from '../lib/sealedAt'
import { formatAgo } from '../lib/time'
import { trustedTip } from '../lib/seeds/seedSources'
import { directionFromView } from '../lib/viewPose'
import { itemCentre } from '../lib/space'
import { alignedOrigin } from '../store/useCyberspace'
import { useHyperspace } from '../store/useHyperspace'
import { sealBroken, useMessagesRead } from '../store/useMessagesRead'
import { useWaveforms } from '../store/useWaveforms'
import { clockWords } from '../lib/waveform'

/**
 * INFO on a row: the thing's own card, the one a tap on it in the world opens
 * (SecretModal), over this list, which is there again when the card closes,
 * as a key's INFO card is (modalStack.tsx). An action on the card that goes
 * out into the world (VIEW, SPECTATE) closes both.
 */
export function openCard(item: Pick<NearbyItem, 'key'>): void {
  useShards.getState().selectSecret(item.key)
}

/** A row's INFO, beside VIEW and the same size: the thing's card (openCard). */
function CardButton({ item }: { item: NearbyItem }): JSX.Element {
  return <button className="chest__act nearby__info" onClick={() => openCard(item)} title="Who left it, reactions and comments">{INFO}</button>
}

/** Where a nearby item was found, for what is taken out of a chest here. */
function placeOf(item: NearbyItem): HeldPlace {
  return { lookupId: item.lookupId ?? '', bagId: item.bagId ?? '', at: { x: item.at.x.toString(), y: item.at.y.toString(), z: item.at.z.toString() }, plane: item.plane, height: item.height, ...(item.author ? { author: item.author } : {}) }
}

/** A seed row's seed, read once per event (the list re-renders as blooms grow). */
function seedOf(item: NearbyItem): SeedItem | null {
  return item.type === 'seed' && item.event ? seedOfEvent(item.event) : null
}

/** A seed's name: its DNA's `dna` name once resolved (store/useBlooms). */
function seedName(dna: { name: string } | undefined): string {
  return dna?.name ?? 'unknown DNA'
}

/** How far away, as every row says it. */
function distanceWords(d: bigint): string {
  return d === 0n ? 'right here' : `${formatDistance(d)} away`
}

/** The first line: the message itself, the shard named in quotes with its size, the key's or chest's name; for a seed, what VIEW names it: its DNA, else its own title, else "seed", as the card heads it. */
function labelOf(item: NearbyItem): string {
  if (item.type === 'seed') { const seed = seedOf(item); return (seed && useBlooms.getState().views[seed.id]?.dna?.name) || seed?.title || 'seed' }
  if (item.type === 'message') return findCashuToken(item.text) ? 'cashu token' : messagePreview(item.text ?? '', 160)
  if (item.type !== 'shard') return hiddenLabel({ ...item, key: item.keyItem })
  const shard = item.shard
  return shard ? `\u201c${shard.name}\u201d shard \u00b7 ${shard.vertices.length} vertices \u00b7 ${shard.faces.length} faces` : 'shard'
}

/**
 * When it was sealed, in plain words (shared piece "Time as a block"):
 * "sealed at block 975,410", reckoned from the newest block known
 * (lib/sealedAt.ts), or how long ago before a block is known. It replaced
 * "Ideaspace, height 6", which was protocol talk (owner, 2026-11-26).
 */
function whenOf(item: NearbyItem, tip: number | null, verb = 'sealed'): string {
  if (!item.createdAt) return ''
  const block = sealedBlock(item.createdAt, tip, Date.now() / 1000)
  return block === null ? `${verb} ${formatAgo(item.createdAt)}` : `${verb} at block ${blockWords(block)}`
}

/** The newest block this client knows, for when a row's thing was sealed. */
function useTip(): number | null {
  return useHyperspace((s) => s.tipHeight) ?? trustedTip()
}

/**
 * Which way it is from where you are looking, and how far (shared piece
 * "Distance and direction"): an arrow turned toward it and plain words,
 * "Up and to the left · 466 pm away"; "Right here" for a thing in your own cell.
 */
function WhichWay({ item }: { item: NearbyItem }): JSX.Element {
  if (item.distance === 0n) {
    return <span className="nearby__way"><LocateFixed size={11} strokeWidth={2.25} aria-hidden />Right here</span>
  }
  const cs = useCyberspace.getState()
  const centre = itemCentre(item.at, alignedOrigin(cs.anchor, cs.scaleExp), cs.scaleExp, cs.axes())
  const dir = directionFromView(centre)
  const style = { transform: `rotate(${dir?.deg ?? 0}deg)` } as CSSProperties
  return (
    <span className="nearby__way">
      {dir && <Navigation2 className="nearby__arrow" size={11} strokeWidth={2.25} fill="currentColor" style={style} aria-hidden />}
      {dir ? `${dir.words} · ${distanceWords(item.distance)}` : distanceWords(item.distance)}
    </span>
  )
}

/** LOCKED, OPEN or CLOSED (closed with CLOSE, opens again with no key), as the world draws it (store/useOpenedChests lockWord). */
function LockStatus({ id, lock, me }: { id: string; lock: string; me: string }): JSX.Element {
  useOpenedChests((s) => s.opened)
  const word = lockWord(me, id, lock)
  return <span className={`nearby__lock nearby__lock--${word.toLowerCase()}`}>{word}</span>
}

export function Row({ item, me, onView }: { item: NearbyItem; me: string; onView: (item: NearbyItem) => void }): JSX.Element {
  const profile = useProfile(item.author ?? null)
  const author = item.author ?? ''
  const name = author === me ? 'you' : profileLabel(profile, safeNpub(author))
  const tip = useTip()
  // A message's seal: whole until this identity has opened it (store/useMessagesRead, per npub); your own are read.
  const broken = useMessagesRead((s) => sealBroken(s, readId(item), author === me))
  const length = useWaveforms((s) => (item.type === 'audio' && item.audio?.hash ? s.waves[item.audio.hash]?.duration ?? 0 : 0))
  // A chest's OPEN, a door's OPEN or CLOSE, and a key's TAKE are drawn here,
  // beside VIEW and the same size (ItemRows ChestBlock and KeyLine actionsIn;
  // tutorial feedback 2026-11-12, item 2), under the words, so they never
  // squeeze the name (owner, 2026-11-15). What an open chest holds is listed
  // across the whole row under them (contentsIn), each with its TAKE, then
  // TAKE ALL.
  const [acts, setActs] = useState<HTMLElement | null>(null)
  const [contents, setContents] = useState<HTMLElement | null>(null)
  const chest = item.type === 'chest' && !!item.chest
  const key = item.type === 'key' && !!item.keyItem
  const coin = item.type === 'message' && findCashuToken(item.text) !== null
  // A key item's INFO, before and after TAKE: who hid it, and the thread its card opens (lib/commentSubjects).
  // Revealed from a chest unsigned: who forged it is a claim (Hidden `claim`), said on the card as UNSIGNED.
  const claim = useShards((s) => !!s.discovered[item.key]?.claim)
  const info = useMemo((): KeyInfoSource | null => (key && item.keyItem
    ? { id: item.key, event: item.event, key: item.keyItem, forger: item.event?.pubkey ?? author, verified: !claim, hider: author || null, guide: isGuideKey(author), subject: subjectOfWorldItem(item) }
    : null), [key, item, author, claim])
  // A message (not a coin) and a sound read as two lines of words, as their cards do (direction 6 and 7).
  const letter = item.type === 'message' && !coin
  const sound = item.type === 'audio' && !!item.audio
  const words = sound && item.audio ? [item.audio.title, item.audio.about].filter(Boolean).join(' · ') : labelOf(item)
  const when = whenOf(item, tip)
  return (
    <li className="secrets__row nearby__row">
      <ItemThumb
        type={item.type}
        coin={coin}
        shard={item.type === 'shard' ? item.shard : undefined}
        image={item.keyItem?.image}
        model={item.keyItem?.model}
        letter={letter ? { colour: authorColour(author), initial: sealInitial(profile?.name, safeNpub(author)), broken } : undefined}
        audio={sound ? { hash: item.audio?.hash || item.key } : undefined}
      />
      <div className="nearby__body">
        {key && item.keyItem
          ? <KeyLine id={item.key} name={item.keyItem.name} author={author} actionsIn={acts} />
          : chest && item.chest
            ? <ChestBlock id={item.key} chest={item.chest} author={author} verified place={placeOf(item)} actionsIn={acts} contentsIn={contents} />
            : letter || sound
              ? <span className="nearby__label nearby__label--two" title={words}>{words}</span>
              : <span className="nearby__label" title={labelOf(item)}>{labelOf(item)}</span>}
        <span className="nearby__meta" style={{ '--author': authorColour(author) } as CSSProperties}>
          {letter && !broken && <span className="nearby__unread">UNREAD</span>}
          {/* The dot and the name together are the tap for their profile: a fingertip's worth, not an 8px dot. */}
          {author ? <ProfileTap pubkey={author} className="nearby__dot"><i className="authordot" aria-hidden="true" /><span className="nearby__who">{name}</span></ProfileTap> : <span className="nearby__who">{name}</span>}
          {sound && length > 0 && <span className="nearby__far">· {clockWords(length)}</span>}
          {when && <span className="nearby__when" title={item.createdAt ? formatAgo(item.createdAt) : undefined}>· {when}</span>}
        </span>
        <WhichWay item={item} />
        {chest && item.chest && <span className="held__chips"><LockStatus id={item.key} lock={item.chest.lockPubkey} me={me} /></span>}
      </div>
      <span className="nearby__acts">
        {(chest || key) && <span className="nearby__door" ref={setActs} />}
        {info ? <KeyInfo info={info} /> : <CardButton item={item} />}
        <button className="avatars__go nearby__view" onClick={() => onView(item)} title="Fly to it">VIEW<GoArrow /></button>
      </span>
      {chest && <div className="nearby__contents" ref={setContents} />}
    </li>
  )
}

/**
 * A seed's row: its DNA's name, which opens the seed's card (BloomCard, in
 * the hidden-thing card) over this list; where it is and how far it
 * has grown, on the clock the card reads; who planted it (the seed's signer)
 * and how far; and VIEW. Its picture is the bloom as grown here, the seed's
 * glyph until then.
 */
export function SeedRow({ item, me, onView }: { item: NearbyItem; me: string; onView: (item: NearbyItem) => void }): JSX.Element {
  const seed = seedOf(item)
  const view = useBlooms((s) => (seed ? s.views[seed.id] : undefined))
  const planter = seed?.planter ?? item.author ?? ''
  const profile = useProfile(planter || null)
  const name = planter === me ? 'you' : profileLabel(profile, safeNpub(planter))
  const when = whenOf(item, useTip(), 'planted')
  const card = (): void => openCard(item)
  return (
    <li className="secrets__row nearby__row">
      <ItemThumb type="seed" shard={view?.shard} />
      {/* The whole of its words is the tap, a fingertip's worth on a phone (review of #701). */}
      <button className="nearby__body nearby__name" onClick={card} title="Open its card">
        <span className="nearby__label">{seedName(view?.dna)}</span>
        <span className="nearby__where">{bloomGrowthWords(view)}</span>
        <span className="nearby__meta" style={{ '--author': authorColour(planter) } as CSSProperties}>
          {planter ? <ProfileTap pubkey={planter} nested className="nearby__dot"><i className="authordot" aria-hidden="true" /><span className="nearby__who">{name}</span></ProfileTap> : <span className="nearby__who">{name}</span>}
          {when && <span className="nearby__when">· {when}</span>}
        </span>
        <WhichWay item={item} />
      </button>
      <span className="nearby__acts">
        <CardButton item={item} />
        <button className="avatars__go nearby__view" onClick={() => onView(item)} title="Fly to it">VIEW<GoArrow /></button>
      </span>
    </li>
  )
}

/** The tab a VIEW left, for the list RETURN reopens. */
let viewedTab: NearbyTab | null = null

/** The tabs: each with its count, an empty one dimmed and still there. */
export function NearbyTabs({ tab, counts, onTab }: { tab: NearbyTab; counts: Record<NearbyTab, number>; onTab: (t: NearbyTab) => void }): JSX.Element {
  return (
    <div className="nearby__tabs" role="tablist" aria-label="Kinds found">
      {NEARBY_TABS.map(({ id, label }) => (
        <button key={id} role="tab" aria-selected={tab === id} className={`nearby__tab${tab === id ? ' is-on' : ''}${counts[id] === 0 ? ' is-empty' : ''}`} onClick={() => onTab(id)}>
          <span>{label}</span>
          <span className="nearby__count">{counts[id]}</span>
        </button>
      ))}
    </div>
  )
}

export function NearbyLootModal(): JSX.Element | null {
  const open = useShards((s) => s.nearbyOpen)
  // Escape closes it as a tap outside does (arkinox, 2026-10-01); a card
  // opened from it (INFO) stacks over it, so Escape closes that first, and an
  // action that leaves for the world closes the list too (modalStack.tsx).
  useModalStack(open, () => useShards.getState().setNearbyOpen(false))
  return open ? <NearbyList /> : null
}

/** Mounted only while the list is open, so each opening picks its tab afresh. */
export function NearbyList(): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const items = useNearbyLoot()
  const chestOpen = useChestOpen()
  // Newest first; sort is stable, so the hook's nearest-first order breaks
  // ties. A thing that came out of a chest open in this list is listed under
  // that chest, with its TAKE, and not again on its own (review of #519).
  const list = useMemo(() => listedOnce(items, (i) => i.key, chestOpen).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)), [items, chestOpen])
  const tabs = useMemo(() => byTab(list), [list])
  const counts: Record<NearbyTab, number> = { items: tabs.items.length, shards: tabs.shards.length, sounds: tabs.sounds.length, chests: tabs.chests.length, doors: tabs.doors.length, messages: tabs.messages.length, seeds: tabs.seeds.length }
  // The tab a VIEW left, or the first with anything in it.
  const [tab, setTab] = useState<NearbyTab>(() => viewedTab ?? firstFilledTab(counts))
  useEffect(() => { viewedTab = null }, [])
  // The seeds listed grow for their rows, as one opened from a list grows for
  // its card (BloomCard): most are already growing for the world. Only as many
  // as there is room for, so none the world draws is pushed out (useBlooms).
  const listedSeeds = useMemo(() => (tab === 'seeds' ? tabs.seeds.map(seedOf).filter((x): x is SeedItem => x !== null) : []), [tab, tabs])
  useEffect(() => { wantSeeds(listedSeeds, { room: true }) }, [listedSeeds])
  const close = (): void => useShards.getState().setNearbyOpen(false)
  const view = (item: NearbyItem): void => {
    // Where to come back to, spectation and link included, before looking away.
    rememberNearbyReturn()
    viewedTab = tab
    close()
    useCyberspace.getState().viewAt(item.at, item.plane, labelOf(item).toUpperCase(), viewScaleOf(item), { item: true })
  }
  return (
    <div className="modal" role="dialog" aria-label="Discovered nearby" aria-modal="true" onPointerDown={close}>
      <div className="modal__card secrets__box" onPointerDown={(e) => e.stopPropagation()}>
        <header className="panel__head secrets__head">
          <h2>Discovered nearby</h2>
          <span className="tag">{list.length === 0 ? 'NOTHING HERE' : `${list.length} DECRYPTED HERE`}</span>
          <ModalClose onClose={close} />
        </header>
        <div className="secrets__summary">
          <span>Hop actions produce region keys that decrypt hidden things nearby.</span>
        </div>
        <NearbyTabs tab={tab} counts={counts} onTab={setTab} />
        <ul className="secrets__list" role="tabpanel">
          {list.length === 0 && <li className="secrets__empty">Nothing decrypted in this region. A rescan is triggered after every movement action.</li>}
          {list.length > 0 && tabs[tab].length === 0 && <li className="secrets__empty">None here.</li>}
          {tabs[tab].map((item) => item.type === 'seed' ? <SeedRow key={item.key} item={item} me={me} onView={view} /> : <Row key={item.key} item={item} me={me} onView={view} />)}
        </ul>
      </div>
    </div>
  )
}
