/**
 * Notices.tsx - what the workshop says over the bench: the store's one-line
 * notice, and the warning that changes are not saved. (The first-run card
 * gave way to the first-visit guide, shell/Guide.tsx, in phase 4.)
 */

import { useEffect, useState } from 'react'
import { useWorkshop } from '../store/useWorkshop'

const TOAST_MS = 4000

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
