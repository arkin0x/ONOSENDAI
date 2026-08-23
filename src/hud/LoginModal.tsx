/**
 * LoginModal.tsx — choosing who signs.
 *
 * The avatar starts life as a random key so cyberspace is explorable the
 * instant the page loads, with nothing to set up. This is where that gets
 * overridden: bring an nsec or an encrypted ncryptsec, hand signing to a
 * browser extension (NIP-07) or a remote bunker (NIP-46), or roll a fresh
 * random key. Anything but the random key is a real identity, so switching to
 * one you have moved before drops you back onto that chain; a new one spawns
 * where its pubkey lands (spec §3.1).
 *
 * The store owns the actual switch and the async handshakes; this only gathers
 * input, shows what went wrong, and closes once a switch has taken.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { hasNip07 } from '../lib/signers'
import { shortHex } from '../lib/time'
import { ProfilePic } from './ProfileBadge'
import { useProfile } from '../hooks/useProfile'
import { profileLabel } from '../store/useProfiles'
import { useCyberspace } from '../store/useCyberspace'

const KIND_LABEL: Record<string, string> = {
  local: 'Local key',
  nip07: 'Browser extension',
  nip46: 'Remote bunker',
}

export function LoginModal({ onClose }: { onClose: () => void }): JSX.Element {
  const identity = useCyberspace((s) => s.identity)
  const signerKind = useCyberspace((s) => s.signerKind)
  const loginError = useCyberspace((s) => s.loginError)
  const profile = useProfile(identity.pubkey)

  const [key, setKey] = useState('')
  const [password, setPassword] = useState('')
  const [bunker, setBunker] = useState('')
  // Which action is mid-flight, so its button can say so and the rest lock.
  const [busy, setBusy] = useState<string | null>(null)

  // A stale error from a previous visit should not greet the next one.
  useEffect(() => {
    useCyberspace.getState().clearLoginError()
    return () => useCyberspace.getState().clearLoginError()
  }, [])

  const name = profileLabel(profile, identity.npub)
  const encrypted = key.trim().startsWith('ncryptsec')
  const extension = hasNip07()

  // Run a store switch, then close if it took. A switch clears loginError on
  // success and sets it on failure, so the error state is the whole verdict.
  const run = async (id: string, fn: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(id)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
    if (!useCyberspace.getState().loginError) onClose()
  }

  const cy = useCyberspace.getState
  const useKey = (): Promise<void> =>
    run('key', () => (encrypted ? cy().useNcryptsec(key, password) : cy().useNsec(key)))
  const connectBunker = (): Promise<void> => run('bunker', () => cy().useBunker(bunker))
  const useExtension = (): Promise<void> => run('nip07', () => cy().useExtension())
  const generate = (): Promise<void> => run('new', () => cy().useNewKey())

  const disabled = busy !== null
  const busyLabel = (id: string, label: string): string => (busy === id ? 'WORKING…' : label)

  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label="Identity" onPointerDown={onClose}>
      <div className="modal__card login" onPointerDown={(e) => e.stopPropagation()}>
        <div className="login__head">
          <h2 className="modal__title">Identity</h2>
          <button className="secret__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="login__current">
          <ProfilePic pubkey={identity.pubkey} size={40} />
          <div className="login__current-text">
            <span className="secret__name">{name}</span>
            <span className="login__kind">{KIND_LABEL[signerKind] ?? signerKind}</span>
            <span className="secret__npub" title={identity.npub}>{shortHex(identity.npub, 14, 8)}</span>
          </div>
        </div>

        <p className="login__note">
          Switching signs a fresh spawn at the new key's coordinate. An identity
          you have moved before returns to its own chain; a new one starts over.
        </p>

        {loginError && <p className="notice login__error">{loginError}</p>}

        <div className="login__section">
          <label className="login__label" htmlFor="login-key">Paste an nsec or ncryptsec</label>
          <input
            id="login-key"
            className="avatars__input login__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="nsec1… or ncryptsec1…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          {encrypted && (
            <input
              className="avatars__input login__input"
              type="password"
              autoComplete="off"
              placeholder="ncryptsec password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
          <button
            className="secret__act login__act"
            disabled={disabled || !key.trim() || (encrypted && !password)}
            onClick={useKey}
          >{busyLabel('key', 'USE THIS KEY')}</button>
        </div>

        <div className="login__section">
          <label className="login__label" htmlFor="login-bunker">Connect a remote bunker (NIP-46)</label>
          <input
            id="login-bunker"
            className="avatars__input login__input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="bunker://…"
            value={bunker}
            onChange={(e) => setBunker(e.target.value)}
          />
          <button
            className="secret__act login__act"
            disabled={disabled || !bunker.trim()}
            onClick={connectBunker}
          >{busyLabel('bunker', 'CONNECT BUNKER')}</button>
        </div>

        <div className="login__section login__section--row">
          <button
            className="secret__act login__act"
            disabled={disabled || !extension}
            onClick={useExtension}
            title={extension ? '' : 'No NIP-07 extension detected'}
          >{busyLabel('nip07', extension ? 'USE EXTENSION' : 'NO EXTENSION')}</button>
          <button
            className="secret__act login__act"
            disabled={disabled}
            onClick={generate}
          >{busyLabel('new', 'NEW RANDOM KEY')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
