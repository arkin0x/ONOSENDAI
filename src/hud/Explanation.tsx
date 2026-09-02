/**
 * Explanation.tsx — a panel's explanatory prose, folded behind a pill.
 *
 * Every panel used to end in a paragraph explaining itself. Read once, that
 * paragraph is noise on every later visit, so it now sits behind an EXPLAIN
 * pill: tap to open it in a well, tap again to fold it. The state belongs to
 * the mounted component and is never persisted, so every visit starts folded.
 * Status lines (empty states, machine ceilings, key hints) are not
 * explanations and stay in view.
 */

import { useState, type ReactNode } from 'react'

export function Explanation({ children }: { children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className={`explain ${open ? 'is-open' : ''}`}>
      <button type="button" className={`explain__pill ${open ? 'is-on' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'HIDE' : 'EXPLAIN'}
      </button>
      {open && <div className="explain__well legend__note">{children}</div>}
    </div>
  )
}
