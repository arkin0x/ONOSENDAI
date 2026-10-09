/**
 * DiscoveredPanel.tsx: DISCOVERED, what is hidden in cyberspace and what your
 * keys have opened, as a list.
 *
 * Every kind:33330 bag on the relay: who hid it, the size of the region it is
 * encrypted to, when, how much, and the riddle if there is one. Where each bag
 * is stays hidden until hints land (the spec amendment is in progress); today
 * the panel answers the question a newcomer asks first, whether there is
 * anything out there at all. Tapping a bag opens its record (LootDetail),
 * where what your keys opened in it is listed: messages, shards, coins, keys
 * and chests, with OPEN and TAKE on a chest (ItemRows). A bag your scan has
 * already opened is marked with what was in it; your own bags are marked
 * YOURS. The panel shows the four newest; VIEW MORE opens the whole list in
 * an overlay that scrolls, so the menu column stays short.
 *
 * This was the LOOT panel until Keys and Chests B1 (ruling 14): three bag
 * states, three panels. HIDDEN (known, not opened) is later; DISCOVERED is
 * this one, opened where it stands; LOOT (InventoryPanel) is what you hold.
 */

import { findCashuToken } from '../lib/cashu'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLoot } from '../hooks/useLoot'
import { hiddenGlyph, messagePreview } from '../lib/hidden'
import { formatBytes, regionLabel, type LootItem } from '../lib/loot'
import { CYBERSPACE_RELAY } from '../lib/relay'
import { formatAgo, formatStamp } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { useLootView } from '../store/useLootView'
import { useShards } from '../store/useShards'
import { ProfileBadge } from './ProfileBadge'
import { Explanation } from './Explanation'
import { useNearbyLoot } from '../hooks/useNearbyLoot'
import { useEscape } from '../hooks/useEscape'

/** Rows the panel shows before VIEW MORE takes over. */
const SHOWN = 4

export function DiscoveredPanel(): JSX.Element {
  const { items, status } = useLoot()
  const [more, setMore] = useState(false)
  // The VIEW MORE list is a modal: Escape closes it as a tap outside does (arkinox, 2026-10-01).
  useEscape('modal', more, () => setMore(false))
  const me = useCyberspace((s) => s.identity.pubkey)
  const discovered = useShards((s) => s.discovered)
  // What each found bag holds, oldest item first, as glyphs: ◇ a shard, ✎ a message, ₿ a coin, ⚷ a key, ▣ a chest.
  const kinds = useMemo(() => {
    const by = new Map<string, { at: number; glyph: string }[]>()
    for (const h of Object.values(discovered)) {
      const list = by.get(h.bagId) ?? []
      list.push({ at: h.createdAt, glyph: hiddenGlyph(h.type, h.type === 'message' && findCashuToken(h.text) !== null) })
      by.set(h.bagId, list)
    }
    const out = new Map<string, string>()
    for (const [bag, list] of by) out.set(bag, list.sort((a, b) => a.at - b.at).map((x) => x.glyph).join(''))
    return out
  }, [discovered])
  const found = useMemo(() => new Set(kinds.keys()), [kinds])
  const nearbyCount = useNearbyLoot().length
  const foundCount = useMemo(() => items.filter((it) => found.has(it.bagId)).length, [items, found])
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), 10_000)
    return () => window.clearInterval(t)
  }, [])
  const relayName = CYBERSPACE_RELAY.replace('wss://', '')

  const open = (it: LootItem): void => { setMore(false); useLootView.getState().select(it) }
  const row = (it: LootItem): JSX.Element => (
    <li key={it.key} className="loot__row">
      <button className="loot__open" onClick={() => open(it)} title="Open this bag's record">
        <div className="loot__top">
          <ProfileBadge pubkey={it.author} />
          {it.author === me && <span className="avatars__you">YOURS</span>}
          {found.has(it.bagId) && <span className="tag tag--live loot__kinds" title={`Found: ${kinds.get(it.bagId)?.length ?? 0} items`}>{kinds.get(it.bagId)}</span>}
          <span className="avatars__when" title={formatStamp(it.createdAt)}>{formatAgo(it.createdAt, now)}</span>
        </div>
        <div className="loot__meta">{regionLabel(it.height)} · {formatBytes(it.bytes)}</div>
        {it.riddle && <div className="loot__riddle" title={it.riddle}>“{messagePreview(it.riddle, 90)}”</div>}
      </button>
    </li>
  )

  return (
    <section className="panel panel--loot">
      <header className="panel__head">
        <h2>Discovered</h2>
        <span className="loot__tags">
          {foundCount > 0 && <span className="tag tag--live">{foundCount} FOUND</span>}
          <span className="tag">{status === 'loading' ? 'LOADING' : `${items.length} HIDDEN`}</span>
        </span>
      </header>

      {status === 'error' && <p className="notice">Could not reach {relayName}.</p>}

      <ul className="avatars__list loot__list">
        {items.slice(0, SHOWN).map(row)}
        {status === 'ready' && items.length === 0 && (
          <li className="avatars__empty">Nothing hidden on the relay yet.</li>
        )}
      </ul>
      {/* Two doors under the list, side by side: what is decrypted where you
          stand, and the rest of what the relay holds. A button is not a tag,
          so neither lives in the header. */}
      <div className={`loot__actions ${items.length > SHOWN ? '' : 'loot__actions--one'}`}>
        <button className="avatars__more" onClick={() => useShards.getState().setNearbyOpen(true)} title="What has been decrypted in the region you stand in">NEARBY {nearbyCount}</button>
        {items.length > SHOWN && (
          <button className="avatars__more" onClick={() => setMore(true)}>VIEW MORE ({items.length - SHOWN})</button>
        )}
      </div>

      <Explanation>
        Identities can encrypt messages, 3D objects (shards), bitcoin (cashu
        ecash), keys and chests by location. These encrypted bundles are called
        "bags" and might have clues as to where they can be found. The size is
        the area wherein the bag can be found; larger is more work to decrypt
        but easier to find, smaller is less work to decrypt but harder to find.
        What your keys have opened is marked, and a chest found opens here with
        a key from your LOOT.
      </Explanation>

      {/* Through a portal: the panel's backdrop-filter makes it a stacking context, under the panels below it. */}
      {more && createPortal(
        <div className="modal" role="dialog" aria-modal="true" aria-label="All discovered" onPointerDown={() => setMore(false)}>
          <div className="modal__card modal__card--list" onPointerDown={(e) => e.stopPropagation()}>
            <header className="panel__head">
              <h2>Discovered</h2>
              <span className="tag">{items.length} HIDDEN</span>
            </header>
            <ul className="avatars__list avatars__list--all loot__list">{items.map(row)}</ul>
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
