/** LoginModal.tsx — one clear door for every supported Nostr identity. */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import {
  createNostrConnectSession,
  DEFAULT_SIGNER_RELAY,
  hasNip07,
  loginCredentialKind,
  normalizeSignerRelay,
} from '../lib/signers'
import { MIN_PASSWORD, backupFileName, exportProblem } from '../lib/keyExport'
import { shortHex } from '../lib/time'
import { ProfilePic } from './ProfileBadge'
import { useProfile } from '../hooks/useProfile'
import { profileLabel } from '../store/useProfiles'
import { useCyberspace } from '../store/useCyberspace'

const KIND_LABEL: Record<string, string> = {
  local: 'Local key',
  nip07: 'Browser extension',
  nip46: 'Remote signer',
}

type View = 'login' | 'qr'

export function LoginModal({ onClose }: { onClose: () => void }): JSX.Element {
  const signerKind = useCyberspace((s) => s.signerKind)
  const identity = useCyberspace((s) => s.identity)
  const loginError = useCyberspace((s) => s.loginError)
  const profile = useProfile(identity.pubkey)

  const [view, setView] = useState<View>('login')
  const [credential, setCredential] = useState('')
  const [password, setPassword] = useState('')
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
    void QRCode.toCanvas(qrCanvas.current, qrUri, {
      errorCorrectionLevel: 'L',
      margin: 2,
      width: 264,
      color: { dark: '#05070d', light: '#f4fbff' },
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
    run('credential', () => useCyberspace.getState().useLogin(credential, password))

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
    setView('login')
  }

  const kind = loginCredentialKind(credential)
  const encrypted = kind === 'ncryptsec'
  const extension = hasNip07()
  const disabled = busy !== null
  const credentialReady = !!credential.trim() && (!encrypted || !!password)

  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label="Change identity" onPointerDown={close}>
      <div className="modal__card login" onPointerDown={(event) => event.stopPropagation()}>
        <div className="login__head">
          <h2 className="modal__title">{view === 'qr' ? 'Nostr Connect' : 'Change Identity'}</h2>
          <button className="secret__close" onClick={close} aria-label="Close">✕</button>
        </div>

        {view === 'login' && (
          <>
            <div className="login__current">
              <ProfilePic pubkey={identity.pubkey} size={40} />
              <div className="login__current-text">
                <span className="secret__name">{profileLabel(profile, identity.npub)}</span>
                <span className="login__kind">{KIND_LABEL[signerKind] ?? signerKind}</span>
                <span className="secret__npub" title={identity.npub}>{shortHex(identity.npub, 14, 8)}</span>
              </div>
            </div>
            {/* Switching signs nothing (useCyberspace switchTo): a new identity's
                spawn waits for its first move (arkinox, 2026-09-28). */}
            <p className="login__note">
              Switching signs nothing. An identity you have moved before returns to its own chain;
              a new one waits at its spawn point until you first move it.
            </p>
          </>
        )}

        {view === 'qr' ? (
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
                ? qrConnected ? 'SIGNER CONNECTED — FETCHING PUBLIC KEY…' : 'WAITING FOR SIGNER…'
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
                disabled={!relay.trim() || (() => {
                  try { return normalizeSignerRelay(relay) === activeRelay } catch { return false }
                })()}
                onClick={() => startQr(relay)}
              >USE THIS RELAY</button>
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
                  setCredential(event.target.value)
                  useCyberspace.getState().clearLoginError()
                }}
              />
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
            {signerKind === 'local' && (
              <p className="login__note login__note--warn">
                This key lives only on this device. Back it up below before switching away,
                or you cannot come back to this identity.
              </p>
            )}
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

            {signerKind === 'local' && (
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
