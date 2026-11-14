/**
 * NearbyLootModal.tsx — what has been decrypted where you stand.
 *
 * The green box is the region your keys open; this is the list of what is in
 * it: every shard, message, key and chest this client has opened or placed
 * whose region holds the anchor, newest first (arkinox, 2026-10-13), nearest
 * first among things made in the same second, undated things last. Reached from the found chip,
 * which says how many, and from NEARBY on the DISCOVERED panel. VIEW flies to
 * the thing the way the bag record's VIEW does. A key row has TAKE until it
 * is held; a chest row has its OPEN, and a door row its OPEN or CLOSE, beside
 * VIEW and the same size, VIEW on the right (arkinox, 2026-11-12). A seed's
 * row names its DNA, how far it has grown and who planted it; its name opens
 * its card (BloomCard) and its VIEW frames the bloom at the seed's scale
 * (arkinox, 2026-11-13: "we need to add seeds to this modal").
 * Tabs sort the list by kind, ITEMS first (lib/nearbyTabs.ts); every opening
 * starts on the first tab, left to right, with anything in it (arkinox,
 * 2026-11-01), and RETURN from a VIEW comes back to the tab it left.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNearbyLoot, type NearbyItem } from '../hooks/useNearbyLoot'
import { useProfile } from '../hooks/useProfile'
import { findCashuToken } from '../lib/cashu'
import { hiddenLabel, messagePreview } from '../lib/hidden'
import { ItemIcon } from './ItemIcon'
import { ShardThumb } from './ShardThumb'
import type { HeldPlace } from '../lib/inventory'
import { safeNpub } from '../lib/npub'
import { formatDistance } from 'sno-core/scale'
import { useCyberspace } from '../store/useCyberspace'
import { profileLabel } from '../store/useProfiles'
import { useShards } from '../store/useShards'
import { rememberNearbyReturn } from '../lib/nearbyReturn'
import { ProfilePic, ProfileTap } from './ProfileBadge'
import { ChestBlock, KeyLine, listedOnce, useChestOpen } from './ItemRows'
import { useEscape } from '../hooks/useEscape'
import { NEARBY_TABS, byTab, firstFilledTab, type NearbyTab } from '../lib/nearbyTabs'
import { lockWord, useOpenedChests } from '../store/useOpenedChests'
import { GoArrow } from './ui/GoArrow'
import { useBlooms, wantSeeds } from '../store/useBlooms'
import { seedOfEvent, viewScaleOf, type SeedItem } from '../lib/seeds/seedItem'
import { bloomGrowthWords } from '../lib/seeds/bloomWords'

/** Where a nearby item was found, for what is taken out of a chest here. */
function placeOf(item: NearbyItem): HeldPlace {
  return { lookupId: item.lookupId ?? '', bagId: item.bagId ?? '', at: { x: item.at.x.toString(), y: item.at.y.toString(), z: item.at.z.toString() }, plane: item.plane, height: item.height }
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

/** The second line: where it is, in the words the panels use. */
function whereOf(item: NearbyItem): string {
  return `${item.plane === 1 ? 'Ideaspace' : 'Dataspace'}, height ${item.height}`
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
  // A chest's OPEN, or a door's OPEN or CLOSE, is drawn here, beside VIEW and
  // the same size (ItemRows ChestBlock actionsIn; tutorial feedback 2026-11-12, item 2).
  const [chestActs, setChestActs] = useState<HTMLElement | null>(null)
  const chest = item.type === 'chest' && !!item.chest
  return (
    <li className="secrets__row nearby__row">
      {item.type === 'shard' && item.shard ? <ShardThumb shard={item.shard} /> : <ItemIcon className="nearby__glyph" type={item.type} coin={item.type === 'message' && findCashuToken(item.text) !== null} size={14} />}
      <div className="nearby__body">
        {item.type === 'key' && item.keyItem
          ? <KeyLine id={item.key} name={item.keyItem.name} author={author} />
          : item.type === 'chest' && item.chest
            ? <ChestBlock id={item.key} chest={item.chest} author={author} verified place={placeOf(item)} actionsIn={chestActs} />
            : <span className="nearby__label">{labelOf(item)}</span>}
        <span className="nearby__where">{whereOf(item)}{item.type === 'chest' && item.chest && <> · <LockStatus id={item.key} lock={item.chest.lockPubkey} me={me} /></>}</span>
        <span className="nearby__meta">
          {author && <ProfileTap pubkey={author}><ProfilePic pubkey={author} size={14} /></ProfileTap>}
          <span>{name}</span>
          <span>· {distanceWords(item.distance)}</span>
        </span>
      </div>
      <span className="nearby__acts">
        {chest && <span className="nearby__door" ref={setChestActs} />}
        <button className="avatars__go nearby__view" onClick={() => onView(item)} title="Fly to it">VIEW<GoArrow /></button>
      </span>
    </li>
  )
}

/**
 * A seed's row: its DNA's name, which opens the seed's card (BloomCard, in
 * the hidden-thing card) in place of this list; where it is and how far it
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
  const card = (): void => {
    useShards.getState().setNearbyOpen(false)
    useShards.getState().selectSecret(item.key)
  }
  return (
    <li className="secrets__row nearby__row">
      {view?.shard ? <ShardThumb shard={view.shard} /> : <ItemIcon className="nearby__glyph" type="seed" size={14} />}
      {/* The whole of its words is the tap, a fingertip's worth on a phone (review of #701). */}
      <button className="nearby__body nearby__name" onClick={card} title="Open its card">
        <span className="nearby__label">{seedName(view?.dna)}</span>
        <span className="nearby__where">{whereOf(item)} · {bloomGrowthWords(view)}</span>
        <span className="nearby__meta">
          {planter && <ProfileTap pubkey={planter} nested><ProfilePic pubkey={planter} size={14} /></ProfileTap>}
          <span>{name}</span>
          <span>· {distanceWords(item.distance)}</span>
        </span>
      </button>
      <span className="nearby__acts">
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
  // Escape closes it as a tap outside does (arkinox, 2026-10-01).
  useEscape('modal', open, () => useShards.getState().setNearbyOpen(false))
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
          <button className="targets__remove secrets__close" onClick={close} aria-label="Close" title="Close">✕</button>
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
