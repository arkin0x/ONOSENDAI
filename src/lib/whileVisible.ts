/**
 * whileVisible.ts: a timer's work that only matters on screen.
 *
 * A hidden desktop tab keeps its timers, throttled, where a phone freezes it. A
 * clock that re-renders a panel nobody can see, or a measure of a layout nobody
 * can see, is work with no reader.
 *
 * Not for anything that asks a relay: a poll that waits leaves a hole it may
 * never read across (review of #564, the notification poll).
 */

/** `fn`, doing nothing while the page is hidden. */
export function whileVisible(fn: () => void): () => void {
  return () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    fn()
  }
}

/**
 * Run `fn` every `ms` while the page can be seen, and once as it comes back, so a
 * label is right the moment it is read. The return stops it.
 */
export function everyWhileVisible(fn: () => void, ms: number): () => void {
  const timer = setInterval(whileVisible(fn), ms)
  const back = (): void => { if (document.visibilityState === 'visible') fn() }
  document.addEventListener('visibilitychange', back)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', back)
  }
}
