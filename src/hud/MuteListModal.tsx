/**
 * MuteListModal.tsx - everyone this identity has blocked and every thing it
 * has muted, each with UNBLOCK or UNMUTE, so a block is never a trap
 * (arkinox, 2026-10-23). Opened from BLOCKED in the identity panel.
 *
 * It lists the NIP-51 mute list as read (store/useMutes): entries written by
 * other clients too, public or private, since one list serves them all.
 * Words, hashtags and threads other clients put there are kept on every
 * write but not listed: ONOSENDAI hides by people and things only.
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw, Undo2 } from 'lucide-react'
import { ProfileBadge } from './ProfileBadge'
import { useEscape } from '../hooks/useEscape'
import { useCyberspace } from '../store/useCyberspace'
import { useMutes, type EditResult } from '../store/useMutes'
import { useToast } from '../store/useToast'
import { mutedBy, type Tag } from '../lib/muteList'
import { shortHex } from '../lib/time'

/** The pubkeys and item ids one half names, in the order written. */
function entries(tags: readonly Tag[], self: string): { pubkeys: string[]; items: string[] } {
  const m = mutedBy(tags, self)
  return { pubkeys: [...m.pubkeys], items: [...m.items] }
}


export function MuteListModal({ onClose }: { onClose: () => void }): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const publicTags = useMutes((s) => s.publicTags)
  const privateTags = useMutes((s) => s.privateTags)
  const locked = useMutes((s) => s.locked)
  const loaded = useMutes((s) => s.loaded)
  const busy = useMutes((s) => s.busy)
  // Why the last UNBLOCK or UNMUTE changed nothing: said here, since a toast sits under this card.
  const [refusal, setRefusal] = useState<string | null>(null)
  const refused = (result: EditResult): void => {
    setRefusal(result.ok ? null : result.reason)
    if (!result.ok) useToast.getState().show({ label: 'MUTE LIST NOT CHANGED', meta: result.reason, mark: 'block' })
  }
  useEscape('modal', true, onClose)

  const pub = entries(publicTags, me)
  const priv = entries(privateTags, me)
  const people = [...new Set([...priv.pubkeys, ...pub.pubkeys])]
  const things = [...new Set([...priv.items, ...pub.items])]
  const isPublic = (v: string, list: string[]): boolean => list.includes(v) && !priv.pubkeys.includes(v) && !priv.items.includes(v)

  return createPortal(
    <div className="modal" role="dialog" aria-label="Mute list" aria-modal="true" onPointerDown={onClose}>
      <div className="modal__card secrets__box mutes" onPointerDown={(e) => e.stopPropagation()}>
        <header className="panel__head secrets__head">
          <h2>Mute list</h2>
          <span className="tag" title="Kind 10000, the list every nostr client reads">{loaded ? `${people.length} BLOCKED` : 'READING…'}</span>
          <button className="targets__remove secrets__close" onClick={onClose} aria-label="Close" title="Close">✕</button>
        </header>

        {locked && (
          <div className="mutes__row">
            <span className="mutes__locked" title="Your signer could not open the private part. The last copy read on this device is used, and nothing can be changed until it opens.">PRIVATE PART LOCKED</span>
            <button className="identity__change" onClick={() => void useMutes.getState().refresh({ retry: true })} disabled={busy} title="Ask your signer to open it again">
              <RefreshCw size={10} strokeWidth={2.25} aria-hidden /> RETRY
            </button>
          </div>
        )}

        <ul className="avatars__list mutes__list">
          {people.length === 0 && things.length === 0 && <li className="mutes__empty">{loaded ? 'NOBODY BLOCKED' : 'READING…'}</li>}
          {people.map((pk) => (
            <li key={pk} className="mutes__row">
              <ProfileBadge pubkey={pk} tappable />
              {isPublic(pk, pub.pubkeys) && <span className="tag" title="Written in public, by this app or another">PUBLIC</span>}
              <button className="identity__change" disabled={busy} onClick={async () => refused(await useMutes.getState().unblock(pk))} title="Remove them from your mute list">
                <Undo2 size={10} strokeWidth={2.25} aria-hidden /> UNBLOCK
              </button>
            </li>
          ))}
          {things.map((id) => (
            <li key={id} className="mutes__row">
              <span className="mutes__item" title={id}>ITEM {shortHex(id, 8, 6)}</span>
              {isPublic(id, pub.items) && <span className="tag" title="Written in public, by this app or another">PUBLIC</span>}
              <button className="identity__change" disabled={busy} onClick={async () => refused(await useMutes.getState().unmuteItem(id))} title="Remove it from your mute list">
                <Undo2 size={10} strokeWidth={2.25} aria-hidden /> UNMUTE
              </button>
            </li>
          ))}
        </ul>
        {refusal && <p className="secret__status" role="status">{refusal}</p>}
      </div>
    </div>,
    document.body,
  )
}
