/**
 * ProfileView.tsx: someone's profile, read whole (arkinox, 2026-10-20: "add
 * a modal that can pop up and show an npub's kind 0 profile richly when you
 * tap on their profile pic circle or name"). Opened by ProfileTap wherever a
 * picture or a name is shown, over whatever card or panel showed it.
 *
 * The newest kind 0 is asked of the same relays the profile editor reads
 * (the general profile relays and yours), and shown as its author wrote it:
 * banner, picture, display name and name, NIP-05, npub with COPY, about,
 * website and lightning address. An agent (NIP-24 `bot: true`) carries the
 * AGENT badge and the operator it names, who opens in turn. Your own has
 * EDIT PROFILE. Under a rule, the kind 0 itself (EventData).
 */

import { useEffect, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { Bot, Copy, Pencil } from 'lucide-react'
import { GENERAL_RELAYS } from '../lib/contacts'
import type { NostrEvent } from '../lib/events'
import { queryAny, relaySet } from '../lib/relay'
import { isHttpUrl, newest, parseContent } from '../lib/profileEdit'
import { shortHex } from '../lib/time'
import { useProfile } from '../hooks/useProfile'
import { useEscape } from '../hooks/useEscape'
import { operatorOf, profileLabel } from '../store/useProfiles'
import { useCyberspace } from '../store/useCyberspace'
import { useProfileView } from '../store/useProfileView'
import { ProfilePic, ProfileTap } from './ProfileBadge'
import { EventData } from './EventData'

/** How long to wait on the relays for the kind 0, as the editor does. */
const FETCH_WAIT_MS = 5000
const COPIED_MS = 1400

function profileRelays(): string[] {
  return [...new Set([...GENERAL_RELAYS, ...relaySet()])]
}

export function ProfileView(): JSX.Element | null {
  const pubkey = useProfileView((s) => s.pubkey)
  const close = useProfileView((s) => s.close)
  useEscape('modal', pubkey !== null, close)
  if (!pubkey) return null
  return <ProfileCard key={pubkey} pubkey={pubkey} onClose={close} />
}

/** A field of the kind 0's content, as a non-empty string, or null. */
function field(content: Record<string, unknown> | null, key: string): string | null {
  const v = content?.[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function ProfileCard({ pubkey, onClose }: { pubkey: string; onClose: () => void }): JSX.Element {
  const cached = useProfile(pubkey)
  const me = useCyberspace((s) => s.identity.pubkey)
  const [event, setEvent] = useState<NostrEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)
  // The URL that failed, not a flag: a newer picture from the relays is still tried.
  const [brokenPic, setBrokenPic] = useState<string | null>(null)
  const [brokenBanner, setBrokenBanner] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    queryAny(profileRelays(), { kinds: [0], authors: [pubkey] }, FETCH_WAIT_MS)
      .then((found) => { if (alive) setEvent(newest(found, pubkey, 0)) })
      .catch(() => { /* relays down: the cached profile stands */ })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [pubkey])

  const content = event ? parseContent(event.content) : null
  const npub = nip19.npubEncode(pubkey)
  const displayName = field(content, 'display_name')
  const handle = field(content, 'name')
  const name = displayName ?? handle ?? profileLabel(cached, npub)
  const picture = field(content, 'picture') ?? cached?.picture ?? null
  const banner = field(content, 'banner')
  const about = field(content, 'about') ?? cached?.about ?? null
  const nip05 = (field(content, 'nip05') ?? cached?.nip05 ?? '').replace(/^_@/, '') || null
  const website = field(content, 'website')
  const lightning = field(content, 'lud16') ?? field(content, 'lud06')
  // From the fresh kind 0 once it is here; the cached profile until then.
  const bot = event ? content?.bot === true : cached?.bot === true
  const operator = bot ? (event ? operatorOf(event.tags) : cached?.operator ?? null) : null
  const showBanner = banner !== null && isHttpUrl(banner) && brokenBanner !== banner
  const operatorProfile = useProfile(operator)
  const mine = pubkey === me

  const copy = (what: string, value: string): void => {
    navigator.clipboard?.writeText(value).catch(() => {})
    setCopied(what)
    window.setTimeout(() => setCopied((c) => (c === what ? null : c)), COPIED_MS)
  }

  return (
    <div className="modal modal--top modal--profile" role="dialog" aria-modal="true" aria-label={`${name}, profile`} onPointerDown={onClose}>
      <div className="modal__card secret profilev" onPointerDown={(e) => e.stopPropagation()}>
        <div className="secret__head">
          <span className="secret__badge">PROFILE</span>
          {bot && <span className="person__bot" title="This profile says it is a bot (NIP-24)"><Bot size={11} strokeWidth={2.25} aria-hidden />AGENT</span>}
          {mine && <span className="secret__mine">YOU</span>}
          <button className="secret__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {showBanner && (
          <img className="profilev__banner" src={banner} alt="" referrerPolicy="no-referrer" onError={() => setBrokenBanner(banner)} />
        )}

        <div className={`profilev__who ${showBanner ? 'profilev__who--under-banner' : ''}`}>
          {picture && isHttpUrl(picture) && brokenPic !== picture
            ? <img className="pfp profilev__pic" src={picture} alt="" referrerPolicy="no-referrer" onError={() => setBrokenPic(picture)} />
            : <span className="profilev__pic-fallback"><ProfilePic pubkey={pubkey} size={72} /></span>}
          <div className="profilev__names">
            <span className="profilev__name">{name}{mine ? ' (you)' : ''}</span>
            {displayName && handle && handle !== displayName && <span className="profilev__handle">@{handle}</span>}
            {nip05 && <span className="secret__nip05">{nip05}</span>}
            <span className="person__npub">
              <span className="secret__npub" title={npub}>{shortHex(npub, 14, 8)}</span>
              <button className="person__copy" onClick={() => copy('npub', npub)} title="Copy the npub" aria-label="Copy the npub">
                <Copy size={10} strokeWidth={2.25} aria-hidden />{copied === 'npub' ? 'COPIED' : 'COPY'}
              </button>
            </span>
          </div>
        </div>

        {about && <p className="profilev__about">{about}</p>}

        {(website || lightning || operator) && (
          <dl className="profilev__facts">
            {website && (
              <div>
                <dt>Website</dt>
                <dd>{isHttpUrl(website)
                  ? <a href={website} target="_blank" rel="noopener noreferrer">{website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>
                  : website}</dd>
              </div>
            )}
            {lightning && (
              <div>
                <dt>Lightning</dt>
                <dd><button className="eventdata__value" title="Tap to copy" onClick={() => copy('lightning', lightning)}>{copied === 'lightning' ? 'COPIED' : lightning}</button></dd>
              </div>
            )}
            {operator && (
              <div>
                <dt>Operator</dt>
                <dd>
                  <ProfileTap pubkey={operator} className="profilev__operator">
                    <ProfilePic pubkey={operator} size={16} />
                    <span>{profileLabel(operatorProfile, nip19.npubEncode(operator))}{operator === me ? ' (you)' : ''}</span>
                  </ProfileTap>
                </dd>
              </div>
            )}
          </dl>
        )}

        {!event && loading && <p className="profilev__status" role="status">LOOKING FOR THIS PROFILE ON THE RELAYS…</p>}
        {!event && !loading && <p className="profilev__status" role="status">No profile found on the relays.</p>}

        {mine && (
          <div className="secret__actions profilev__actions">
            <button className="secret__act" onClick={() => useProfileView.getState().edit()}><Pencil size={12} strokeWidth={2.25} aria-hidden />EDIT PROFILE</button>
          </div>
        )}

        {event && (
          <>
            <hr className="secret__rule" />
            <EventData event={event} />
          </>
        )}
      </div>
    </div>
  )
}
