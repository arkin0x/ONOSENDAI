/** LoginModal.tsx: one clear door for every supported Nostr identity. */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { nip19 } from 'nostr-tools'
import { Check, ChevronRight, LockKeyhole, Puzzle, Smartphone, type LucideIcon } from 'lucide-react'
import { cachedHeld, heldListed, listHeld, type HeldEntry, type HeldWay } from '../lib/identitiesDb'
import { targetColor } from '../lib/targets'
import {
  createNostrConnectSession,
  DEFAULT_SIGNER_RELAY,
  hasNip07,
  loginCredentialKind,
  normalizeSignerRelay,
} from '../lib/signers'
import { MIN_PASSWORD, backupFileName, exportProblem } from '../lib/keyExport'
import { shortHex } from '../lib/time'
import { ProfilePic, ProfileTap } from './ProfileBadge'
import { useProfile } from '../hooks/useProfile'
import { profileLabel, useProfiles } from '../store/useProfiles'
import { pastedKeyGeneratedHere, useCyberspace } from '../store/useCyberspace'
import { useEscape } from '../hooks/useEscape'
import { ModalClose } from './ui/ModalClose'
import { CopyValue } from './ui/CopyValue'
import { NewPassword, newPasswordReady } from './ui/NewPassword'
import { copyText } from '../lib/copyText'

const KIND_LABEL: Record<string, string> = {
  local: 'Local key',
  nip07: 'Browser extension',
  nip46: 'Remote signer',
}

type View = 'login' | 'qr' | 'held'

/** What each way back looks like at the end of its row: straight in, a password, or the signer that holds it. */
const WAY_ICON: Record<HeldWay, LucideIcon> = {
  generated: ChevronRight,
  password: LockKeyhole,
  extension: Puzzle,
  bunker: Smartphone,
}
const WAY_LABEL: Record<HeldWay, string> = {
  generated: 'Switch now',
  password: 'Needs its password',
  extension: 'Opens your browser extension',
  bunker: 'Asks your remote signer',
}

/**
 * A picture for an identity on this device from the profile cache alone,
 * asking no relay (see HeldRow); the first letter on its colour otherwise.
 */
function CachedPic({ pubkey, size }: { pubkey: string; size: number }): JSX.Element {
  const profile = useProfiles((s) => s.profiles[pubkey])
  const [broken, setBroken] = useState(false)
  const style = { width: size, height: size, minWidth: size } as const
  if (profile?.picture && !broken) {
    return <img className="pfp" style={style} src={profile.picture} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  }
  const initial = (profile?.name ?? nip19.npubEncode(pubkey).slice(4, 5)).slice(0, 1).toUpperCase()
  return <span className="pfp pfp--fallback" style={{ ...style, background: targetColor(pubkey), fontSize: size * 0.5 }} aria-hidden="true">{initial}</span>
}

/**
 * One identity this device holds, in the list at the top of the login
 * (lib/identitiesDb.ts). A tap switches to it, or asks for its password first.
 *
 * Its name and picture come only from profiles already cached here: no relay
 * is asked for them. Asking would send every identity on this device in one
 * request, from a connection that may be signed in as the one in use, and
 * tell the relay they are the same person (review of #824).
 */
function HeldRow({ entry, disabled, onPick }: { entry: HeldEntry; disabled: boolean; onPick: () => void }): JSX.Element {
  const profile = useProfiles((s) => s.profiles[entry.pubkey])
  const npub = nip19.npubEncode(entry.pubkey)
  const Icon = WAY_ICON[entry.way]
  const name = profileLabel(profile, npub)
  // With no profile name the label is the npub already, so it is not said
  // twice. Every row keeps one height either way (.login__held-row min-height).
  const named = name !== profileLabel(null, npub)
  return (
    <button className="login__held-row" disabled={disabled} onClick={onPick} title={WAY_LABEL[entry.way]} aria-label={`${name}. ${WAY_LABEL[entry.way]}`}>
      <CachedPic pubkey={entry.pubkey} size={28} />
      <span className="login__held-text">
        <span className="login__held-name">{name}</span>
        {named && <span className="login__held-npub">{shortHex(npub, 10, 6)}</span>}
      </span>
      <Icon className="login__held-icon" size={15} aria-hidden="true" />
    </button>
  )
}

