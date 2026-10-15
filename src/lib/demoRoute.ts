/**
 * demoRoute.ts: onosendai.tech/demo, and /demo/<step id> to open the tour
 * on a step (store/useDemo.ts).
 */

/** The step id a /demo address names: '' for the start, null when the address is not /demo. */
export function parseDemoRoute(pathname: string): string | null {
  const m = /^\/demo(?:\/([^/]*))?\/?$/i.exec(pathname)
  if (!m) return null
  let id = m[1] ?? ''
  try { id = decodeURIComponent(id) } catch { /* as typed */ }
  return id.trim().toLowerCase()
}
