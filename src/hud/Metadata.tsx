/**
 * Metadata.tsx: METADATA, a card's technical facts folded under one toggle
 * (arkinox, 2026-10-26: "Collapse all the technical info on the chest, door,
 * and shard modal under a "METADATA" accordion."). Closed by default, so the
 * card reads as its name, what it is and what you can do; open, the ids,
 * places, sizes and the event behind it. Whether it is open is remembered on
 * this device, for every card alike, so someone who reads the wire keeps it
 * open. The toggle is STARRED PLACES' and RECENT's (viewat__toggle).
 */

import { useState, type ReactNode } from 'react'

const OPEN_KEY = 'onosendai:metadataOpen'

/** Whether METADATA opens on this device: closed unless it was left open. */
export function metadataOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) === '1' } catch { return false }
}

function rememberOpen(open: boolean): void {
  try { localStorage.setItem(OPEN_KEY, open ? '1' : '0') } catch { /* private mode: it lasts the card */ }
}

export function Metadata({ children }: { children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(metadataOpen)
  const toggle = (): void => {
    rememberOpen(!open)
    setOpen(!open)
  }
  return (
    <section className="metadata" aria-label="Metadata">
      <button className="viewat__toggle metadata__toggle" onClick={toggle} aria-expanded={open} title="Ids, places, sizes and the event itself">
        METADATA <span className="viewat__caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && <div className="metadata__body">{children}</div>}
    </section>
  )
}
