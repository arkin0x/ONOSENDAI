/**
 * KeyLock.tsx - the password a brought key is kept with (lib/keyAtRest.ts).
 *
 * KeyLockGate: over everything while the key in use needs the person
 * (store keyLock). 'unlock' asks for the password once per visit; 'set' asks
 * for a password to keep an old plain key, and NOT NOW leaves it out of
 * storage after one confirm; 'gone' says the key is not here and offers the
 * login. It has no close: while a key is locked nothing signs, so the way out
 * is to unlock it or to choose another identity (LoginModal), never to keep
 * playing behind it.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LockKeyhole } from 'lucide-react'
import { shortHex } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { useProfile } from '../hooks/useProfile'
import { profileLabel } from '../store/useProfiles'
import { ProfilePic } from './ProfileBadge'
import { LoginModal } from './LoginModal'
import { NewPassword, newPasswordReady } from './ui/NewPassword'
import { useEscape } from '../hooks/useEscape'
import { copyText } from '../lib/copyText'
import { nip19 } from 'nostr-tools'

const MODE_TITLE = { unlock: 'Unlock your key', set: 'Set a password', gone: 'Log in again' } as const
const MODE_STATE = { unlock: 'ENCRYPTED ON THIS DEVICE', set: 'NOT ENCRYPTED YET', gone: 'KEY NOT SAVED ON THIS DEVICE' } as const

export function KeyLockGate(): JSX.Element | null {
  const lock = useCyberspace((s) => s.keyLock)
  const error = useCyberspace((s) => s.keyLockError)
  const pubkey = lock?.pubkey ?? ''
  const profile = useProfile(pubkey || null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const [copied, setCopied] = useState(false)
  // Escape under the gate closes nothing: the gate is the top layer, and it is answered, not closed.
  useEscape('modal', !!lock && !loginOpen, () => {})

  // Another question, a fresh form: nothing typed for the last one carries over.
  useEffect(() => {
    setPassword('')
    setAgain('')
    setSkipping(false)
    setCopied(false)
  }, [lock?.mode, pubkey])

  const login = loginOpen ? <LoginModal over onClose={() => setLoginOpen(false)} /> : null
  if (!lock || loginOpen) return login

  const npub = nip19.npubEncode(lock.pubkey)
  const unlock = async (): Promise<void> => {
    if (busy || !password) return
    setBusy(true)
    const ok = await useCyberspace.getState().unlockKey(password)
    setBusy(false)
    if (!ok) setPassword('')
  }
  const save = async (): Promise<void> => {
    if (busy || !newPasswordReady(password, again)) return
    setBusy(true)
    await useCyberspace.getState().setKeyPassword(password, again)
    setBusy(false)
  }

  const who = (
    <div className="login__current">
      <ProfilePic pubkey={lock.pubkey} size={40} />
      <div className="login__current-text">
        <span className="secret__name">{profileLabel(profile, npub)}</span>
        <span className="login__kind">{MODE_STATE[lock.mode]}</span>
        <span className="secret__npub">{shortHex(npub, 14, 8)}</span>
      </div>
    </div>
  )

  return createPortal(
    <div className="modal keylock-gate" role="dialog" aria-modal="true" aria-label={MODE_TITLE[lock.mode]}>
      <div className="modal__card login keylock">
        <div className="login__head">
          <h2 className="modal__title keylock__title">
            <LockKeyhole size={15} aria-hidden="true" />
            {skipping ? 'Continue without saving?' : MODE_TITLE[lock.mode]}
          </h2>
        </div>
        {who}

        {lock.mode === 'unlock' && (
          <form className="login__primary keylock__form" onSubmit={(event) => { event.preventDefault(); void unlock() }}>
            <input
              className="avatars__input login__input"
              type="password"
              autoComplete="current-password"
              autoFocus
              placeholder="password"
              aria-label="Password"
              value={password}
              onChange={(event) => { setPassword(event.target.value); useCyberspace.setState({ keyLockError: null }) }}
            />
            <p className="keylock__error" role="alert">{error ?? ''}</p>
            <button className="secret__act login__act login__act--primary" type="submit" disabled={busy || !password}>
              {busy && <span className="spin" aria-hidden="true" />}
              {busy ? 'UNLOCKING…' : 'UNLOCK'}
            </button>
            <button type="button" className="secret__act login__act keylock__alt" disabled={busy} onClick={() => setLoginOpen(true)}>USE ANOTHER IDENTITY</button>
          </form>
        )}

        {lock.mode === 'set' && !skipping && (
          <form className="login__primary keylock__form" onSubmit={(event) => { event.preventDefault(); void save() }}>
            <NewPassword
              password={password}
              again={again}
              autoFocus
              onPassword={(value) => { setPassword(value); useCyberspace.setState({ keyLockError: null }) }}
              onAgain={(value) => { setAgain(value); useCyberspace.setState({ keyLockError: null }) }}
            />
            <p className="keylock__error" role="alert">{error ?? ''}</p>
            <button className="secret__act login__act login__act--primary" type="submit" disabled={busy || !newPasswordReady(password, again)}>
              {busy && <span className="spin" aria-hidden="true" />}
              {busy ? 'SAVING…' : 'SAVE WITH PASSWORD'}
            </button>
            <button type="button" className="secret__act login__act keylock__alt" disabled={busy} onClick={() => setSkipping(true)}>NOT NOW</button>
          </form>
        )}

        {lock.mode === 'set' && skipping && (
          <div className="keylock__form">
            <p className="keylock__line">Your key will not be kept on this device. Copy it first if it is not saved anywhere else.</p>
            <div className="keylock__pair">
              <button className="secret__act login__act login__act--primary" autoFocus onClick={() => setSkipping(false)}>SET PASSWORD</button>
              <button className="secret__act login__act" onClick={() => useCyberspace.getState().skipKeyPassword()}>DON'T SAVE KEY</button>
            </div>
            {/* The key itself, to the clipboard on purpose and never shown (as SHOW MY KEY, keyExport.ts exportNsec). */}
            <button
              className="secret__act login__act keylock__alt"
              onClick={() => { void copyText(useCyberspace.getState().revealKey()).then((ok) => setCopied(ok)) }}
            >{copied ? 'COPIED' : 'COPY MY KEY'}</button>
          </div>
        )}

        {lock.mode === 'gone' && (
          <div className="keylock__form">
            <button className="secret__act login__act login__act--primary" onClick={() => setLoginOpen(true)}>LOG IN</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
