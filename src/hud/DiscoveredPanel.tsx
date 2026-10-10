/**
 * DiscoveredPanel.tsx: HIDDEN and DISCOVERED, the two bag lists.
 *
 * A bag (kind:33330) on the relay is in one of three states for this identity,
 * and each state has a panel (Keys and Chests B1, ruling 14): HIDDEN, the bag
 * is on the relay and your keys have not opened it; DISCOVERED, your keys have
 * opened it where it stands; LOOT (InventoryPanel), you took something from it.
 * The first two share one list shape, so they share this module.
 *
 * Every row is a bag: who hid it, the size of the region it is encrypted to,
 * when, how much, and the riddle if there is one. Where a bag is stays hidden
 * until hints land (the spec amendment is in progress); HIDDEN answers the
 * question a newcomer asks first, whether there is anything out there at all.
 * A DISCOVERED row also shows what was in it, one icon per kind, and tapping a bag opens
 * its record (LootDetail), where its messages, shards, coins, keys and chests
 * are listed, with OPEN and TAKE on a chest (ItemRows). Your own bags are
 * marked YOURS. Each panel shows the four newest; VIEW MORE opens the whole
 * list in an overlay that scrolls, so the menu column stays short.
 *
 * Until 2026-10-09 the one list was called LOOT and showed every bag with the
 * opened ones marked, and its header counted both at once ("1 found, 10
 * hidden"), which read as nothing (arkinox). Now each panel counts one thing.
 */

import { findCashuToken } from '../lib/cashu'
import { Box } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLoot } from '../hooks/useLoot'
import { bagReading, messagePreview } from '../lib/hidden'
import { useBagReadingsVersion } from '../hooks/useBagReadings'
import { formatBytes, regionLabel, type LootItem } from '../lib/loot'
import { CYBERSPACE_RELAY } from '../lib/relay'
import { formatAgo, formatStamp } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { useLootView } from '../store/useLootView'
import { useShards } from '../store/useShards'
import { ProfileBadge } from './ProfileBadge'
import { Explanation } from './Explanation'
import { ItemIcon, distinctKinds, type ItemKind } from './ItemIcon'
import { useNearbyLoot } from '../hooks/useNearbyLoot'
import { useEscape } from '../hooks/useEscape'

/** Rows a panel shows before VIEW MORE takes over. */
const SHOWN = 4

/** Why an opened bag shows no items: the reading's word, for a tooltip. */
function unreadableTitle(bagId: string): string {
  const r = bagReading(bagId)
  if (!r) return 'Opened'
  if (r.opaque) return 'Opened: this bag holds something other than a list of items'
  return `Opened: ${r.entries === 0 ? 'nothing inside' : `none of its ${r.entries} entries can be read by this client`}`
}

type Mode = 'hidden' | 'discovered'

/** The bags on the relay your keys have not opened. */
export function HiddenPanel(): JSX.Element {
  return <BagList mode="hidden" />
}

/** The bags on the relay your keys have opened, where they stand. */
export function DiscoveredPanel(): JSX.Element {
  return <BagList mode="discovered" />
}