/** `over`: opened from the key lock (KeyLock.tsx), so it sits at the lock's height, over everything. */
export function LoginModal({ onClose, over = false }: { onClose: () => void; over?: boolean }): JSX.Element {
  const signerKind = useCyberspace((s) => s.signerKind)
  const identity = useCyberspace((s) => s.identity)
  const loginError = useCyberspace((s) => s.loginError)
  // A locked key has nothing in hand to back up.
  const locked = useCyberspace((s) => s.keyLock !== null && s.keyLock.mode !== 'set')
  // Locked with its encrypted key here: it can be copied as a backup before switching.
  const lockedKey = useCyberspace((s) => (s.keyLock?.mode === 'unlock' ? s.lockedNcryptsec() : null))
  const [keyCopied, setKeyCopied] = useState(false)
  const profile = useProfile(identity.pubkey)

  // The identities this device holds (lib/identitiesDb.ts): the last list at
  // once, so nothing jumps when the fresh one arrives a moment later.
  const [held, setHeld] = useState<HeldEntry[]>(cachedHeld)
  const [heldRead, setHeldRead] = useState(heldListed)
  useEffect(() => {
    let live = true
    void listHeld().then((rows) => { if (live) { setHeld(rows); setHeldRead(true) } })
    return () => { live = false }
  }, [])
  // The identity a password is being typed for (view 'held').
  const [picked, setPicked] = useState<HeldEntry | null>(null)
  const pickedProfile = useProfiles((s) => (picked ? s.profiles[picked.pubkey] : undefined))
  const [heldPassword, setHeldPassword] = useState('')
  // The identity in use is the card above, not a row: except when its key is
  // not in hand ('Log in again'), when a row that holds it is the way back.
  const gone = useCyberspace((s) => s.keyLock?.mode === 'gone')
  const others = held.filter((entry) => entry.pubkey !== identity.pubkey || gone)
  // Whether the key in use is kept here, by the store and not only the one
  // pref slot a switch overwrites: then switching away loses nothing.
  const keptHere = held.some((entry) => entry.pubkey === identity.pubkey && (entry.way === 'generated' || entry.way === 'password'))

  const [view, setView] = useState<View>('login')
  const [credential, setCredential] = useState('')
  const [password, setPassword] = useState('')
  // A pasted nsec's new password, typed a second time.
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [relay, setRelay] = useState(DEFAULT_SIGNER_RELAY)
  const [activeRelay, setActiveRelay] = useState(DEFAULT_SIGNER_RELAY)
  const [qrUri, setQrUri] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const [qrConnected, setQrConnected] = useState(false)
  const qrCanvas = useRef<HTMLCanvasElement | null>(null)
  const qrController = useRef<AbortController | null>(null)

  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [backup, setBackup] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    useCyberspace.getState().clearLoginError()
    return () => {
      qrController.current?.abort()
      useCyberspace.getState().clearLoginError()
    }
  }, [])

  useEffect(() => {
    if (!qrUri || !qrCanvas.current) return
    // Loaded with the first QR it draws, not with the app (2026-10-15).
    void import('qrcode').then(({ default: QRCode }) => {
      if (!qrCanvas.current) return
      return QRCode.toCanvas(qrCanvas.current, qrUri, {
        errorCorrectionLevel: 'L',
        margin: 2,
        width: 264,
        color: { dark: '#05070d', light: '#f4fbff' },
      })
    }).catch(() => setQrError('Could not draw the QR code. Use the link below instead.'))
  }, [qrUri])

  const stopQr = (): void => {
    const controller = qrController.current
    qrController.current = null
    controller?.abort()
    setBusy(null)
  }

  const close = (): void => {
    stopQr()
    onClose()
  }

  const run = async (id: string, fn: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(id)
    useCyberspace.getState().clearLoginError()
    try { await fn() } finally { setBusy(null) }
    if (!useCyberspace.getState().loginError) close()
  }

  const submitCredential = (): Promise<void> =>
    run('credential', () => useCyberspace.getState().useLogin(credential, password, again))

  const startQr = (relayInput = relay): void => {
    if (busy && busy !== 'qr') return
    stopQr()
    useCyberspace.getState().clearLoginError()
    setQrError(null)
    setQrConnected(false)

    let session
    try { session = createNostrConnectSession(relayInput) }
    catch (err) {
      setQrError(err instanceof Error ? err.message : String(err))
      return
    }

    const controller = new AbortController()
    qrController.current = controller
    setRelay(session.relay)
    setActiveRelay(session.relay)
    setQrUri(session.uri)
    setView('qr')
    setBusy('qr')

    void useCyberspace.getState().useNostrConnect(session, controller.signal, () => {
      if (qrController.current === controller) setQrConnected(true)
    }).then(() => {
      if (qrController.current !== controller) return
      qrController.current = null
      setBusy(null)
      if (!useCyberspace.getState().loginError) onClose()
    })
  }

  const backToLogin = (): void => {
    stopQr()
    useCyberspace.getState().clearLoginError()
    setQrError(null)
    setQrConnected(false)
    setQrUri(null)
    setPicked(null)
    setHeldPassword('')
    setView('login')
  }

  const pickHeld = (entry: HeldEntry): void => {
    if (busy) return
    useCyberspace.getState().clearLoginError()
    if (entry.way === 'password') {
      setPicked(entry)
      setHeldPassword('')
      setView('held')
      return
    }
    void run('held', () => useCyberspace.getState().useHeld(entry.pubkey))
  }

  const unlockHeld = async (): Promise<void> => {
    if (!picked || !heldPassword) return
    await run('held', () => useCyberspace.getState().useHeld(picked.pubkey, heldPassword))
    // A wrong password keeps the form, emptied, with the reason under it.
    if (useCyberspace.getState().loginError) setHeldPassword('')
  }

  const kind = loginCredentialKind(credential)
  const encrypted = kind === 'ncryptsec'
  // A key this app made here, pasted back, is kept as it always was and asks
  // for no password: the fields would promise encryption that never happens.
  const [madeHere, setMadeHere] = useState<string | null>(null)
  useEffect(() => {
    if (kind !== 'nsec') return
    let live = true
    void pastedKeyGeneratedHere(credential).then((yes) => { if (live) setMadeHere(yes ? credential : null) })
    return () => { live = false }
  }, [credential, kind])
  const generatedPaste = kind === 'nsec' && madeHere === credential
  // A pasted nsec is kept only encrypted, with a password chosen here.
  const plain = kind === 'nsec' && !generatedPaste
  const extension = hasNip07()
  const disabled = busy !== null
  const credentialReady = !!credential.trim() && (!encrypted || !!password) && (!plain || newPasswordReady(password, again))
  // A stopped QR (its relay dropped it) is tried again on the same relay, as
  // a fresh session with a new secret: the button used to stay disabled for
  // that relay, leaving only the way back (snocrash #37 offers the same).
  const sameRelay = ((): boolean => {
    try { return normalizeSignerRelay(relay) === activeRelay } catch { return false }
  })()
  // Escape closes it as a tap outside does (arkinox, 2026-10-01).
  useEscape('modal', true, close)

  return createPortal(
    <div className={over ? 'modal modal--over' : 'modal'} role="dialog" aria-modal="true" aria-label="Change identity" onPointerDown={close}>
      <div className="modal__card login" onPointerDown={(event) => event.stopPropagation()}>
        <div className="login__head">
          <h2 className="modal__title">{view === 'qr' ? 'Nostr Connect' : view === 'held' ? 'Unlock your key' : 'Change Identity'}</h2>
          <ModalClose onClose={close} />
        </div>

        {view === 'login' && (
          <>
            <div className="login__current">
              <ProfileTap pubkey={identity.pubkey}><ProfilePic pubkey={identity.pubkey} size={40} /></ProfileTap>
              <div className="login__current-text">
                <span className="secret__name">{profileLabel(profile, identity.npub)}</span>
                <span className="login__kind">{KIND_LABEL[signerKind] ?? signerKind}</span>
                <CopyValue className="secret__npub" value={identity.npub} shown={shortHex(identity.npub, 14, 8)} />
              </div>
              {others.length > 0 && <Check className="login__current-mark" size={15} aria-label="In use" />}
            </div>
            {others.length > 0 && (
              <div className="login__held" role="group" aria-label="On this device">
                <span className="login__label">On this device</span>
                <div className="login__held-list">
                  {others.map((entry) => (
                    <HeldRow key={entry.pubkey} entry={entry} disabled={disabled} onPick={() => pickHeld(entry)} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {view === 'held' && picked ? (
          <form className="login__primary login__held-unlock" onSubmit={(event) => { event.preventDefault(); void unlockHeld() }}>
            <div className="login__current">
              <CachedPic pubkey={picked.pubkey} size={40} />
              <div className="login__current-text">
                <span className="secret__name">{profileLabel(pickedProfile, nip19.npubEncode(picked.pubkey))}</span>
                <span className="login__kind">ENCRYPTED ON THIS DEVICE</span>
                <span className="secret__npub">{shortHex(nip19.npubEncode(picked.pubkey), 14, 8)}</span>
              </div>
            </div>
            <input
              className="avatars__input login__input"
              type="password"
              autoComplete="current-password"
              autoFocus
              placeholder="password"
              aria-label="Password"
              value={heldPassword}
              onChange={(event) => { setHeldPassword(event.target.value); useCyberspace.getState().clearLoginError() }}
            />
            <p className="keylock__error" role="alert">{loginError ?? ''}</p>
            <button className="secret__act login__act login__act--primary" type="submit" disabled={disabled || !heldPassword}>
              {busy === 'held' && <span className="spin" aria-hidden="true" />}
              {busy === 'held' ? 'UNLOCKING…' : 'UNLOCK'}
            </button>
            <button type="button" className="login__back" disabled={disabled} onClick={backToLogin}>← OTHER LOGIN OPTIONS</button>
          </form>
        ) : view === 'qr' ? (
          <div className="login__qr-flow">
            <p className="login__qr-instruction">Scan with a Nostr signer to connect this identity.</p>
            {qrUri && (
              <a className="login__qr-link" href={qrUri} aria-label="Open Nostr Connect signer">
                <canvas ref={qrCanvas} className="login__qr" width={264} height={264} />
              </a>
            )}
            <p className="login__waiting" role="status">
              {busy === 'qr' && <span className="spin" aria-hidden="true" />}
              {busy === 'qr'
                ? qrConnected ? 'SIGNER CONNECTED, FETCHING PUBLIC KEY…' : 'WAITING FOR SIGNER…'
                : 'CONNECTION STOPPED'}
            </p>

            {(qrError || loginError) && <p className="notice login__error">{qrError ?? loginError}</p>}

            <div className="login__relay">
              <label className="login__label" htmlFor="login-relay">Signer relay</label>
              <input
                id="login-relay"
                className="avatars__input login__input"
                type="url"
                autoComplete="off"
                spellCheck={false}
                value={relay}
                onChange={(event) => setRelay(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') startQr(relay)
                }}
              />
              <button
                className="secret__act login__act"
                disabled={!relay.trim() || (busy === 'qr' && sameRelay)}
                onClick={() => startQr(relay)}
              >{busy !== 'qr' && sameRelay ? 'TRY AGAIN' : 'USE THIS RELAY'}</button>
            </div>

            <button className="login__back" onClick={backToLogin}>← OTHER LOGIN OPTIONS</button>
          </div>
        ) : (
          <>
            <form className="login__primary" onSubmit={(event) => { event.preventDefault(); void submitCredential() }}>
              <label className="login__label" htmlFor="login-credential">Nostr login</label>
              <input
                id="login-credential"
                className="avatars__input login__input"
                type="password"
                autoComplete="off"
                autoFocus
                spellCheck={false}
                placeholder="nsec1…  ncryptsec1…  bunker://…"
                value={credential}
                onChange={(event) => {
                  // Another kind of login, another password: none carries over.
                  if (loginCredentialKind(event.target.value) !== kind) { setPassword(''); setAgain('') }
                  setCredential(event.target.value)
                  useCyberspace.getState().clearLoginError()
                }}
              />
              {generatedPaste && <p className="login__note login__made-here">This key was made on this device. No password needed.</p>}
              {plain && (
                <NewPassword
                  password={password}
                  again={again}
                  onPassword={(value) => { setPassword(value); useCyberspace.getState().clearLoginError() }}
                  onAgain={(value) => { setAgain(value); useCyberspace.getState().clearLoginError() }}
                />
              )}
              {encrypted && (
                <input
                  className="avatars__input login__input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="ncryptsec password"
                  aria-label="ncryptsec password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
              <button className="secret__act login__act login__act--primary" disabled={disabled || !credentialReady} type="submit">
                {busy === 'credential' && <span className="spin" aria-hidden="true" />}
                {busy === 'credential' ? 'LOGGING IN…' : 'LOG IN'}
              </button>
            </form>

            {loginError && <p className="notice login__error">{loginError}</p>}

            <div className="login__or"><span>OR</span></div>
            {lockedKey && (
              <div className="login__options login__locked">
                {!heldRead
                  // Its room kept while the store is read, so nothing jumps when the line arrives.
                  ? <p className="login__note" aria-hidden="true" style={{ visibility: 'hidden' }}>Your encrypted key stays on this device. Come back to it here with its password.</p>
                  : keptHere
                  ? <p className="login__note">Your encrypted key stays on this device. Come back to it here with its password.</p>
                  : <p className="login__note login__note--warn">This device could not keep your encrypted key. Copy it before you switch.</p>}
                <button
                  className="secret__act login__act"
                  onClick={() => { void copyText(lockedKey).then((ok) => setKeyCopied(ok)) }}
                >{keyCopied ? 'COPIED' : 'COPY ENCRYPTED KEY'}</button>
              </div>
            )}
            {signerKind === 'local' && !locked && (keptHere ? (
              <p className="login__note">
                This key stays on this device, so you can switch back to it here.
                Back it up below in case you lose this device.
              </p>
            ) : (
              <p className="login__note login__note--warn">
                This key lives only on this device. Back it up below before switching away,
                or you cannot come back to this identity.
              </p>
            ))}
            <div className="login__options">
              <button className="secret__act login__act" disabled={disabled} onClick={() => void run('new', () => useCyberspace.getState().useNewKey())}>
                {busy === 'new' ? 'CREATING…' : 'NEW RANDOM KEY'}
              </button>
              <button
                className="secret__act login__act"
                disabled={disabled || !extension}
                onClick={() => void run('nip07', () => useCyberspace.getState().useExtension())}
                title={extension ? '' : 'No NIP-07 extension detected'}
              >{busy === 'nip07' ? 'CONNECTING…' : extension ? 'USE EXTENSION' : 'NO EXTENSION FOUND'}</button>
              <button className="secret__act login__act" disabled={disabled} onClick={() => startQr()}>
                LOGIN WITH QR CODE
              </button>
            </div>

            {signerKind === 'local' && !locked && (
              <details className="login__backup-details">
                <summary>BACK UP CURRENT KEY</summary>
                {backup ? (
                  <>
                    <label className="login__label">Encrypted key backup</label>
                    <textarea className="login__backup" readOnly value={backup} rows={3} spellCheck={false} onFocus={(event) => event.currentTarget.select()} aria-label="Encrypted key" />
                    <div className="login__row">
                      <button className="secret__act login__act" onClick={() => { void navigator.clipboard.writeText(backup).then(() => setExportError('Copied.'), () => setExportError('Clipboard unavailable; select the text instead.')) }}>COPY</button>
                      <button className="secret__act login__act" onClick={() => {
                        const url = URL.createObjectURL(new Blob([`${backup}\n`], { type: 'text/plain' }))
                        const anchor = document.createElement('a')
                        anchor.href = url
                        anchor.download = backupFileName(identity.npub)
                        anchor.click()
                        URL.revokeObjectURL(url)
                      }}>SAVE FILE</button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="login__label" htmlFor="login-pw1">Encryption password, at least {MIN_PASSWORD} characters</label>
                    <input id="login-pw1" className="avatars__input login__input" type="password" autoComplete="new-password" placeholder="password" value={pw1} onChange={(event) => { setPw1(event.target.value); setExportError(null) }} />
                    <input className="avatars__input login__input" type="password" autoComplete="new-password" placeholder="repeat password" value={pw2} onChange={(event) => { setPw2(event.target.value); setExportError(null) }} />
                    <button
                      className="secret__act login__act"
                      disabled={exportProblem(null, pw1, pw2) === 'too-short' || pw1 !== pw2 || !pw1}
                      onClick={() => {
                        try { setBackup(useCyberspace.getState().exportKey(pw1, pw2)); setExportError(null) }
                        catch (err) { setExportError(err instanceof Error ? err.message : String(err)) }
                      }}
                    >ENCRYPT BACKUP</button>
                  </>
                )}
                {exportError && <p className="notice login__error">{exportError}</p>}
              </details>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
