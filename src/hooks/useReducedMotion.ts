/**
 * useReducedMotion.ts: whether the person asked their system for less
 * motion (prefers-reduced-motion), kept current while they change it.
 * Shared by the scene's moving marks: a starred place's breathing star
 * (StarredMarks) and an item's model in motion (ItemModel).
 */

import { useEffect, useMemo, useState } from 'react'

export function useReducedMotion(): boolean {
  const query = useMemo(() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)') } catch { return null } }, [])
  const [reduced, setReduced] = useState(() => query?.matches ?? false)
  useEffect(() => {
    if (!query) return
    const on = (): void => setReduced(query.matches)
    query.addEventListener?.('change', on)
    return () => query.removeEventListener?.('change', on)
  }, [query])
  return reduced
}

/** The same question asked once, outside React: for a moment that starts from a tap (the OPEN ceremony). */
export function prefersReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}
