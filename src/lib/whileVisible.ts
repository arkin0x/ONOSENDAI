/**
 * whileVisible.ts: a timer's work that only matters on screen.
 *
 * A hidden desktop tab keeps its timers, throttled, where a phone freezes it. A
 * clock that re-renders a panel nobody can see, or a measure of a layout nobody
 * can see, is work with no reader. Each comes round again within its own
 * interval of the tab returning, so nothing is lost by waiting.
 */

/** `fn`, doing nothing while the page is hidden. */
export function whileVisible(fn: () => void): () => void {
  return () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    fn()
  }
}
