/**
 * LootDetail.tsx: one bag, opened from the HIDDEN BAGS or DISCOVERED BAGS list.
 *
 * Everything a seeker can know about a bag without opening it: who hid it and
 * when, the size of the region it is encrypted to, how much is inside, the
 * riddle if the hider wrote one, and the wire identifiers. Where the bag is
 * stays hidden until its hider adds a hint, and the view says so in plain
 * words rather than leaving a number to be misread as a distance. A bag your
 * own scan has already opened, or one of your own, lists its items with a
 * VIEW button that flies the scene to each. A key found is marked as held;
 * a chest found says what opens it and, when you hold that, opens here with
 * its contents beneath and TAKE on each (ItemRows, Keys and Chests B1 §3.2).
 */

import { cashuLabel, readCashuToken } from '../lib/cashu'
import type { Plane } from 'cyberspace-core'
import { useState } from 'react'
import { useProfile } from '../hooks/useProfile'
import type { ShardModel } from 'sno-core/shards'
import { useWorkshop } from '../store/useWorkshop'
import { hiddenLabel, messagePreview, type ChestItem, type HiddenType, type KeyItem } from '../lib/hidden'
import { ItemFace } from './ItemIcon'
import { placeOf, type HeldPlace } from '../lib/inventory'
import { formatBytes, hintBoxLabel, hintSearchExponent, regionLabel, type LootItem } from '../lib/loot'
import { safeNpub } from '../lib/npub'
import type { Position } from '../lib/space'
import { spectate } from '../lib/spectator'
import { formatAgo, formatStamp, shortHex } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { useLootView } from '../store/useLootView'
import { profileLabel } from '../store/useProfiles'
import { useShards, positionOf } from '../store/useShards'
import { ProfilePic } from './ProfileBadge'
import { ChestBlock, KeyLine } from './ItemRows'
import { useEscape } from '../hooks/useEscape'
import { useBagReading } from '../hooks/useBagReadings'

/** An item of this bag that this client can already see, from a scan or from its own deployments. */
interface OpenedItem {
  eventId: string
  type: HiddenType
  label: string
  /** A message that carries a Cashu token, marked as a coin. */
  coin: boolean
  at: Position
  plane: Plane
  unit: number
  shard?: ShardModel
  text?: string
  key?: KeyItem
  chest?: ChestItem
  /** Where it was found, for what is taken out of a chest here. */
  place: HeldPlace
}

/** A message's preview, or what its Cashu token holds when it carries one; a coin that cannot be read is still a coin. */
/**
 * A hint's search in words: the number of region keys a seeker derives, one
 * per candidate region in the box (spec §7.7), as a count while it is one a
 * person might try, and as a plain refusal past that.
 */
function searchLabel(exponent: number): string {
  if (exponent === 0) return 'one region key, which names the place itself'
  if (exponent > 40) return `more region keys (2^${exponent}) than anyone will ever try`
  return `about ${(2 ** exponent).toLocaleString('en-US')} region keys`
}

function Copyable({ label, value, title }: { label: string; value: string; title?: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <>
      <dt title={title}>{label}</dt>
      <dd><button className="lootd__copy" title={`${value} (click to copy)`} onClick={copy}>{copied ? 'copied' : shortHex(value, 12, 8)}</button></dd>
    </>
  )
}

/** A row's label by what it is, and whether it is a coin: a message's words or its token, else its name. */
function labelOf(x: { type: HiddenType; text?: string; shard?: ShardModel; key?: KeyItem; chest?: ChestItem }): { label: string; coin: boolean } {
  if (x.type !== 'message') return { label: hiddenLabel(x), coin: false }
  const { raw, token } = readCashuToken(x.text)
  return { label: token ? `${cashuLabel(token)} hidden here` : raw ? 'cashu token hidden here' : messagePreview(x.text ?? '', 48), coin: raw !== null }
}

/** The bag's items this client can see: found by its scan, or its own. */
function openedItems(item: LootItem, discovered: ReturnType<typeof useShards.getState>['discovered'], mine: ReturnType<typeof useShards.getState>['mine']): OpenedItem[] {
  const out = new Map<string, OpenedItem>()
  for (const h of Object.values(discovered)) {
    if (h.bagId !== item.bagId) continue
    out.set(h.eventId, {
      eventId: h.eventId,
      type: h.type,
      ...labelOf(h),
      at: h.at,
      plane: h.plane,
      unit: h.type === 'shard' ? h.shard?.unit ?? 0 : 0,
      shard: h.shard,
      text: h.text,
      key: h.key,
      chest: h.chest,
      place: placeOf(h),
    })
  }
  for (const d of mine) {
    if (d.bagId !== item.bagId || out.has(d.eventId)) continue
    out.set(d.eventId, {
      eventId: d.eventId,
      type: d.type,
      ...labelOf(d),
      at: positionOf(d),
      plane: d.plane,
      unit: d.type === 'shard' ? d.shard?.unit ?? 0 : 0,
      shard: d.shard,
      text: d.text,
      key: d.key,
      chest: d.chest,
      place: { lookupId: d.lookupId, bagId: d.bagId, at: d.at, plane: d.plane, height: d.height },
    })
  }
  return [...out.values()]
}

