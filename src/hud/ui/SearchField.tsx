/**
 * SearchField.tsx: the search box under a list of shards (PLACE OBJECT, the
 * hide bar's Model, the chest's + SHARD, the workshop's MENU and STAMP).
 * The client's own text input with a search icon at its left and a clear ✕
 * at its right. The ✕ sits over the box, so it coming and going moves
 * nothing. While there is text, Escape clears it first and closes nothing
 * behind it; with the box empty Escape closes the modal as usual.
 *
 * Never focused on its own: on a phone that would raise the keyboard over
 * the list before anyone asked to search.
 *
 * `holdHeight`, for a centred modal: from the first letter typed until the
 * box is empty again the card keeps the height it had just before, so the
 * box does not move up and down under the finger as the list shrinks and
 * grows (no layout jumps). Measured at that first letter, before the list
 * changes. Never taller than the screen allows (the 100%), so a keyboard
 * coming up still shrinks it.
 */

import { Search, X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { useEscape } from '../../hooks/useEscape'
import { matchRange, searchKey } from '../../lib/shardSearch'

export function SearchField({ value, onChange, placeholder, label, className, holdHeight = false }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** What a screen reader hears it as. */
  label: string
  className?: string
  holdHeight?: boolean
}): JSX.Element {
  useEscape('modal', value !== '', () => onChange(''))
  const held = useRef<HTMLElement | null>(null)
  // Let the card go once the box is empty, however it was emptied, and when the box goes.
  useEffect(() => {
    if (value !== '' || !held.current) return
    held.current.style.minHeight = ''
    held.current = null
  }, [value])
  useEffect(() => () => { if (held.current) held.current.style.minHeight = '' }, [])
  const change = (next: string, input: HTMLElement): void => {
    if (holdHeight && value === '' && next !== '' && !held.current) {
      const card = input.closest<HTMLElement>('.modal__card')
      if (card) {
        card.style.minHeight = `min(${Math.round(card.getBoundingClientRect().height)}px, 100%)`
        held.current = card
      }
    }
    onChange(next)
  }
  return (
    <div className={`searchfield ${className ?? ''}`} role="search">
      <Search className="searchfield__icon" size={14} strokeWidth={2.25} aria-hidden />
      <input
        className="avatars__input login__input searchfield__input"
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => change(e.target.value, e.target)}
        // Enter on a phone's keyboard puts it away; the list is already filtered.
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
      {value !== '' && (
        <button type="button" className="searchfield__clear" onClick={() => onChange('')} title="Clear the search" aria-label="Clear the search">
          <X size={14} strokeWidth={2.25} aria-hidden />
        </button>
      )}
    </div>
  )
}

/** A name with the part a search matched marked; the name as it is with no search or no match. */
export function Highlight({ text, query }: { text: string; query: string }): JSX.Element {
  const at = matchRange(text, searchKey(query))
  if (!at) return <>{text}</>
  return <>{text.slice(0, at[0])}<mark className="searchfield__hit">{text.slice(at[0], at[1])}</mark>{text.slice(at[1])}</>
}

/** Highlight as a function, for a row kit. */
export function highlighter(query: string): (text: string) => ReactNode {
  return (text) => <Highlight text={text} query={query} />
}
