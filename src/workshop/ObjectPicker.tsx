/**
 * ObjectPicker.tsx - choosing the object OBJECT stamps (DECK-0003 §1.10).
 *
 * ONOSENDAI has no public feed, so the choice is the objects this key has
 * published (kind 33331, from snocrash or anywhere else), newest first, and a
 * field for anyone's object by address: an `naddr1…` or `33331:<pubkey>:<d>`.
 * Hidden objects (a 33331 whose payload is sealed to a place, DECK-0003 §3.4)
 * are left out: their content is a preview, not a shape. The choice is always
 * an `a` reference, which follows its author's newest version (arkinox,
 * 2026-09-25: NIP-01 lets relays drop old versions, so an `e` may find nothing).
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { nip19 } from 'nostr-tools'
import { fromPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { GENERAL_RELAYS } from '../lib/contacts'
import type { NostrEvent } from '../lib/events'
import { fetchRef } from '../lib/parts'
import { queryAny, relaySet } from '../lib/relay'
import { useCyberspace } from '../store/useCyberspace'
import { useWorkshop, type StampObject } from '../store/useWorkshop'

const OBJECT_KIND = 33331
const WAIT_MS = 5000

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
    const shard = fromPayload(raw, key)
    if (shard) out.push({ address: `${OBJECT_KIND}:${key}`, shard, at: ev.created_at })
  }
  return out.sort((a, b) => b.at - a.at)
}

export function ObjectPicker({ onClose }: { onClose: () => void }): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const [mine, setMine] = useState<Found[] | null>(null)
  const [address, setAddress] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setMine(null)
    void queryAny([...new Set([...relaySet(), ...GENERAL_RELAYS])], { kinds: [OBJECT_KIND], authors: [me] }, WAIT_MS)
      .then((events) => { if (live) setMine(objectsOf(events)) }, () => { if (live) setMine([]) })
    return () => { live = false }
  }, [me])

  const choose = (o: StampObject): void => {
    useWorkshop.getState().setStampObject(o)
    onClose()
  }
  const refOf = (addr: string, relay?: string): Ref => (relay ? ['a', addr, relay] : ['a', addr])

  const byAddress = async (): Promise<void> => {
    const parsed = parseObjectAddress(address)
    if (!parsed) { setStatus('That is not an object address. Paste an naddr1… or 33331:<pubkey>:<d>.'); return }
    setBusy(true)
    setStatus('Asking the relays…')
    const ref = refOf(parsed.address, parsed.relay)
    const raw = await fetchRef(ref)
    setBusy(false)
    const shard = raw == null ? null : fromPayload(raw, parsed.address)
    if (!shard) { setStatus(raw == null ? 'No relay had that object.' : 'That object is not one the format can read.'); return }
    choose({ ref, name: shard.name, shard })
  }

  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label="Choose an object to stamp" onPointerDown={onClose}>
      <div className="modal__card login objpick" onPointerDown={(e) => e.stopPropagation()}>
        <div className="login__head">
          <h2 className="modal__title">Stamp an object</h2>
          <button className="secret__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="login__note">
          Placed by reference: it stays that object, and follows it when its author edits it. Only published objects can be
          placed; publish one from snocrash first.
        </p>
        <div className="login__section">
          <span className="login__label">Yours</span>
          {mine === null && <p className="login__note">Reading the relays…</p>}
          {mine !== null && mine.length === 0 && <p className="login__note">No published objects under this key yet.</p>}
          {mine !== null && mine.length > 0 && (
            <ul className="objpick__list">
              {mine.map((o) => (
                <li key={o.address}>
                  <button className="objpick__row" onClick={() => choose({ ref: refOf(o.address), name: o.shard.name, shard: o.shard })}>
                    <span className="objpick__name">{o.shard.name}</span>
                    <span className="objpick__meta">{o.shard.vertices.length} v · {o.shard.faces.length} f{o.shard.parts?.length ? ` · ${o.shard.parts.length} obj` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="login__section">
          <label className="login__label" htmlFor="objpick-address">Anyone's, by address</label>
          <input id="objpick-address" className="avatars__input login__input" type="text" spellCheck={false} autoComplete="off" placeholder="naddr1… or 33331:<pubkey>:<d>" value={address} onChange={(e) => setAddress(e.target.value)} />
          <button className="secret__act login__act" disabled={busy || !address.trim()} onClick={() => void byAddress()}>{busy ? 'LOOKING…' : 'USE THIS OBJECT'}</button>
          {status && <p className="login__note" style={{ margin: 0 }}>{status}</p>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
