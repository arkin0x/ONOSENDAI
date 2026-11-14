/**
 * Notices.tsx - what the workshop says over the bench: the first-run card,
 * the store's one-line notice, and the warning that changes are not saved.
 * Moved out of Workshop.tsx when the workshop was split by place (workshop
 * redesign, phase 1); the card's words follow the new layout.
 */

import { useEffect, useState } from 'react'
import { useTutorial } from '../store/useTutorial'
import { useWorkshop } from '../store/useWorkshop'

const TOAST_MS = 4000

const INTRO_KEY = 'onosendai:workshop-intro'

export function Intro(): JSX.Element | null {
  const [show, setShow] = useState<boolean>(() => { try { return !localStorage.getItem(INTRO_KEY) } catch { return false } })
  // Held back while the tutorial runs, without burning the one-time flag, so
  // entering the workshop from the tutorial never interrupts it (feedback
  // 2026-11-11, item 11b). It may get its own tutorial later.
  const tutorialActive = useTutorial((s) => s.active)
  if (!show || tutorialActive) return null
  const done = (): void => { try { localStorage.setItem(INTRO_KEY, '1') } catch { /* private mode */ } setShow(false) }
  return (
    <div className="workshop__intro" role="note" aria-label="How to make an object">
      <h3 className="workshop__intro-title">MAKE A SHARD</h3>
      <ol className="workshop__intro-steps">
        <li><b>STAMP</b> a shape: tap STAMP at the bottom, then the grid where the ghost shows.</li>
        <li>One finger <b>orbits</b> (in SELECT it draws a box), or drag the <b>view ball</b> top right; two fingers <b>pan</b>. The arrows on the left raise the level to stack things.</li>
        <li><b>DEPLOY</b> hides it in the world at a place you choose.</li>
      </ol>
      <button className="workshop__btn workshop__intro-ok" onClick={done}>GOT IT</button>
    </div>
  )
}

/** The store's one-line notice, shown for a moment and then gone. */
export function Toast(): JSX.Element | null {
  const notice = useWorkshop((s) => s.notice)
  const [shown, setShown] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) { setShown(null); return }
    setShown(notice)
    const t = window.setTimeout(() => setShown(null), TOAST_MS)
    return () => window.clearTimeout(t)
  }, [notice])
  if (!shown) return null
  return <div className="ws__toast" role="status">{shown}</div>
}

/**
 * Why the latest changes are not saved, for as long as they are not: the
 * toast goes after a moment, and this must not (store/workshopStorage.ts).
 */
export function StorageWarning(): JSX.Element | null {
  const error = useWorkshop((s) => s.storageError)
  if (!error) return null
  return <div className="ws__storage" role="alert">{error}</div>
}
