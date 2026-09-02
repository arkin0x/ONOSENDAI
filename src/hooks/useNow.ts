/**
 * useNow.ts - a clock a component can render against.
 *
 * Countdowns and elapsed lines need to repaint on their own schedule; the
 * store has no reason to tick for them. One interval per mounted component,
 * and none at all when the caller passes 0: a panel with nothing counting
 * should not repaint every second.
 */

import { useEffect, useState } from 'react'

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (intervalMs <= 0) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}
