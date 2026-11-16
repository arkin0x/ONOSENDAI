/**
 * CopyValue.tsx: a value that copies on a tap, the one way every coordinate,
 * sector, event id, pubkey, proof and region key shown as text copies (owner,
 * 2026-11-16: "I can't copy his sector or coordinate from either of these
 * screenshots where they are listed and I want those to be tap to copy").
 *
 * It reads as the value, in the colour of the text around it, with a small
 * copy icon after it so a tap is invited. A tap puts the WHOLE value on the
 * clipboard, whatever is shown (a coord cut to its ends, an npub cut in the
 * middle), through lib/copyText, which falls back to the old copy command
 * where the Clipboard API is missing or refuses. COPIED then stands where
 * the value was for a moment, over it, so nothing around it moves (the value
 * keeps its space while hidden); COULD NOT COPY when neither way worked.
 *
 * A span with the button role rather than a <button>: a button is always
 * one box, so a long sector beside its label would jump to a line of its
 * own; a span flows and wraps with the words around it, as the value did.
 */

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Copy } from 'lucide-react'
import { copyText } from '../../lib/copyText'

/** How long COPIED stays, as on the other copies. */
export const COPIED_MS = 1400

export type CopyFlash = 'copied' | 'failed' | null

/**
 * A tap's work: copy the whole value, then flash the outcome and clear it
 * after COPIED_MS. The latest tap's timer is kept, so an earlier tap never
 * clears a newer flash. Exported for the tests.
 */
export async function copyAndFlash(
  value: string,
  setFlash: (f: CopyFlash) => void,
  timer: MutableRefObject<number>,
  copy: (text: string) => Promise<boolean> = copyText,
  alive: () => boolean = () => true,
): Promise<void> {
  const ok = await copy(value)
  // Gone while it copied (its modal closed): nothing left to flash.
  if (!alive()) return
  setFlash(ok ? 'copied' : 'failed')
  window.clearTimeout(timer.current)
  timer.current = window.setTimeout(() => setFlash(null), COPIED_MS)
}

interface Props {
  /** What goes on the clipboard: always the whole value. */
  value: string
  /** What reads, when it is not the value itself (a shortened coord, a kind with its name). */
  shown?: string
  /** The tooltip; the whole value by default, so a shortened one can be read in full. */
  title?: string
  /** The value's own class, for its size and colour where it sits; the copy look comes from `copyv`. */
  className?: string
  /** The copy icon after the value; on by default. */
  icon?: boolean
}

export function CopyValue({ value, shown, title, className, icon = true }: Props): JSX.Element {
  const [flash, setFlash] = useState<CopyFlash>(null)
  const timer = useRef(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; window.clearTimeout(timer.current) } }, [])
  // Its own tap only: a value inside a row that opens something copies and does not also open it.
  const onClick = (e?: { stopPropagation: () => void }): void => { e?.stopPropagation(); void copyAndFlash(value, setFlash, timer, copyText, () => mounted.current) }
  return <CopyValueView value={value} shown={shown} title={title} className={className} icon={icon} flash={flash} onClick={onClick} />
}

/** How it is drawn, apart from the tap: exported for the tests. */
export function CopyValueView({ value, shown, title, className, icon = true, flash, onClick }: Props & { flash: CopyFlash; onClick?: (e?: { stopPropagation: () => void }) => void }): JSX.Element {
  // The last letter rides with the icon (.copyv__tail, nowrap), so the icon
  // never wraps onto a line of its own and no hidden character is added to
  // what a hand selection picks up.
  const text = shown ?? value
  // A value cut to its ends (an ellipsis in it) is short: one line, never split at the cut.
  const cut = text !== value && text.includes('\u2026')
  return (
    <span
      role="button"
      tabIndex={0}
      className={`copyv${cut ? ' copyv--cut' : ''}${className ? ` ${className}` : ''}${flash ? ' is-flash' : ''}`}
      title={title ?? `${value}\nTap to copy`}
      aria-label={flash === 'copied' ? 'Copied' : flash === 'failed' ? 'Could not copy' : `${text}, tap to copy`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(e) } }}
    >
      <span className="copyv__value">
        {icon ? <>{text.slice(0, -1)}<span className="copyv__tail">{text.slice(-1)}<Copy className="copyv__icon" size={9} strokeWidth={2.25} aria-hidden /></span></> : text}
      </span>
      {flash && <span className="copyv__flash" aria-hidden>{flash === 'copied' ? 'COPIED' : 'COULD NOT COPY'}</span>}
    </span>
  )
}
