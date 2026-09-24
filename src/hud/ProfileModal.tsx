/**
 * ProfileModal.tsx - who you are, to everyone else.
 *
 * Your kind 0 is what every nostr client shows beside your key: a name, a
 * picture, a line about you. This edits it from inside ONOSENDAI and
 * publishes it to the general relays where profiles live (contacts.ts) and to
 * every relay you have configured. The newest kind 0 is fetched first and the
 * edits are laid over it (lib/profileEdit), so fields other clients wrote and
 * this one never shows survive the round trip.
 *
 * A picture or a banner is a file, and a file needs a public home: a Blossom
 * server (lib/blossom). Your own server list (kind 10063) comes first, then
 * a few public servers that take browser uploads; a server you type is
 * remembered on this device. The upload is signed by your signer the same
 * way a hop is, so a bunker or an extension will ask.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GENERAL_RELAYS } from '../lib/contacts'
import type { NostrEvent } from '../lib/events'
import { publishMany, queryAny, relaySet } from '../lib/relay'
import { DEFAULT_BLOSSOM_SERVERS, SERVER_LIST_KIND, explainUpload, normalizeServer, serversFromList, uploadBlob } from '../lib/blossom'
import { fieldsOf, mergeProfile, newest, parseContent, profileProblems, profileTemplate, type ProfileField, type ProfileFields } from '../lib/profileEdit'
import { shortHex } from '../lib/time'
import { ProfilePic } from './ProfileBadge'
import { useCyberspace } from '../store/useCyberspace'
import { useProfiles } from '../store/useProfiles'

const SERVER_KEY = 'onosendai:blossom-server'
/** How long to wait on the general relays for the current kind 0 and server list. */
const FETCH_WAIT_MS = 5000
/** A person is reading the prompt, as for an avatar. */
const SIGN_PATIENCE_MS = 120_000
/** The upload token is small and the prompt says what it is for. */
const UPLOAD_SIGN_PATIENCE_MS = 60_000
/** The select's value for "type a server". */
const CUSTOM = 'custom'

const SIGNER_NOTE: Record<string, string> = {
  local: 'This profile belongs to the key generated on this device. Export the key (CHANGE) before you invest in it.',
  nip07: 'Your extension will ask you to sign the profile, and once per upload.',
  nip46: 'Your bunker will ask you to sign the profile, and once per upload.',
}

const LABEL: Record<ProfileField, string> = {
  display_name: 'Display name',
  name: 'Username',
  about: 'About',
  picture: 'Picture',
  banner: 'Banner',
  website: 'Website',
  nip05: 'NIP-05 address',
  lud16: 'Lightning address',
}
const PLACEHOLDER: Record<ProfileField, string> = {
  display_name: 'Case',
  name: 'case',
  about: 'A few words. Other clients show this under your name.',
  picture: 'https://… or UPLOAD',
  banner: 'https://… or UPLOAD',
  website: 'https://',
  nip05: 'you@example.com',
  lud16: 'you@getalby.com',
}
const TEXT_FIELDS: ProfileField[] = ['display_name', 'name', 'website', 'nip05', 'lud16']

/** Profiles live on the general relays; yours may also live on the relays you added. */
function profileRelays(): string[] {
  return [...new Set([...GENERAL_RELAYS, ...relaySet()])]
}

function savedServer(): string | null {
  try {
    return normalizeServer(localStorage.getItem(SERVER_KEY) ?? '')
  } catch {
    return null
  }
}

type Status = { kind: 'ok' | 'err' | 'note'; text: string }

