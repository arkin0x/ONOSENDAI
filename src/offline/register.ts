import { warmLabelFonts } from './warmFonts'

/**
 * register.ts - register the offline service worker (sw.js beside it).
 *
 * Production builds only: the dev server has no /sw.js, and a worker left
 * over from a build must not answer for the dev server on the same port, so
 * dev unregisters any it finds. updateViaCache 'none' makes the browser
 * fetch /sw.js itself fresh on every check, which is the kill switch.
 */
export function registerOfflineShell(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) {
    void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister())).catch(() => {})
    return
  }
  const register = (): void => {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      // Once the worker is in charge, so what the fonts fetch is kept.
      .then(() => navigator.serviceWorker.ready)
      .then(() => warmLabelFonts())
      .catch(() => {
        // No worker (private mode, an old browser): the app still runs online.
      })
  }
  // After load, so the precache never competes with the first paint.
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
