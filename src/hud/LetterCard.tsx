/**
 * LetterCard.tsx: a hidden message opened, as a sealed letter (owner,
 * 2026-11-26: "decode effect for the message itself. love the broken seal
 * for read").
 *
 * Every time the card opens, the seal in its author's colour cracks, the
 * page unfolds, and the words resolve out of glyphs (lib/letterReveal.ts:
 * about 1.1 s the first time, 0.3 s after; nothing moves with reduced
 * motion). A tap or a key on the page skips straight to the words. The words'
 * height is taken by the real words from the first frame, with the glyphs
 * drawn over them, so nothing under the page moves as they resolve.
 *
 * A short message (lib/letterReveal SHORT_MAX) is set large and centred. A
 * long one is a reading view of fixed height that scrolls inside, with a
 * soft fade at its foot while there is more and a thin line along its edge
 * saying how far through you are (shared piece "Short versus long").
 *
 * Opening the card is what reads the message: its seal is broken from then
 * on, in the world and in the lists (store/useMessagesRead, per npub). A
 * Cashu token or an NFT claim link in the words keeps its own card under the
 * page (CashuCard MessageText).
 */

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { authorColour } from '../lib/authorColour'
import { isShortMessage, revealPlan, sealInitial, type RevealPlan } from '../lib/letterReveal'
import { readId } from '../lib/messagesRead'
import { safeNpub } from '../lib/npub'
import { prefersReducedMotion } from '../hooks/useReducedMotion'
import { useProfile } from '../hooks/useProfile'
import { sealBroken, useMessagesRead } from '../store/useMessagesRead'
import { MessageText } from './CashuCard'
import { Seal } from './LetterSeal'
import { useDecodeReveal } from './useDecodeReveal'

export function LetterCard({ item, author, mine }: {
  item: { key: string; lineage?: string; text?: string; event?: { tags?: string[][] } }
  author: string
  mine: boolean
}): JSX.Element {
  const id = readId(item)
  // Fixed as the card opens: read before or not, and whether motion is wanted.
  const [plan] = useState<RevealPlan>(() => revealPlan(sealBroken(useMessagesRead.getState(), id, mine), prefersReducedMotion()))
  const [skipped, setSkipped] = useState(false)
  // Opening it reads it. Your own are read already.
  useEffect(() => { if (!mine) useMessagesRead.getState().markRead(id) }, [id, mine])
  const profile = useProfile(author || null)
  const opening = plan.unfoldMs > 0 && !skipped
  const style = { '--author': authorColour(author), '--unfold-ms': `${plan.unfoldMs}ms` } as CSSProperties
  const skip = (): void => setSkipped(true)
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); skip() } }
  return (
    <div className={`letter${opening ? ' letter--opening' : ''}`} style={style}>
      <div className="letter__seal">
        <Seal colour={authorColour(author)} initial={sealInitial(profile?.name, safeNpub(author))} broken cracking={opening} size={44} />
      </div>
      <div className="letter__page" onPointerDown={skip} onKeyDown={onKey}>
        <MessageText text={item.text ?? ''} tags={item.event?.tags} words={(t) => <LetterWords text={t} seedKey={item.key} plan={plan} skipped={skipped} />} />
      </div>
    </div>
  )
}

/** The words, resolving: the real words hold the height, the glyphs drawn over them until they are whole. */
function LetterWords({ text, seedKey, plan, skipped }: { text: string; seedKey: string; plan: RevealPlan; skipped: boolean }): JSX.Element {
  const { shown, done } = useDecodeReveal(text, seedKey, plan, skipped)
  const body = (
    <span className={`letter__stack${done ? ' is-done' : ''}`}>
      <span className="letter__ghost">{text}</span>
      {!done && <span className="letter__shown" aria-hidden="true">{glyphRuns(shown, text).map((r, i) => (r.glyph ? <span key={i} className="g">{r.text}</span> : r.text))}</span>}
    </span>
  )
  const hint = done ? undefined : 'Tap to show the words now'
  if (isShortMessage(text)) {
    return <p className="letter__words letter__words--short" tabIndex={done ? undefined : 0} title={hint}>{body}</p>
  }
  return <LongRead hint={hint}>{body}</LongRead>
}

/**
 * The words as they show, cut into runs of resolved letters and of glyphs, so
 * the glyphs can wear the cipher's cyan: few spans however long the message.
 * decodeText keeps the text's length, one character for one.
 */
export function glyphRuns(shown: string, text: string): Array<{ text: string; glyph: boolean }> {
  const out: Array<{ text: string; glyph: boolean }> = []
  for (let i = 0; i < shown.length; i++) {
    const glyph = shown[i] !== text[i]
    const last = out[out.length - 1]
    if (last && last.glyph === glyph) last.text += shown[i]
    else out.push({ text: shown[i], glyph })
  }
  return out
}

/** A long message's reading view: fixed height, scrolled inside, a fade while there is more, a line for how far through. */
function LongRead({ hint, children }: { hint?: string; children: ReactNode }): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [through, setThrough] = useState(0)
  const [more, setMore] = useState(true)
  const measure = (): void => {
    const el = box.current
    if (!el) return
    const room = el.scrollHeight - el.clientHeight
    setThrough(room > 0 ? Math.min(1, el.scrollTop / room) : 1)
    setMore(room - el.scrollTop > 2)
  }
  useEffect(measure, [])
  return (
    <div className="letter__long">
      <div ref={box} className={`letter__read${more ? ' has-more' : ''}`} onScroll={measure} tabIndex={0} title={hint}>
        <p className="letter__words">{children}</p>
      </div>
      <span className="letter__progress" aria-hidden="true"><i style={{ width: `${Math.round(through * 100)}%` }} /></span>
    </div>
  )
}
