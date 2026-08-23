/**
 * time.ts — when something happened, as a person would say it.
 *
 * Relative for the glance ("3 min ago"), with the caller free to put the exact
 * stamp in a title. Coarse on purpose: the chain explorer and the avatar list
 * are read while doing something else, and "47 minutes ago" is not a number
 * anyone wanted.
 */

/** `at` and `now` in seconds since the epoch. */
export function formatAgo(at: number, now: number = Date.now() / 1000): string {
  const d = Math.max(0, Math.floor(now - at))
  if (d < 5) return 'just now'
  if (d < 60) return `${d} s ago`
  if (d < 3600) return `${Math.floor(d / 60)} min ago`
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} d ago`
  return `${Math.floor(d / (86400 * 30))} mo ago`
}

/** Exact, for a title: local time, ISO-like, no milliseconds. */
export function formatStamp(at: number): string {
  return new Date(at * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}

/** Short form of a 64-char hex id for a label, first and last few chars. */
export function shortHex(hex: string, head = 8, tail = 6): string {
  if (hex.length <= head + tail + 1) return hex
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`
}
