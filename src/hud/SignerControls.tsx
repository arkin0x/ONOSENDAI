/**
 * SignerControls.tsx: LOG OUT, the remote signer's status, TEST SIGNER and
 * PAIR AGAIN (arkinox, 2026-11-21: "there's no fucking log out. my bunker
 * connection is stuck I think. Can you make an actual log out button?").
 *
 * His signer app moved from his phone to a tablet, and the phone kept asking
 * the old pairing, unanswered, with nothing on screen to say so and no way
 * out but CHANGE. Now:
 *
 * - LOG OUT, in the Identity panel beside CHANGE, for every identity but the
 *   device's own generated key: one plain confirm, then the store's logOut.
 *   The device's own identity takes over; nothing of the identity left is
 *   deleted, and logging in again picks up where it was.
 * - For a remote signer, a status line read from its real requests and
 *   answers (lib/signerActivity.ts), TEST SIGNER, and PAIR AGAIN, which opens
 *   the QR for the same npub.
 * - The not-answering chip, in the instrument stack, once a move or another
 *   signature ran out of time with a remote signer: LOG OUT or PAIR AGAIN from
 *   there, without opening the menu.
 *
 * The confirm and PAIR AGAIN's QR are opened through useSignerUi and drawn by
 * SignerUiHost, so the chip (menu closed) and the panel open the same ones.
 */

import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { nip19 } from 'nostr-tools'
import { LogOut, QrCode, Radio, Unplug } from 'lucide-react'
import { useCyberspace } from '../store/useCyberspace'
import { activityOf, agoWords, signerHealth, useSignerActivity, type SignerActivity } from '../lib/signerActivity'
import { listHeld } from '../lib/identitiesDb'
import { ConfirmModal } from './ConfirmModal'
import { LoginModal } from './LoginModal'
import { ModalClose } from './ui/ModalClose'
import { shortHex } from '../lib/time'

interface SignerUi {
  /** The LOG OUT confirm is open. */
  logoutOpen: boolean
  /** PAIR AGAIN's QR is open, for this pubkey. */
  pairFor: string | null
  /** The not-answering chip was put away for the stall that raised it (its stuckAt). */
  stuckDismissed: number | null
  openLogout: () => void
  openPair: (pubkey: string) => void
  close: () => void
  dismissStuck: (at: number) => void
}

export const useSignerUi = create<SignerUi>((set) => ({
  logoutOpen: false,
  pairFor: null,
  stuckDismissed: null,
  openLogout: () => set({ logoutOpen: true, pairFor: null }),
  openPair: (pubkey) => set({ pairFor: pubkey, logoutOpen: false }),
  close: () => set({ logoutOpen: false, pairFor: null }),
  dismissStuck: (at) => set({ stuckDismissed: at }),
}))

/** What the LOG OUT confirm says first, as the owner asked for it. */
export const LOGOUT_WORDS = 'Log out of this signer on this device. Your data stays here; log in again to pick up where you left off.'
/** A remote signer's line: how to come back. */
export const LOGOUT_PAIR_WORDS = 'This device stops asking your signer. To come back, open the login and tap PAIR AGAIN.'
/** A key used for this visit only: it is not kept, so it has to be pasted again. */
export const LOGOUT_UNKEPT_WORDS = 'This key is not kept on this device. Back it up first, or you will need to paste it again.'

/** The status line's words for a remote signer's activity. */
export function signerStatusWords(a: SignerActivity, now: number = Date.now()): string {
  switch (signerHealth(a, now)) {
    case 'silent': return `Not answering. Asked ${agoWords(a.waitingSince ?? now, now)}.`
    case 'answering': return `Answered ${agoWords(a.answeredAt ?? now, now)}.`
    case 'waiting': return 'Waiting for an answer.'
    default: return 'Nothing asked yet on this visit.'
  }
}

/** The current session's activity, kept fresh, with a clock so "12 s ago" moves. */
function useSessionActivity(session: string | null): { activity: SignerActivity; now: number } {
  const activity = useSignerActivity((s) => (session ? s.bySession[session] : undefined)) ?? activityOf(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [])
  return { activity, now: Math.max(now, activity.answeredAt ?? 0, activity.askedAt ?? 0) }
}

/** LOG OUT, beside CHANGE. Not for the device's own generated key, which is where LOG OUT goes. */
export function LogoutButton(): JSX.Element | null {
  const generated = useCyberspace((s) => s.generatedKey)
  if (generated) return null
  return (
    <button className="identity__change identity__logout" onClick={() => useSignerUi.getState().openLogout()} title="Log out of this signer on this device">
      <LogOut size={10} strokeWidth={2.25} aria-hidden /> LOG OUT
    </button>
  )
}

/**
 * A remote signer's status, TEST SIGNER and PAIR AGAIN, under the identity.
 * Only for a bunker: an extension answers in this browser, a key on the device.
 */
