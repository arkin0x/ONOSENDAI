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
 * - The big-request question (lib/signerRequestSize.ts): a request bigger
 *   than some signer apps can read waits for TRY ANYWAY, and a signer that
 *   then stays silent raises its own chip, which offers a key on this device
 *   instead of pairing again.
 *
 * The confirm and PAIR AGAIN's QR are opened through useSignerUi and drawn by
 * SignerUiHost, so the chip (menu closed) and the panel open the same ones.
 */

import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { nip19 } from 'nostr-tools'
import { LogOut, QrCode, Radio, Unplug } from 'lucide-react'
import { LOGOUT_UNKEPT, useCyberspace } from '../store/useCyberspace'
import { activityOf, agoWords, signerHealth, useSignerActivity, type SignerActivity } from '../lib/signerActivity'
import { useBigRequestQuestion } from '../lib/signerRequestSize'
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
  /** The login is open, to sign in with a key on this device (the big-request chip). */
  loginOpen: boolean
  /** The "may not handle messages this big" chip was put away for the silence that raised it (its bigSilentAt). */
  bigDismissed: number | null
  openLogout: () => void
  openPair: (pubkey: string) => void
  openLogin: () => void
  close: () => void
  dismissStuck: (at: number) => void
  dismissBig: (at: number) => void
}

export const useSignerUi = create<SignerUi>((set) => ({
  logoutOpen: false,
  pairFor: null,
  stuckDismissed: null,
  loginOpen: false,
  bigDismissed: null,
  openLogout: () => set({ logoutOpen: true, pairFor: null, loginOpen: false }),
  openPair: (pubkey) => set({ pairFor: pubkey, logoutOpen: false, loginOpen: false }),
  openLogin: () => set({ loginOpen: true, logoutOpen: false, pairFor: null }),
  close: () => set({ logoutOpen: false, pairFor: null, loginOpen: false }),
  dismissStuck: (at) => set({ stuckDismissed: at }),
  dismissBig: (at) => set({ bigDismissed: at }),
}))