export function LootDetail(): JSX.Element | null {
  const item = useLootView((s) => s.selected)
  const me = useCyberspace((s) => s.identity.pubkey)
  const targeted = useCyberspace((s) => (item ? !!s.targets[item.author] : false))
  const discovered = useShards((s) => s.discovered)
  const mine = useShards((s) => s.mine)
  const profile = useProfile(item?.author ?? null)
  // Which item's COPY just fired, for its brief COPIED label. Declared before
  // the early return below: hooks must run in the same order every render.
  const [copied, setCopied] = useState<string | null>(null)
  // Escape closes it as a tap outside does (arkinox, 2026-10-01).
  useEscape('modal', item !== null, () => useLootView.getState().select(null))
  // The bag's reading, also above the return: with it below, the first tap
  // on any bag rendered one hook more than the empty render before it, and
  // React threw error 310 (arkinox, 2026-10-09).
  const reading = useBagReading(item?.bagId ?? '')

  if (!item) return null

  const npub = safeNpub(item.author)
  const name = profileLabel(profile, npub)
  const yours = item.author === me
  const opened = openedItems(item, discovered, mine)
  const close = (): void => useLootView.getState().select(null)

  const view = (o: OpenedItem): void => {
    close()
    useCyberspace.getState().focusItem(o.at, o.plane, o.label, o.unit)
  }
  // Fly there and open the item's own modal (SecretModal) on top.
  const details = (o: OpenedItem): void => {
    view(o)
    useShards.getState().selectSecret(o.eventId)
  }
  // A shard copies into your workshop as a model; a message copies its text.
  const copy = (o: OpenedItem): void => {
    if (o.type === 'shard' && o.shard) useWorkshop.getState().importShard(o.shard)
    else if (o.text) void navigator.clipboard?.writeText(o.text)
    setCopied(o.eventId)
    window.setTimeout(() => setCopied((c) => (c === o.eventId ? null : c)), 1400)
  }
  const watch = (): void => { close(); void spectate(item.author) }
  const target = (): void => useCyberspace.getState().toggleTarget(item.author, profile?.name ?? null)

  return (
    <div className="modal modal--top" role="dialog" aria-modal="true" aria-label="Hidden bag" onPointerDown={close}>
      <div className="modal__card secret lootd" onPointerDown={(e) => e.stopPropagation()}>
        <div className="secret__head">
          {/* The same rule as the panels (DiscoveredPanel `opened`): a bag is
              DISCOVERED once a key of this client has read it, else it is
              still HIDDEN, whichever list it was opened from (arkinox,
              2026-10-10: a bag from HIDDEN BAGS said DISCOVERED). */}
          <span className="secret__badge">◈ {reading !== undefined || opened.length > 0 ? 'DISCOVERED BAG' : 'HIDDEN BAG'}</span>
          {opened.length > 0 && <span className="tag tag--live">{yours ? 'YOURS' : 'FOUND'}</span>}
          {yours && opened.length === 0 && <span className="secret__mine">YOURS</span>}
          <button className="secret__close" onClick={close} aria-label="Close">✕</button>
        </div>

        {item.riddle && <blockquote className="secret__message" title="The hider's riddle, written in the clear">{item.riddle}</blockquote>}

        <div className="secret__creator">
          <span className="secret__label">Hidden by</span>
          <div className="secret__person">
            <ProfilePic pubkey={item.author} size={40} />
            <div className="secret__person-text">
              <span className="secret__name">{name}{yours ? ' (you)' : ''}</span>
              {profile?.nip05 && <span className="secret__nip05">{profile.nip05.replace(/^_@/, '')}</span>}
              <span className="secret__npub" title={npub}>{shortHex(npub, 14, 8)}</span>
            </div>
          </div>
        </div>

        <dl className="secret__facts lootd__facts">
          <div><dt>Placed</dt><dd title={formatStamp(item.createdAt)}>{formatAgo(item.createdAt)}</dd></div>
          <div><dt>Region</dt><dd>{regionLabel(item.height)}{item.height !== null && <span className="lootd__dim"> (height {item.height})</span>}</dd></div>
          {item.sector && <div><dt>Sector</dt><dd title="The hider's sector hint (spec §7.7): the bag is somewhere in this cube of 2^30 gibsons on a side">{item.sector}</dd></div>}
          <div><dt>Payload</dt><dd>{formatBytes(item.bytes)}</dd></div>
          <div><dt>Where</dt><dd>{opened.length > 0 ? (opened[0].plane === 0 ? 'known · dataspace' : 'known · ideaspace') : 'hidden'}</dd></div>
        </dl>

        {/* What the key opened but this client could not read, said rather than
            left blank (spec §7.6). An unknown kind, a failed verification, or a
            reference that could not be fetched. */}
        {reading && (reading.opaque || reading.entries > reading.readable || reading.entries === 0) && (
          <span className="shards__compose-note shards__compose-note--warn" role="status" title="An item of a kind this client does not know, one that fails to verify, or a reference it could not fetch (spec §7.6)">
            {reading.opaque
              ? 'Opened: this bag holds something other than a list of items.'
              : reading.entries === 0
                ? 'Opened: nothing inside.'
                : `Opened: ${reading.entries - reading.readable} of ${reading.entries} entries here cannot be read by this client.`}
          </span>
        )}

        {opened.length > 0 ? (
          <ul className="lootd__items">
            {opened.map((o) => (
              <li key={o.eventId} className={`lootd__item ${o.type === 'chest' ? 'lootd__item--chest' : ''}`}>
                <span className={`secret__badge secret__badge--${o.coin ? 'cashu' : o.type}`}><ItemFace type={o.type} coin={o.coin} image={o.key?.image} size={12} /></span>
                {/* A keypair item says it is held, its picture in the badge when it has one; a chest opens here (ItemRows). Both keep VIEW, which flies to where they stand. */}
                {o.type === 'key' && o.key
                  ? <KeyLine name={o.key.name} author={item.author} />
                  : o.type === 'chest' && o.chest
                    ? <ChestBlock id={o.eventId} chest={o.chest} author={item.author} verified place={o.place} />
                    : <span className="lootd__item-label" title={o.label}>{o.label}</span>}
                <span className="lootd__acts">
                  <button className="secret__act lootd__view" onClick={() => view(o)}>VIEW</button>
                  {(o.type === 'shard' || o.type === 'message') && (
                    <>
                      <button className="secret__act lootd__view" onClick={() => details(o)}>DETAILS</button>
                      <button className="secret__act lootd__view" onClick={() => copy(o)} title={o.type === 'shard' ? 'Copy this model into your workshop' : 'Copy the text'}>
                        {copied === o.eventId ? 'COPIED' : 'COPY'}
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="lootd__hidden">
            {item.hint
              ? `The hider hinted ${hintBoxLabel(item.hint)}; the bag is somewhere inside it, and a seeker tries ${searchLabel(hintSearchExponent(item.hint, item.height ?? 0))} to find it.`
              : item.sector
                ? 'The hider named the sector this bag is in, a cube 2^30 gibsons on a side, but not where in it. Only a scan that computes its region key can open it.'
                : item.riddle
                  ? 'This bag carries no hint box, so the riddle above is the only clue to where it is. Only a scan that computes its region key can open it.'
                  : 'This bag carries no hint, so nothing here says where it is. Only a scan that computes its region key can open it.'}
            {item.height !== null && ' The region size above is how large an area it can be found from, not how far away it is.'}
          </p>
        )}

        <dl className="lootd__wire">
          {/* Two hashes that mean different things (arkinox, 2026-10-10: "what
              is the bag hash?"): the address a scan asks the relay for, which
              never changes, and the envelope's event id, which does. */}
          <Copyable label="Lookup id" value={item.lookupId} title="The bag's address on the relay: its d tag, derived from the region key (spec §8.6). A scan asks the relay for this; it stays the same however often the bag is rewritten." />
          <Copyable label="Event id" value={item.bagId} title="The id of the bag's current nostr event (kind 33330). The hider's every rewrite is a new event with a new id; the lookup id is what stays." />
        </dl>

        {!yours && (
          <div className="secret__actions">
            <button className={`secret__act ${targeted ? 'is-on' : ''}`} onClick={target}>{targeted ? 'TARGETED' : 'TARGET'} HIDER</button>
            <button className="secret__act" onClick={watch}>SPECTATE HIDER</button>
          </div>
        )}
      </div>
    </div>
  )
}
