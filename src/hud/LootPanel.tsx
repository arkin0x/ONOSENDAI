/**
 * LootPanel.tsx — what is hidden in cyberspace, as a list.
 *
 * Every kind:33330 bag on the relay: who hid it, the size of the region it is
 * encrypted to, when, how much, and the riddle if there is one. Where each bag
 * is stays hidden until hints land (the spec amendment is in progress); today
 * the panel answers the question a newcomer asks first, whether there is
 * anything out there at all. Tapping a bag opens its record (LootDetail). A bag
 * your scan has already opened is marked FOUND; your own bags are marked YOURS.
 */

import { useEffect, useMemo, useState } from 'react'
import { useLoot } from '../hooks/useLoot'
import { messagePreview } from '../lib/hidden'
import { formatBytes, regionLabel } from '../lib/loot'
import { CYBERSPACE_RELAY } from '../lib/relay'
import { formatAgo, formatStamp } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { useLootView } from '../store/useLootView'
import { useShards } from '../store/useShards'
import { ProfileBadge } from './ProfileBadge'

export function LootPanel(): JSX.Element {
  const { items, status } = useLoot()
  const me = useCyberspace((s) => s.identity.pubkey)
  const discovered = useShards((s) => s.discovered)
  const found = useMemo(() => new Set(Object.values(discovered).map((h) => h.bagId)), [discovered])
  const foundCount = useMemo(() => items.filter((it) => found.has(it.bagId)).length, [items, found])
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), 10_000)
    return () => window.clearInterval(t)
  }, [])
  const relayName = CYBERSPACE_RELAY.replace('wss://', '')

  return (
    <section className="panel panel--loot">
      <header className="panel__head">
        <h2>Loot</h2>
        <span className="loot__tags">
          {foundCount > 0 && <span className="tag tag--live">{foundCount} FOUND</span>}
          <span className="tag">{status === 'loading' ? 'LOADING' : `${items.length} HIDDEN`}</span>
        </span>
      </header>

      {status === 'error' && <p className="notice">Could not reach {relayName}.</p>}

      <ul className="avatars__list loot__list">
        {items.map((it) => (
          <li key={it.key} className="loot__row">
            <button className="loot__open" onClick={() => useLootView.getState().select(it)} title="Open this bag's record">
              <div className="loot__top">
                <ProfileBadge pubkey={it.author} />
                {it.author === me && <span className="avatars__you">YOURS</span>}
                {found.has(it.bagId) && <span className="tag tag--live">FOUND</span>}
                <span className="avatars__when" title={formatStamp(it.createdAt)}>{formatAgo(it.createdAt, now)}</span>
              </div>
              <div className="loot__meta">{regionLabel(it.height)} · {formatBytes(it.bytes)}</div>
              {it.riddle && <div className="loot__riddle" title={it.riddle}>“{messagePreview(it.riddle, 90)}”</div>}
            </button>
          </li>
        ))}
        {status === 'ready' && items.length === 0 && (
          <li className="avatars__empty">Nothing hidden on the relay yet.</li>
        )}
      </ul>

      <p className="legend__note">
        Every kind:33330 bag on {relayName}. The size is the region each bag is
        encrypted to, not its distance from you: where that region is stays hidden
        until its hider adds a hint. Tap a bag for its record.
      </p>
    </section>
  )
}
