/**
 * PersonModal.tsx: the card a tap on someone's avatar opens (arkinox,
 * 2026-10-11, looking at his agent XOR's new avatar next to him: "I want to
 * copy his avatar but don't have the controls to do it through ONOSENDAI. I
 * should be able to tap on his avatar to see his profile modal overlay plus
 * an avatar preview (spinning preview) and copy to workshop button").
 *
 * Who they are: picture, name, NIP-05 and npub (with COPY). An agent (a
 * kind 0 with NIP-24 `bot: true`) carries the AGENT badge, and the operator
 * its profile names, when it names one. Their avatar turning slowly
 * (ShardSpin), and COPY TO WORKSHOP, which copies the shard into your
 * workshop credited to them (store/usePersonCard copyAvatarToWorkshop) and
 * says COPIED on the button, as the other copies do. Someone still drawn as
 * the default dodecahedron has no shard to show or copy, so the card is the
 * profile alone. TARGET and SPECTATE are here too, as on a hidden item's card.
 *
 * CHAT (arkinox, 2026-10-13: "opens the local chat and inserts the @tag for
 * them at the beginning of the message") closes the card and unfolds the dock
 * with "@Name " at the start of the line, picked as the @ list picks, so the
 * line goes out tagging them. It says why when chat cannot be used from here.
 * The actions sit two to a row.
 */

import { useState, type ComponentType } from 'react'
import { nip19 } from 'nostr-tools'
import { Bot, Copy, Crosshair, Eye, Box, MessageSquare } from 'lucide-react'
import type { ShardModel } from 'sno-core/shards'
import { ProfilePic } from './ProfileBadge'
import { useProfile } from '../hooks/useProfile'
import { useEscape } from '../hooks/useEscape'
import { profileLabel } from '../store/useProfiles'
import { useCyberspace } from '../store/useCyberspace'
import { useAvatarShard } from '../store/useAvatars'
import { copyAvatarToWorkshop, usePersonCard } from '../store/usePersonCard'
import { spectate } from '../lib/spectator'
import { shortHex } from '../lib/time'
import { ShardSpin } from '../scene/ShardSpin'
import { sendKey, useChat } from '../store/useChat'
import { useSecrets } from '../store/useSecrets'

/** How long COPIED stays on a button, as on a hidden item's card. */
const COPIED_MS = 1400
const ICON = 12

export function PersonModal(): JSX.Element | null {
  const pubkey = usePersonCard((s) => s.pubkey)
  const close = usePersonCard((s) => s.close)
  // Escape closes it as a tap outside does; registered on the modal layer,
  // which also hides the pad while the card is up (useModalUp).
  useEscape('modal', pubkey !== null, close)
  if (!pubkey) return null
  return <PersonCardLive pubkey={pubkey} onClose={close} />
}

/** The card with the avatar this client draws for `pubkey` (useAvatars). */
function PersonCardLive({ pubkey, onClose }: { pubkey: string; onClose: () => void }): JSX.Element {
  const shard = useAvatarShard(pubkey)
  return <PersonCard pubkey={pubkey} shard={shard} onClose={onClose} />
}

interface CardProps {
  pubkey: string
  /** Their avatar shard, or null for the default dodecahedron. */
  shard: ShardModel | null
  onClose: () => void
  /** What draws the turning avatar; a test stands in a plain one. */
  Preview?: ComponentType<{ shard: ShardModel }>
}

