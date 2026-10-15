/**
 * StarNickname.tsx - the small field that comes up over the star once its
 * flare is over, to give the place just starred a nickname (arkinox,
 * 2026-10-07). Optional: SKIP, Escape, or a tap anywhere else closes it and
 * the place stays starred under its own label. SAVE, or Enter, keeps the
 * nickname, which is then the place's name in Starred Places, under its star
 * in the scene, and on its card. Either way, closing the field is what puts
 * up the "Added to your Starred Places" toast, so the two never compete.
 *
 * The nickname can be changed later from the pencil on the place's row in
 * the POSITION panel, or from its star in the scene.
 */

import { useEffect, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import { NICKNAME_MAX } from '../lib/starred'
import { useStarred } from '../store/useStarred'
import { useEscape } from '../hooks/useEscape'

export function StarNickname(): JSX.Element | null {
  const naming = useStarred((s) => s.naming)
  const place = useStarred((s) => (s.naming ? s.places.find((p) => p.input === s.naming!.input && p.plane === s.naming!.plane) : undefined))
  const [text, setText] = useState('')
  const form = useRef<HTMLFormElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const open = naming !== null && place !== undefined

  // A fresh field for every place, with the caret in it. On a phone the
  // keyboard may wait for a tap on the field: browsers only raise it for a
  // focus that comes straight from a touch, and this one comes after the flare.
  useEffect(() => {
    if (!open) return
    setText('')
    input.current?.focus()
  }, [open, naming?.input, naming?.plane])

  // A press anywhere outside the field is a SKIP. Captured, so it is seen
  // before whatever was pressed (the scene, the pad, the menu) acts on it.
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent): void => {
      if (form.current && e.target instanceof Node && form.current.contains(e.target)) return
      useStarred.getState().finishNaming(null)
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [open])

  // With the caret elsewhere, Escape still skips, before it closes the menu.
  useEscape('modal', open, () => useStarred.getState().finishNaming(null))

  if (!open) return null
  return (
    <form
      ref={form}
      className="starname"
      aria-label="Nickname this place"
      onSubmit={(e) => { e.preventDefault(); useStarred.getState().finishNaming(text) }}
    >
      <span className="starname__label">
        <Star size={11} strokeWidth={2.25} fill="currentColor" aria-hidden /> Nickname this place (optional)
      </span>
      <span className="starname__row">
        <input
          ref={input}
          className="avatars__input starname__input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); useStarred.getState().finishNaming(null) } }}
          maxLength={NICKNAME_MAX}
          placeholder={place.label}
          aria-label="Nickname"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
        />
        <button className="avatars__go" type="submit">SAVE</button>
        <button className="starname__skip" type="button" onClick={() => useStarred.getState().finishNaming(null)}>SKIP</button>
      </span>
    </form>
  )
}