/** What the LOG OUT confirm says first, as the owner asked for it. */
export const LOGOUT_WORDS = 'Log out of this signer on this device. Your data stays here; log in again to pick up where you left off.'
/** A remote signer's line: how to come back. */
export const LOGOUT_PAIR_WORDS = 'This device stops asking your signer. To come back, open the login and tap PAIR AGAIN.'
/** The chip's line once a big request sent anyway got no answer. */
export const BIG_SILENT_WORDS = 'It may not handle messages this big. Make it smaller, or use a key on this device.'
/** A key this device does not keep: LOG OUT would lose it, so it waits until the key is kept or backed up. */
export const LOGOUT_UNKEPT_WORDS = LOGOUT_UNKEPT

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
  // A test's answer stands until something newer is known: a later answer,
  // a later request left waiting, or a signature that ran out of time since.
  const newer = Math.max((activity.answeredAt ?? 0) - 1000, activity.waitingSince ?? 0, activity.stuckAt ?? 0)
  const tested = test && test.pubkey === pubkey && test.at >= newer ? test : null
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
      {/* Read out for a test, not for the clock ticking under "12 s ago". */}
      <p className={`signer-status__line${bad ? ' is-bad' : ''}`} role="status" aria-live={testing || tested ? 'polite' : 'off'}>
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
  const bigSilentAt = useSignerActivity((s) => (session ? s.bySession[session]?.bigSilentAt ?? null : null))
  const dismissed = useSignerUi((s) => s.stuckDismissed)
  const bigDismissed = useSignerUi((s) => s.bigDismissed)
  if (kind !== 'nip46') return null
  // Silent on a big request it was sent anyway: the size, not the pairing, is the likely reason.
  if (bigSilentAt !== null && bigDismissed !== bigSilentAt) {
    return (
      <div className="hyperbar hyperbar--toast hyperbar--buildtoast hyperbar--signertoast signer-stuck" role="alert">
        <Unplug className="toast__build toast__signer" size={16} strokeWidth={2.25} aria-hidden />
        <span className="hyperbar__text">
          <span className="hyperbar__label">YOUR SIGNER DID NOT ANSWER</span>
          <span className="hyperbar__meta">{BIG_SILENT_WORDS}</span>
        </span>
        <span className="signer-stuck__acts">
          <button className="hyperbar__end signer-stuck__act" onClick={() => useSignerUi.getState().openLogin()}>USE A KEY HERE</button>
        </span>
        <ModalClose className="signer-stuck__close" label="Put away" onClose={() => useSignerUi.getState().dismissBig(bigSilentAt)} />
      </div>
    )
  }
  if (stuckAt === null || dismissed === stuckAt) return null
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
  // What it is about, fixed as it opens: once LOG OUT has switched, the
  // identity on screen is the device's own, and the card must not change
  // under the spinner while the old signer closes.
  const [about] = useState(() => {
    const s = useCyberspace.getState()
    return { kind: s.signerKind, pubkey: s.identity.pubkey, lock: s.keyLock?.mode ?? null }
  })
  const { kind, pubkey, lock } = about
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  // A key brought here is kept only if it was sealed with a password. One
  // used for this visit alone, or saved plain before keys were sealed, would
  // be lost, so LOG OUT is refused for it (store logOut) and that is said
  // here first. A locked key's sealed copy is kept by logOut itself; a key
  // not in hand ('gone') has nothing to lose.
  const checks = kind === 'local' && lock !== 'unlock' && lock !== 'gone'
  const [kept, setKept] = useState<boolean | null>(checks ? null : true)
  useEffect(() => {
    if (!checks) return
    let live = true
    void listHeld().then((rows) => { if (live) setKept(rows.some((r) => r.pubkey === pubkey && (r.way === 'password' || r.way === 'generated'))) })
    return () => { live = false }
  }, [checks, pubkey])
  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    let why: string | null = null
    try { why = await useCyberspace.getState().logOut() } finally { setBusy(false) }
    if (why) setRefused(why)
    else useSignerUi.getState().close()
  }
  return (
    <ConfirmModal
      title="Log out"
      danger={false}
      cardClassName="logout"
      busy={busy}
      confirmDisabled={kept === false || refused !== null}
      confirmLabel="LOG OUT"
      onConfirm={() => void confirm()}
      onCancel={() => useSignerUi.getState().close()}
      body={(
        <>
          <p>{LOGOUT_WORDS}</p>
          <p className="logout__npub">{shortHex(nip19.npubEncode(pubkey), 14, 8)}</p>
          {kind === 'nip46' && <p className="logout__note">{LOGOUT_PAIR_WORDS}</p>}
          {/* Its room kept while the list is read, so nothing jumps when it arrives. */}
          {checks && (
            <p className={`logout__note${kept === false || refused ? ' logout__note--warn' : ''}`} style={kept === false || refused ? undefined : { visibility: 'hidden' }} aria-hidden={kept !== false && !refused} role={kept === false || refused ? 'alert' : undefined}>
              {refused ?? LOGOUT_UNKEPT_WORDS}
            </p>
          )}
          {!checks && refused && <p className="logout__note logout__note--warn" role="alert">{refused}</p>}
        </>
      )}
    />
  )
}

/**
 * The question before a big request goes to a remote signer
 * (lib/signerRequestSize.ts): TRY ANYWAY sends it; anything else, the ✕ and
 * a tap outside included, sends nothing.
 */
export function BigRequestQuestion(): JSX.Element | null {
  const question = useBigRequestQuestion((s) => s.question)
  if (!question) return null
  return (
    <ConfirmModal
      title="Big request"
      danger={false}
      body={<p>{question.words}</p>}
      confirmLabel="TRY ANYWAY"
      cancelLabel="DON'T SEND"
      onConfirm={() => question.answer(true)}
      onCancel={() => question.answer(false)}
    />
  )
}

/** Draws the LOG OUT confirm, PAIR AGAIN's QR and the login wherever they were opened from. (The big-request question is drawn by App, outside the modals' crash boundary.) */
export function SignerUiHost(): JSX.Element | null {
  const logoutOpen = useSignerUi((s) => s.logoutOpen)
  const pairFor = useSignerUi((s) => s.pairFor)
  const loginOpen = useSignerUi((s) => s.loginOpen)
  let panel: JSX.Element | null = null
  if (logoutOpen) panel = <LogoutConfirm />
  else if (pairFor) panel = <LoginModal pairFor={pairFor} onClose={() => useSignerUi.getState().close()} />
  else if (loginOpen) panel = <LoginModal onClose={() => useSignerUi.getState().close()} />
  return panel
}