export function ProfileModal({ onClose }: { onClose: () => void }): JSX.Element {
  const identity = useCyberspace((s) => s.identity)
  const signerKind = useCyberspace((s) => s.signerKind)

  const [existing, setExisting] = useState<NostrEvent | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [fields, setFields] = useState<ProfileFields>({})
  const [servers, setServers] = useState<string[]>(DEFAULT_BLOSSOM_SERVERS)
  const [server, setServer] = useState<string>(() => savedServer() ?? DEFAULT_BLOSSOM_SERVERS[0])
  const [custom, setCustom] = useState('')
  const [uploading, setUploading] = useState<'picture' | 'banner' | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [pictureBroken, setPictureBroken] = useState(false)
  const pictureInput = useRef<HTMLInputElement>(null)
  const bannerInput = useRef<HTMLInputElement>(null)

  // The current kind 0 and the Blossom list, in one query. Guarded against an
  // identity switch while the relays answer: the old key's profile must not
  // land in the new key's form.
  useEffect(() => {
    const me = identity.pubkey
    let alive = true
    setLoaded(false)
    void (async () => {
      let events: NostrEvent[] = []
      try {
        events = await queryAny(profileRelays(), { kinds: [0, SERVER_LIST_KIND], authors: [me] }, FETCH_WAIT_MS)
      } catch { /* relays down: start from a blank form */ }
      if (!alive) return
      const kind0 = newest(events, me, 0)
      setExisting(kind0)
      setFields(fieldsOf(kind0 ? parseContent(kind0.content) : null))
      const mine = serversFromList(newest(events, me, SERVER_LIST_KIND))
      if (mine.length > 0) {
        setServers([...mine, ...DEFAULT_BLOSSOM_SERVERS.filter((s) => !mine.includes(s))])
        // Your own first server is the default unless this device already chose one.
        if (!savedServer()) setServer(mine[0])
      }
      setLoaded(true)
    })()
    return () => { alive = false }
  }, [identity.pubkey])

  const set = (f: ProfileField, v: string): void => setFields((prev) => ({ ...prev, [f]: v }))

  const chosenServer = (): string | null => (server === CUSTOM ? normalizeServer(custom) : server)

  const upload = async (field: 'picture' | 'banner', file: File | undefined): Promise<void> => {
    if (!file || uploading || busy) return
    const target = chosenServer()
    if (!target) {
      setStatus({ kind: 'err', text: 'Enter a server first, like https://blossom.band.' })
      return
    }
    const host = target.replace(/^https?:\/\//, '')
    setUploading(field)
    setStatus({ kind: 'note', text: `Signing the upload for ${host}. Your signer may ask.` })
    try {
      const desc = await uploadBlob(target, file, (t) => useCyberspace.getState().signEvent(t, UPLOAD_SIGN_PATIENCE_MS))
      set(field, desc.url)
      if (field === 'picture') setPictureBroken(false)
      setStatus({ kind: 'ok', text: `Uploaded to ${host} (${Math.max(1, Math.round(file.size / 1024))} KB). Publish the profile to use it.` })
      try { localStorage.setItem(SERVER_KEY, target) } catch { /* private mode */ }
    } catch (e) {
      setStatus({ kind: 'err', text: explainUpload(e) })
    } finally {
      setUploading(null)
    }
  }

  const publish = async (): Promise<void> => {
    if (busy || uploading) return
    const problems = profileProblems(fields)
    if (problems.length > 0) {
      setStatus({ kind: 'err', text: problems[0] })
      return
    }
    setBusy(true)
    setStatus({ kind: 'note', text: 'Sign the profile. Your signer may ask.' })
    try {
      const content = mergeProfile(existing ? parseContent(existing.content) : null, fields)
      const template = profileTemplate(content, Math.floor(Date.now() / 1000), existing)
      const event = await useCyberspace.getState().signEvent(template, SIGN_PATIENCE_MS)
      const result = await publishMany(profileRelays(), event)
      if (!result.ok) {
        setStatus({ kind: 'err', text: `No relay took the profile (${result.reason}). Try again when one is reachable.` })
        return
      }
      useProfiles.getState().remember(event)
      onClose()
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error && e.message ? e.message : 'The signer did not sign the profile.' })
    } finally {
      setBusy(false)
    }
  }

  const locked = busy || uploading !== null
  const picture = (fields.picture ?? '').trim()
  const banner = (fields.banner ?? '').trim()
  const relayHosts = profileRelays().map((r) => r.replace('wss://', '')).join(', ')

  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label="Your profile" onPointerDown={onClose}>
      <div className="modal__card login profile" onPointerDown={(e) => e.stopPropagation()}>
        <div className="login__head">
          <h2 className="modal__title">Profile</h2>
          <button className="secret__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={`profile__banner${banner ? '' : ' profile__banner--empty'}`} style={banner ? { backgroundImage: `url("${banner}")` } : undefined} aria-hidden="true">
          {!banner && 'NO BANNER'}
        </div>

        <div className="login__current" style={{ marginTop: 8 }}>
          {picture && !pictureBroken
            ? <img className="pfp" style={{ width: 40, height: 40, minWidth: 40 }} src={picture} alt="" referrerPolicy="no-referrer" onError={() => setPictureBroken(true)} />
            : <ProfilePic pubkey={identity.pubkey} size={40} />}
          <div className="login__current-text">
            <span className="secret__name">{(fields.display_name ?? fields.name ?? '').trim() || 'Unnamed'}</span>
            <span className="login__kind">{loaded ? (existing ? 'EDITING YOUR PROFILE' : 'NO PROFILE YET') : 'READING THE RELAYS…'}</span>
            <span className="secret__npub" title={identity.npub}>{shortHex(identity.npub, 14, 8)}</span>
          </div>
        </div>

        <p className="login__note">{SIGNER_NOTE[signerKind] ?? ''} Fields you leave alone stay as other clients wrote them.</p>

        <div className="login__section">
          <label className="login__label" htmlFor="profile-server">Where uploads go (a Blossom server)</label>
          <div className="profile__server">
            <select id="profile-server" className="avatars__input login__input profile__select" value={server} onChange={(e) => setServer(e.target.value)} disabled={locked}>
              {servers.map((s) => <option key={s} value={s}>{s.replace(/^https?:\/\//, '')}{DEFAULT_BLOSSOM_SERVERS.includes(s) ? '' : ' (yours)'}</option>)}
              <option value={CUSTOM}>Another server…</option>
            </select>
            {server === CUSTOM && (
              <input className="avatars__input login__input" type="url" placeholder="https://blossom.example.com" value={custom} onChange={(e) => setCustom(e.target.value)} spellCheck={false} disabled={locked} />
            )}
          </div>
        </div>

        <div className="login__section profile__fields">
          <div>
            <label className="login__label" htmlFor="profile-picture">{LABEL.picture}</label>
            <div className="profile__row">
              <input id="profile-picture" className="avatars__input login__input" type="url" placeholder={PLACEHOLDER.picture} value={fields.picture ?? ''} onChange={(e) => { set('picture', e.target.value); setPictureBroken(false) }} spellCheck={false} disabled={locked} />
              <button className="profile__upload" onClick={() => pictureInput.current?.click()} disabled={locked}>{uploading === 'picture' ? 'UPLOADING…' : 'UPLOAD'}</button>
              <input ref={pictureInput} type="file" accept="image/*" hidden onChange={(e) => { void upload('picture', e.target.files?.[0]); e.target.value = '' }} />
            </div>
          </div>
          <div>
            <label className="login__label" htmlFor="profile-banner">{LABEL.banner}</label>
            <div className="profile__row">
              <input id="profile-banner" className="avatars__input login__input" type="url" placeholder={PLACEHOLDER.banner} value={fields.banner ?? ''} onChange={(e) => set('banner', e.target.value)} spellCheck={false} disabled={locked} />
              <button className="profile__upload" onClick={() => bannerInput.current?.click()} disabled={locked}>{uploading === 'banner' ? 'UPLOADING…' : 'UPLOAD'}</button>
              <input ref={bannerInput} type="file" accept="image/*" hidden onChange={(e) => { void upload('banner', e.target.files?.[0]); e.target.value = '' }} />
            </div>
          </div>
          {TEXT_FIELDS.map((f) => (
            <div key={f}>
              <label className="login__label" htmlFor={`profile-${f}`}>{LABEL[f]}</label>
              <input id={`profile-${f}`} className="avatars__input login__input" type="text" placeholder={PLACEHOLDER[f]} value={fields[f] ?? ''} onChange={(e) => set(f, e.target.value)} spellCheck={false} autoComplete="off" disabled={locked} />
            </div>
          ))}
          <div>
            <label className="login__label" htmlFor="profile-about">{LABEL.about}</label>
            <textarea id="profile-about" className="profile__textarea" placeholder={PLACEHOLDER.about} value={fields.about ?? ''} onChange={(e) => set('about', e.target.value)} rows={3} disabled={locked} />
          </div>
        </div>

        {status && <p className={`profile__status profile__status--${status.kind}`}>{status.text}</p>}

        <div className="login__section login__section--row">
          <button className="secret__act login__act" onClick={onClose} disabled={busy}>CANCEL</button>
          <button className="secret__act login__act" onClick={() => void publish()} disabled={locked || !loaded}>{busy ? 'SIGNING…' : 'PUBLISH PROFILE'}</button>
        </div>
        <p className="login__note" style={{ margin: '10px 0 0', fontSize: 10 }}>Goes to {relayHosts}.</p>
      </div>
    </div>,
    document.body,
  )
}