export function PersonCard({ pubkey, shard, onClose, Preview = ShardSpin }: CardProps): JSX.Element {
  const profile = useProfile(pubkey)
  const operator = profile?.bot ? profile.operator ?? null : null
  const operatorProfile = useProfile(operator)
  const me = useCyberspace((s) => s.identity.pubkey)
  const targeted = useCyberspace((s) => !!s.targets[pubkey])
  const [copied, setCopied] = useState<'npub' | 'shard' | null>(null)
  // Why a line cannot be said from here, in the chat line's own words; null when it can.
  const atHead = useCyberspace((s) => s.atHead())
  const hasKey = useSecrets((s) => s.current) && sendKey() !== null
  const noChat = chatUnavailable(atHead, hasKey)

  const npub = nip19.npubEncode(pubkey)
  const name = profileLabel(profile, npub)
  const mine = pubkey === me
  const flash = (what: 'npub' | 'shard'): void => {
    setCopied(what)
    window.setTimeout(() => setCopied((c) => (c === what ? null : c)), COPIED_MS)
  }
  const copyNpub = (): void => { void navigator.clipboard?.writeText(npub); flash('npub') }
  const copyShard = (): void => {
    if (!shard) return
    copyAvatarToWorkshop(shard, pubkey, me)
    flash('shard')
  }
  const target = (): void => useCyberspace.getState().toggleTarget(pubkey, profile?.name ?? null)
  const watch = (): void => { onClose(); void spectate(pubkey) }
  const chat = (): void => {
    if (noChat) return
    onClose()
    useChat.getState().startTo({ pubkey, label: name })
  }
  const hasShard = !!shard && shard.vertices.length > 0

  return (
    <div className="modal modal--top" role="dialog" aria-modal="true" aria-label={`${name}, profile`} onPointerDown={onClose}>
      <div className="modal__card secret person" onPointerDown={(e) => e.stopPropagation()}>
        <div className="secret__head">
          <span className="secret__badge">AVATAR</span>
          {profile?.bot && <span className="person__bot" title="This profile says it is a bot (NIP-24)"><Bot size={11} strokeWidth={2.25} aria-hidden />AGENT</span>}
          {mine && <span className="secret__mine">YOU</span>}
          <button className="secret__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="secret__creator">
          <div className="secret__person">
            <ProfilePic pubkey={pubkey} size={40} />
            <div className="secret__person-text">
              <span className="secret__name">{name}</span>
              {profile?.nip05 && <span className="secret__nip05">{profile.nip05.replace(/^_@/, '')}</span>}
              <span className="person__npub">
                <span className="secret__npub" title={npub}>{shortHex(npub, 14, 8)}</span>
                <button className="person__copy" onClick={copyNpub} title="Copy the npub" aria-label="Copy the npub">
                  <Copy size={10} strokeWidth={2.25} aria-hidden />{copied === 'npub' ? 'COPIED' : 'COPY'}
                </button>
              </span>
            </div>
          </div>
          {operator && (
            <div className="person__operator">
              <span className="secret__label">Operator</span>
              <ProfilePic pubkey={operator} size={16} />
              <span className="person__operator-name" title={nip19.npubEncode(operator)}>{profileLabel(operatorProfile, nip19.npubEncode(operator))}{operator === me ? ' (you)' : ''}</span>
            </div>
          )}
        </div>

        {hasShard && shard && (
          <div className="person__avatar">
            <Preview shard={shard} />
            <span className="secret__shard-name">{shard.name}</span>
            <span className="secret__shard-meta">{shard.vertices.length} v · {shard.faces.length} f · {shard.mode.toUpperCase()} · unit 2^{shard.unit}</span>
          </div>
        )}

        <div className="secret__actions person__actions">
          {hasShard && (
            <button className="secret__act" onClick={copyShard} title="Copy this avatar into your workshop, credited to its author">
              <Box size={ICON} strokeWidth={2.25} aria-hidden />{copied === 'shard' ? 'COPIED' : 'COPY TO WORKSHOP'}
            </button>
          )}
          {!mine && (
            <>
              <button className={`secret__act ${targeted ? 'is-on' : ''}`} onClick={target}>
                <Crosshair size={ICON} strokeWidth={2.25} aria-hidden />{targeted ? 'TARGETED' : 'TARGET'}
              </button>
              <button className="secret__act" onClick={watch}><Eye size={ICON} strokeWidth={2.25} aria-hidden />SPECTATE</button>
              <button className="secret__act" onClick={chat} disabled={noChat !== null} title={noChat ?? `Talk to ${name} in local chat, tagged`}>
                <MessageSquare size={ICON} strokeWidth={2.25} aria-hidden />CHAT
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Why CHAT cannot open a line from here, in the chat line's own words, or null when it can. */
export function chatUnavailable(atHead: boolean, hasKey: boolean): string | null {
  if (!atHead) return 'Come back to your head to talk'
  if (!hasKey) return 'Waiting for the scan of where you stand'
  return null
}
