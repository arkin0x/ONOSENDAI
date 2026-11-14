/**
 * StraylightIdentity.tsx: the Straylight route's identity panel
 * (tutorial/script.ts STRAYLIGHT_IDENTITY; owner, 2026-11-14).
 *
 * Armada, where Straylight Cafe lives, signs a player in with an extension,
 * a bunker or a signer app, or a pasted nsec; it does not take an ncryptsec.
 * So what to do depends on how the player is signed in here:
 *
 * - an extension or a signer app (bunker): the identity is already portable,
 *   and the panel says to log in to Armada with the same one;
 * - a key this device made: the key itself has to go to Armada, so the
 *   panel offers it behind a warning and an explicit SHOW MY KEY (owner
 *   ruling, 2026-11-14), with a copy button and a line pointing at a signer as
 *   the safer home for it.
 *
 * The key is read from the store only on that tap (useCyberspace revealKey),
 * held in this component's state only while shown, and gone when it hides:
 * HIDE KEY, leaving the step (the coach redraws its body per step), folding
 * or closing the coach, another identity, or the tab going to the
 * background. It is never put in a URL, never sent and never logged; the copy
 * goes to the clipboard and nowhere else.
 */

import { useEffect, useRef, useState } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import type { SignerKind } from '../lib/signers'

/** What the panel says to a player who already has a portable signer. */
export const SAME_SIGNER: Readonly<Record<Exclude<SignerKind, 'local'>, string>> = {
  nip07: "You're signed in with a browser extension. In Armada, log in with the same extension.",
  nip46: "You're signed in with a signer app. In Armada, connect the same signer app.",
}

/** The words around the key, for a player on a key this device made. */
export const LOCAL_KEY_COPY = {
  why: "Your key lives in this app. To be you in Armada, paste it into Armada's login.",
  warning: 'This is the key to your identity. Anyone who has it can be you. Paste it only into Armada, and never send it to anyone.',
  show: 'SHOW MY KEY',
  copy: 'COPY KEY',
  hide: 'HIDE KEY',
  copied: 'Copied. Paste it into Armada.',
  copyFailed: "Couldn't copy. Select the key and copy it yourself.",
  signer: 'A signer app or extension is a safer home for your key.',
} as const

export function StraylightIdentity(): JSX.Element {
  const kind = useCyberspace((s) => s.signerKind)
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  if (kind !== 'local') return <p className="demo__caption straylight-id">{SAME_SIGNER[kind]}</p>
  // Keyed by identity: another key in the store hides what was shown for the last one.
  return <LocalKey key={pubkey} />
}

function LocalKey(): JSX.Element {
  const [shown, setShown] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const hide = (): void => { setShown(null); setNote(null) }
  // SHOW and HIDE each take their own button away: the focus goes to what
  // stands in its place (COPY KEY, or SHOW MY KEY again), never to the page,
  // where Space would press COMMIT. On a phone the coach is short, so COPY
  // KEY is also scrolled into view under the key.
  const copyRef = useRef<HTMLButtonElement | null>(null)
  const showRef = useRef<HTMLButtonElement | null>(null)
  // Only on a change of shown or hidden, never on mount (StrictMode runs a mount's effect twice): the step comes up scrolled to its title.
  const was = useRef(shown !== null)
  useEffect(() => {
    if (was.current === (shown !== null)) return
    was.current = shown !== null
    const to = shown ? copyRef.current : showRef.current
    to?.focus?.()
    if (shown) to?.scrollIntoView?.({ block: 'nearest' })
  }, [shown])

  // Put away when the tab goes to the background, so the key is not left on screen behind Armada.
  useEffect(() => {
    if (!shown || typeof document === 'undefined' || !document.addEventListener) return
    const away = (): void => { if (document.visibilityState === 'hidden') hide() }
    document.addEventListener('visibilitychange', away)
    return () => document.removeEventListener('visibilitychange', away)
  }, [shown])

  const show = (): void => {
    try { setShown(useCyberspace.getState().revealKey()); setNote(null) }
    // The message is lib/keyExport's own words, never the key.
    catch (err) { setNote(err instanceof Error ? err.message : String(err)) }
  }
  const copy = (): void => {
    if (!shown) return
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
    if (!clip) { setNote(LOCAL_KEY_COPY.copyFailed); return }
    clip.writeText(shown).then(() => setNote(LOCAL_KEY_COPY.copied), () => setNote(LOCAL_KEY_COPY.copyFailed))
  }

  return (
    <div className="straylight-id">
      <p className="demo__caption">{LOCAL_KEY_COPY.why}</p>
      <p className="demo__caption straylight-id__warn" role="note">{LOCAL_KEY_COPY.warning}</p>
      {shown ? (
        <>
          <textarea
            className="login__backup straylight-id__key"
            readOnly
            value={shown}
            rows={3}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="Your secret key"
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="straylight-id__row">
            <button ref={copyRef} className="demo__btn demo__btn--next" onClick={copy}>{LOCAL_KEY_COPY.copy}</button>
            <button className="demo__btn" onClick={hide}>{LOCAL_KEY_COPY.hide}</button>
          </div>
        </>
      ) : (
        <div className="straylight-id__row">
          <button ref={showRef} className="demo__btn demo__btn--next" onClick={show}>{LOCAL_KEY_COPY.show}</button>
        </div>
      )}
      {/* Always there, so a screen reader hears Copied. when it arrives. */}
      <p className="demo__caption tutorial__note straylight-id__note" role="status">{note}</p>
      <p className="demo__caption straylight-id__tip">{LOCAL_KEY_COPY.signer}</p>
    </div>
  )
}
