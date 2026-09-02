/**
 * LootDetail.tsx — one bag, opened from the Loot list.
 *
 * Everything a seeker can know about a bag without opening it: who hid it and
 * when, the size of the region it is encrypted to, how much is inside, the
 * riddle if the hider wrote one, and the wire identifiers. Where the bag is
 * stays hidden until its hider adds a hint, and the view says so in plain
 * words rather than leaving a number to be misread as a distance. A bag your
 * own scan has already opened, or one of your own, lists its items with a
 * VIEW button that flies the scene to each.
 */

import { nip19 } from 'nostr-tools'
import type { Plane } from 'cyberspace-core'
import { useState } from 'react'
import { useProfile } from '../hooks/useProfile'
import { messagePreview } from '../lib/hidden'
import { formatBytes, regionLabel, type LootItem } from '../lib/loot'
import type { Position } from '../lib/space'
import { spectate } from '../lib/spectator'
import { formatAgo, formatStamp, shortHex } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { useLootView } from '../store/useLootView'
import { profileLabel } from '../store/useProfiles'
import { useShards } from '../store/useShards'
import { ProfilePic } from './ProfileBadge'

/** An item of this bag that this client can already see, from a scan or from its own deployments. */
interface OpenedItem {
  eventId: string
  type: 'shard' | 'message'
  label: string
  at: Position
  plane: Plane
  unit: number
}

function safeNpub(pubkey: string): string {
  try { return nip19.npubEncode(pubkey) } catch { return pubkey }
}

function Copyable({ label, value }: { label: string; value: string }): JSX.Element {
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
      <dd><button className="lootd__copy" title={`${value} (click to copy)`} onClick={copy}>{copied ? 'copied' : shortHex(value, 12, 8)}</button></dd>
    </>
  )
}

/** The bag's items this client can see: found by its scan, or its own. */
function openedItems(item: LootItem, discovered: ReturnType<typeof useShards.getState>['discovered'], mine: ReturnType<typeof useShards.getState>['mine']): OpenedItem[] {
  const out = new Map<string, OpenedItem>()
  for (const h of Object.values(discovered)) {
    if (h.bagId !== item.bagId) continue
    out.set(h.eventId, {
      eventId: h.eventId,
      type: h.type,
      label: h.type === 'message' ? messagePreview(h.text ?? '', 48) : h.shard?.name ?? 'shard',
      at: h.at,
      plane: h.plane,
      unit: h.type === 'shard' ? h.shard?.unit ?? 0 : 0,
    })
  }
  for (const d of mine) {
    if (d.bagId !== item.bagId || out.has(d.eventId)) continue
    out.set(d.eventId, {
      eventId: d.eventId,
      type: d.type,
      label: d.type === 'message' ? messagePreview(d.text ?? '', 48) : d.shard?.name ?? 'shard',
      at: { x: BigInt(d.at.x), y: BigInt(d.at.y), z: BigInt(d.at.z) },
      plane: d.plane,
      unit: d.type === 'shard' ? d.shard?.unit ?? 0 : 0,
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

  if (!item) return null

  const npub = safeNpub(item.author)
  const name = profileLabel(profile, npub)
  const yours = item.author === me
  const opened = openedItems(item, discovered, mine)
  const close = (): void => useLootView.getState().select(null)

  const view = (o: OpenedItem): void => {
    close()
    useCyberspace.getState().focusOn(o.at, o.plane, o.label, o.unit)
  }
  const watch = (): void => { close(); void spectate(item.author) }
  const target = (): void => useCyberspace.getState().toggleTarget(item.author, profile?.name ?? null)

  return (
    <div className="modal modal--top" role="dialog" aria-modal="true" aria-label="Hidden bag" onPointerDown={close}>
      <div className="modal__card secret lootd" onPointerDown={(e) => e.stopPropagation()}>
        <div className="secret__head">
          <span className="secret__badge">◈ LOOT</span>
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
          <div><dt>Region</dt><dd>{regionLabel(item.height)} <span className="lootd__dim">(height {item.height})</span></dd></div>
          <div><dt>Payload</dt><dd>{formatBytes(item.bytes)}</dd></div>
          <div><dt>Where</dt><dd>{opened.length > 0 ? (opened[0].plane === 0 ? 'known · dataspace' : 'known · ideaspace') : 'hidden'}</dd></div>
        </dl>

        {opened.length > 0 ? (
          <ul className="lootd__items">
            {opened.map((o) => (
              <li key={o.eventId} className="lootd__item">
                <span className={`secret__badge secret__badge--${o.type}`}>{o.type === 'message' ? '✎' : '◇'}</span>
                <span className="lootd__item-label" title={o.label}>{o.label}</span>
                <button className="secret__act lootd__view" onClick={() => view(o)}>VIEW</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="lootd__hidden">
            This bag carries no hint, so nothing here says where it is. The region size above is how large an area it can be
            found from, not how far away it is. Only a scan that computes its region key can open it. Hints that narrow the
            search are the next step.
          </p>
        )}

        <dl className="lootd__wire">
          <Copyable label="lookup" value={item.lookupId} />
          <Copyable label="bag" value={item.bagId} />
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