function BagList({ mode }: { mode: Mode }): JSX.Element {
  const { items, status } = useLoot()
  const [more, setMore] = useState(false)
  // The VIEW MORE list is a modal: Escape closes it as a tap outside does (arkinox, 2026-10-01).
  useEscape('modal', more, () => setMore(false))
  const me = useCyberspace((s) => s.identity.pubkey)
  const discovered = useShards((s) => s.discovered)
  // What each opened bag holds: how many items, and one icon per kind in it
  // (ItemIcon), the oldest item's kind first, a coin apart from a message.
  const kinds = useMemo(() => {
    const by = new Map<string, (ItemKind & { at: number })[]>()
    for (const h of Object.values(discovered)) {
      const list = by.get(h.bagId) ?? []
      list.push({ at: h.createdAt, type: h.type, coin: h.type === 'message' && findCashuToken(h.text) !== null })
      by.set(h.bagId, list)
    }
    const out = new Map<string, { count: number; kinds: ItemKind[] }>()
    for (const [bag, list] of by) out.set(bag, { count: list.length, kinds: distinctKinds(list.sort((a, b) => a.at - b.at)) })
    return out
  }, [discovered])
  // A bag is opened when a key of ours decrypted it, whether or not anything in
  // it could be read: an opened bag with nothing readable is not hidden.
  const readingsVersion = useBagReadingsVersion()
  const opened = useMemo(
    () => new Set([...kinds.keys(), ...items.filter((it) => bagReading(it.bagId) !== undefined).map((it) => it.bagId)]),
    // readingsVersion is what changes bagReading's answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kinds, items, readingsVersion],
  )
  const nearbyCount = useNearbyLoot().length
  // One state per panel: the opened bags here, the rest there.
  const shown = useMemo(
    () => items.filter((it) => opened.has(it.bagId) === (mode === 'discovered')),
    [items, opened, mode],
  )
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), 10_000)
    return () => window.clearInterval(t)
  }, [])
  const relayName = CYBERSPACE_RELAY.replace('wss://', '')
  // "Bags" in the title (arkinox, 2026-10-10): every row is a bag, and the
  // word says so before the explanation does.
  const title = mode === 'discovered' ? 'Discovered bags' : 'Hidden bags'
  const count = status === 'loading'
    ? 'LOADING'
    : mode === 'discovered' ? `${shown.length} OPENED` : `${shown.length} HIDDEN`
  const countTitle = mode === 'discovered'
    ? 'Bags on the relay your keys have opened'
    : 'Bags on the relay your keys have not opened yet'

  const open = (it: LootItem): void => { setMore(false); useLootView.getState().select(it) }
  const row = (it: LootItem): JSX.Element => (
    <li key={it.key} className="loot__row">
      <button className="loot__open" onClick={() => open(it)} title="Open this bag's record">
        <div className="loot__top">
          <ProfileBadge pubkey={it.author} />
          {it.author === me && <span className="avatars__you">YOURS</span>}
          {kinds.has(it.bagId)
            ? <span className="tag tag--live loot__kinds" title={`Opened: ${kinds.get(it.bagId)?.count ?? 0} items`}>{kinds.get(it.bagId)?.kinds.map((k) => <ItemIcon key={`${k.type}:${k.coin}`} type={k.type} coin={k.coin} size={10} />)}</span>
            : opened.has(it.bagId) && <span className="tag loot__kinds" title={unreadableTitle(it.bagId)}>∅</span>}
          <span className="avatars__when" title={formatStamp(it.createdAt)}>{formatAgo(it.createdAt, now)}</span>
        </div>
        {/* A cube first when the hider named the sector, then the height as
            hN, the region's size (the same height as a length), and the bytes
            (arkinox, 2026-10-10). */}
        <div className="loot__meta">
          {it.sector !== null && <Box className="loot__sector" size={12} strokeWidth={2.25} aria-label="The hider named the sector" />}
          {it.height !== null && <>h{it.height} · </>}
          {regionLabel(it.height)} · {formatBytes(it.bytes)}
        </div>
        {it.riddle && <div className="loot__riddle" title={it.riddle}>“{messagePreview(it.riddle, 90)}”</div>}
      </button>
    </li>
  )

  return (
    <section className="panel panel--loot">
      <header className="panel__head">
        <h2>{title}</h2>
        <span className="loot__tags">
          <span className={`tag ${mode === 'discovered' && shown.length > 0 ? 'tag--live' : ''}`} title={countTitle}>{count}</span>
        </span>
      </header>

      {status === 'error' && <p className="notice">Could not reach {relayName}.</p>}

      <ul className="avatars__list loot__list">
        {shown.slice(0, SHOWN).map(row)}
        {status === 'ready' && shown.length === 0 && (
          <li className="avatars__empty">
            {mode === 'discovered'
              ? 'Nothing opened yet.'
              : items.length === 0 ? 'Nothing hidden on the relay yet.' : 'Nothing left unopened.'}
          </li>
        )}
      </ul>
      {/* Doors under the list: what is decrypted where you stand (DISCOVERED
          only), and the rest of the list. A button is not a tag, so neither
          lives in the header. */}
      <div className={`loot__actions ${mode === 'discovered' && shown.length > SHOWN ? '' : 'loot__actions--one'}`}>
        {mode === 'discovered' && (
          <button className="avatars__more" onClick={() => useShards.getState().setNearbyOpen(true)} title="What has been decrypted in the region you stand in">NEARBY {nearbyCount}</button>
        )}
        {shown.length > SHOWN && (
          <button className="avatars__more" onClick={() => setMore(true)}>VIEW MORE ({shown.length - SHOWN})</button>
        )}
      </div>

      {mode === 'hidden'
        ? (
          <Explanation>
            Identities can encrypt messages, 3D objects (shards), bitcoin (cashu
            ecash), keys and chests by location. These encrypted bundles are called
            "bags" and might have clues as to where they can be found. The size is
            the area wherein the bag can be found; larger is more work to decrypt
            but easier to find, smaller is less work to decrypt but harder to find.
            A bag moves to DISCOVERED the moment your keys open it.
          </Explanation>
        )
        : (
          <Explanation>
            Bags your keys have opened. Tap one for what was in it: messages,
            shards, coins, keys and chests. A chest opens here with a key from
            your LOOT, and TAKE moves what you want into LOOT.
          </Explanation>
        )}

      {/* Through a portal: the panel's backdrop-filter makes it a stacking context, under the panels below it. */}
      {more && createPortal(
        <div className="modal" role="dialog" aria-modal="true" aria-label={`All ${title.toLowerCase()}`} onPointerDown={() => setMore(false)}>
          <div className="modal__card modal__card--list" onPointerDown={(e) => e.stopPropagation()}>
            <header className="panel__head">
              <h2>{title}</h2>
              <span className="tag" title={countTitle}>{count}</span>
            </header>
            <ul className="avatars__list avatars__list--all loot__list">{shown.map(row)}</ul>
            <div className="modal__row">
              <button className="modal__cancel" onClick={() => setMore(false)}>CLOSE</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  )
}
