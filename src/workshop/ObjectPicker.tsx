/**
 * ObjectPicker.tsx - choosing the object OBJECT stamps (DECK-0003 §1.10).
 *
 * The source decides what a placement is (arkinox, 2026-10-25: "if i chose my
 * water in my library, then its inlined. if i chose my water from the feed,
 * then its a live reference"):
 * - YOURS, the shards in your workshop, in their folders, published or not: a
 *   copy goes inside the shard it is stamped into, carried in its `objects`
 *   (lib/carried.ts copyInto), and is edited there; nothing links it back.
 * - FEED, the Shard Feed, or anyone's object BY ADDRESS (`naddr1…` or
 *   `33331:<pubkey>:<d>`), your own published ones included: an `a`
 *   reference, which follows its author's newest version (arkinox,
 *   2026-09-25: NIP-01 lets relays drop old versions, so an `e` may find
 *   nothing). It always carries a relay hint, which is also how a hide tells a
 *   live link from a piece of your library (store/localObjects.ts carryLibrary).
 *
 * No paragraph explains it in the modal; EXPLAIN does (arkinox: no
 * explanatory paragraphs in the UI).
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { nip19 } from 'nostr-tools'
import { fromPayload, type Ref, type ShardModel } from 'sno-core/shards'
import type { NostrEvent } from '../lib/events'
import { fetchRef } from '../lib/parts'
import { keepOwnTable } from '../lib/carried'
import { relaySet } from '../lib/relay'
import { useCyberspace } from '../store/useCyberspace'
import { useWorkshop, type StampObject } from '../store/useWorkshop'
import { useEscape } from '../hooks/useEscape'
import { ShardFolders, modelEditedAt, modelName, modelRef, useNewestFirst } from '../hud/ShardFolders'
import { FeedList } from '../hud/FeedList'
import { Explanation } from '../hud/Explanation'
import { ShardThumb } from '../hud/ShardThumb'

const OBJECT_KIND = 33331

interface Found { address: string; relay?: string; shard: ShardModel; at: number }

/** An `naddr1…` or a bare `33331:<pubkey hex>:<d>`, as the address and an optional relay hint; null otherwise. */
export function parseObjectAddress(input: string): { address: string; relay?: string } | null {
  const t = input.trim()
  if (/^33331:[0-9a-f]{64}:.+$/.test(t)) return { address: t }
  try {
    const d = nip19.decode(t.replace(/^nostr:/, ''))
    if (d.type !== 'naddr' || d.data.kind !== OBJECT_KIND) return null
    return { address: `${OBJECT_KIND}:${d.data.pubkey}:${d.data.identifier}`, relay: d.data.relays?.[0] }
  } catch { return null }
}

/** The newest version of each of an author's objects, without hidden ones or anything unreadable. */
export function objectsOf(events: NostrEvent[]): Found[] {
  const newest = new Map<string, NostrEvent>()
  for (const ev of events) {
    if (ev.kind !== OBJECT_KIND || ev.tags.some((t) => t[0] === 'encrypted')) continue
    const d = ev.tags.find((t) => t[0] === 'd')?.[1]
    if (!d || d === 'avatar') continue
    const key = `${ev.pubkey}:${d}`
    const have = newest.get(key)
    if (!have || ev.created_at > have.created_at) newest.set(key, ev)
  }
  const out: Found[] = []
  for (const [key, ev] of newest) {
    let raw: unknown
    try { raw = JSON.parse(ev.content) } catch { continue }
    const read = fromPayload(raw, key)
    const shard = read && keepOwnTable(read, ev.pubkey)
    if (shard) out.push({ address: `${OBJECT_KIND}:${key}`, shard, at: ev.created_at })
  }
  return out.sort((a, b) => b.at - a.at)
}

/**
 * A published object's folder ref is its `d`: an object published from the
 * workshop has its model's id there, so it shows in the folder its model is
 * in (hud/ShardFolders).
 */
export const foundRef = (o: Found): string => o.address.split(':').slice(2).join(':')

/** Where a stamp's object comes from. */
type Source = 'yours' | 'feed'

/**
 * A live link to `address`: always with a relay hint, the one it was seen on
 * or else the first of yours, so a hide knows it for a reference and never
 * carries it (store/localObjects.ts carryLibrary).
 */
export function liveRef(address: string, relay?: string): Ref {
  return ['a', address, relay || relaySet()[0] || 'wss://cyberspace.nostr1.com']
}