export function SignerStatus(): JSX.Element | null {
  const kind = useCyberspace((s) => s.signerKind)
  const session = useCyberspace((s) => s.signerSession)
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  const { activity, now } = useSessionActivity(session)
  const [test, setTest] = useState<{ words: string; ok: boolean; at: number; pubkey: string } | null>(null)
  const [testing, setTesting] = useState(false)
  if (kind !== 'nip46') return null
  const health = signerHealth(activity, now)
  // A test's answer stands until something newer is known: a later answer, or a later request left waiting.
  const tested = test && test.pubkey === pubkey && test.at >= (activity.answeredAt ?? 0) - 1000 ? test : null
  const words = testing ? 'Asking your signer…' : tested ? tested.words : signerStatusWords(activity, now)
  const bad = testing ? false : tested ? !tested.ok : health === 'silent'
  const runTest = async (): Promise<void> => {
    if (testing) return
    setTesting(true)
    try {
      const result = await useCyberspace.getState().testSigner()
      setTest({ ...result, at: Date.now(), pubkey })
    } finally {
      setTesting(false)
    }
  }
  const Icon = bad ? Unplug : Radio
  return (
    <div className={`signer-status${bad ? ' is-bad' : ''}`}>
      <p className={`signer-status__line${bad ? ' is-bad' : ''}`} role="status" aria-live="polite">
        <Icon className="signer-status__icon" size={11} strokeWidth={2.25} aria-hidden />
        <span className="signer-status__label">SIGNER</span>
        <span className="signer-status__words">{words}</span>
      </p>
      <div className="signer-status__acts">
        <button className="identity__change" onClick={() => void runTest()} disabled={testing} title="Ask your signer which account it holds, and see whether it answers">
          {testing && <span className="spin" aria-hidden="true" />}TEST SIGNER
        </button>
        <button className="identity__change" onClick={() => useSignerUi.getState().openPair(pubkey)} title="Pair your signer again with a QR code. Everything on this device stays.">
          <QrCode size={10} strokeWidth={2.25} aria-hidden /> PAIR AGAIN
        </button>
      </div>
    </div>
  )
}

/**
 * The chip a stalled remote signer raises: a move (or another signature this
 * device needed) ran out of time with it. Goes when the signer answers again,
 * when the identity changes, or when put away with its ✕.
 */
export function SignerStuckChip(): JSX.Element | null {
  const kind = useCyberspace((s) => s.signerKind)
  const session = useCyberspace((s) => s.signerSession)
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  const stuckAt = useSignerActivity((s) => (session ? s.bySession[session]?.stuckAt ?? null : null))
  const dismissed = useSignerUi((s) => s.stuckDismissed)
  if (kind !== 'nip46' || stuckAt === null || dismissed === stuckAt) return null
  return (
    <div className="hyperbar hyperbar--toast hyperbar--buildtoast hyperbar--signertoast signer-stuck" role="alert">
      <Unplug className="toast__build toast__signer" size={16} strokeWidth={2.25} aria-hidden />
      <span className="hyperbar__text">
        <span className="hyperbar__label">YOUR SIGNER IS NOT ANSWERING</span>
        <span className="hyperbar__meta">LOG OUT and pair again.</span>
      </span>
      <span className="signer-stuck__acts">
        <button className="hyperbar__end signer-stuck__act" onClick={() => useSignerUi.getState().openPair(pubkey)}>PAIR AGAIN</button>
        <button className="hyperbar__end signer-stuck__act signer-stuck__act--quiet" onClick={() => useSignerUi.getState().openLogout()}>LOG OUT</button>
      </span>
      <ModalClose className="signer-stuck__close" label="Put away" onClose={() => useSignerUi.getState().dismissStuck(stuckAt)} />
    </div>
  )
}

/** The LOG OUT confirm: one step, in plain words. */
function LogoutConfirm(): JSX.Element {
  const kind = useCyberspace((s) => s.signerKind)
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  const locked = useCyberspace((s) => s.keyLock !== null && s.keyLock.mode !== 'set')
  const [busy, setBusy] = useState(false)
  // A key brought here is kept only if it was sealed with a password: one
  // used for this visit alone is gone with LOG OUT, and that is said.
  const [kept, setKept] = useState<boolean | null>(null)
  useEffect(() => {
    if (kind !== 'local' || locked) return
    let live = true
    void listHeld().then((rows) => { if (live) setKept(rows.some((r) => r.pubkey === pubkey && (r.way === 'password' || r.way === 'generated'))) })
    return () => { live = false }
  }, [kind, locked, pubkey])
  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try { await useCyberspace.getState().logOut() } finally {
      setBusy(false)
      useSignerUi.getState().close()
    }
  }
  return (
    <ConfirmModal
      title="Log out"
      danger={false}
      cardClassName="logout"
      busy={busy}
      confirmLabel="LOG OUT"
      onConfirm={() => void confirm()}
      onCancel={() => useSignerUi.getState().close()}
      body={(
        <>
          <p>{LOGOUT_WORDS}</p>
          <p className="logout__npub">{shortHex(nip19.npubEncode(pubkey), 14, 8)}</p>
          {kind === 'nip46' && <p className="logout__note">{LOGOUT_PAIR_WORDS}</p>}
          {/* Its room kept while the list is read, so nothing jumps when it arrives. */}
          {kind === 'local' && !locked && (
            <p className={`logout__note${kept === false ? ' logout__note--warn' : ''}`} style={kept === false ? undefined : { visibility: 'hidden' }} aria-hidden={kept !== false}>
              {LOGOUT_UNKEPT_WORDS}
            </p>
          )}
        </>
      )}
    />
  )
}

/** Draws the LOG OUT confirm and PAIR AGAIN's QR wherever they were opened from. */
export function SignerUiHost(): JSX.Element | null {
  const logoutOpen = useSignerUi((s) => s.logoutOpen)
  const pairFor = useSignerUi((s) => s.pairFor)
  if (logoutOpen) return <LogoutConfirm />
  if (pairFor) return <LoginModal pairFor={pairFor} onClose={() => useSignerUi.getState().close()} />
  return null
}