export function ObjectPicker({ onClose }: { onClose: () => void }): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const shards = useWorkshop((s) => s.shards)
  const currentId = useWorkshop((s) => s.currentId)
  const [source, setSource] = useState<Source>(() => (shards.some((s) => s.id !== currentId) ? 'yours' : 'feed'))
  const [address, setAddress] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Newest first, a deploy counted as an edit, as every list of your shards (hud/ShardFolders).
  const yours = useNewestFirst(shards, modelRef, modelEditedAt)

  const choose = (o: StampObject): void => {
    useWorkshop.getState().setStampObject(o)
    onClose()
  }

  const byAddress = async (): Promise<void> => {
    const parsed = parseObjectAddress(address)
    if (!parsed) { setStatus('That is not an object address. Paste an naddr1… or 33331:<pubkey>:<d>.'); return }
    setBusy(true)
    setStatus('Asking the relays…')
    const ref = liveRef(parsed.address, parsed.relay)
    const raw = await fetchRef(ref)
    setBusy(false)
    const read = raw == null ? null : fromPayload(raw, parsed.address)
    const shard = read && keepOwnTable(read, parsed.address.split(':')[1])
    if (!shard) { setStatus(raw == null ? 'No relay had that object.' : 'That object is not one the format can read.'); return }
    choose({ ref, name: shard.name, shard })
  }
  // Escape closes it as a tap outside does (arkinox, 2026-10-01).
  useEscape('modal', true, onClose)

  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label="Choose an object to stamp" onPointerDown={onClose}>
      <div className="modal__card login objpick" onPointerDown={(e) => e.stopPropagation()}>
        <div className="login__head">
          <h2 className="modal__title">Stamp an object</h2>
          <button className="secret__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="objpick__tabs" role="tablist">
          <button role="tab" aria-selected={source === 'yours'} className={`objpick__tab ${source === 'yours' ? 'is-on' : ''}`} onClick={() => setSource('yours')} title="Your workshop: a copy goes inside this shard">YOURS</button>
          <button role="tab" aria-selected={source === 'feed'} className={`objpick__tab ${source === 'feed' ? 'is-on' : ''}`} onClick={() => setSource('feed')} title="Published objects: placed by reference, a live link">FEED</button>
        </div>
        {source === 'yours' && (
          <div className="login__section">
            {yours.length === 0 && <p className="login__note">No shards in your workshop yet.</p>}
            {yours.length > 0 && (
              <ul className="objpick__list">
                <ShardFolders items={yours} refOf={modelRef} nameOf={modelName} row={(s, f) => {
                  const self = s.id === currentId
                  const empty = s.vertices.length === 0 && (s.parts?.length ?? 0) === 0
                  return (
                    <li key={s.id} {...f.drag}>
                      <button className="objpick__row" disabled={self || empty || !me} onClick={() => choose({ ref: ['a', `${OBJECT_KIND}:${me}:${s.id}`], name: s.name, shard: s, copy: { sourceId: s.id, pubkey: me } })} title={self ? 'An object cannot place itself' : empty ? 'Nothing in it to place yet' : `Stamp a copy of "${s.name}"`}>
                        <ShardThumb shard={s} own />
                        <span className="objpick__name">{s.name}</span>
                        <span className="objpick__meta">{self ? 'THIS SHARD' : empty ? 'EMPTY' : `${s.vertices.length} v · ${s.faces.length} f${s.parts?.length ? ` · ${s.parts.length} obj` : ''}`}</span>
                      </button>
                      {f.tool}
                    </li>
                  )
                }} />
              </ul>
            )}
            <Explanation>
              <ul className="objpick__explain">
                <li>A copy goes inside this shard, and inside what you hide, encrypted.</li>
                <li>Edit the copy here. The piece in your workshop is not linked to it.</li>
              </ul>
            </Explanation>
          </div>
        )}
        {source === 'feed' && (
          <>
            <FeedList onPick={(o) => choose({ ref: liveRef(o.address, o.seen?.[0]), name: o.shard.name, shard: keepOwnTable(o.shard, o.pubkey) })} />
            <div className="login__section">
              <label className="login__label" htmlFor="objpick-address">Anyone's, by address</label>
              <input id="objpick-address" className="avatars__input login__input" type="text" spellCheck={false} autoComplete="off" placeholder="naddr1… or 33331:<pubkey>:<d>" value={address} onChange={(e) => setAddress(e.target.value)} />
              <button className="secret__act login__act" disabled={busy || !address.trim()} onClick={() => void byAddress()}>{busy ? 'LOOKING…' : 'USE THIS OBJECT'}</button>
              {status && <p className="login__note" style={{ margin: 0 }}>{status}</p>}
            </div>
            <Explanation>
              <ul className="objpick__explain">
                <li>Placed by reference: it stays that object, and follows it when its author edits it.</li>
              </ul>
            </Explanation>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
