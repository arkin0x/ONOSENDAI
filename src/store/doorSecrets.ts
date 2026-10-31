/**
 * doorSecrets.ts: the door secrets this identity knows, on this device
 * (DECK-0004 §3.7.4, "Editing from another device"; chest and door design,
 * 4.11).
 *
 * A door's secret is sealed to its lock and nowhere else. The device that
 * sealed the door keeps it from that moment; any other device learns it the
 * way a finder does, by opening the door. Per identity, by door id. It is
 * knowledge, as an item is, and never leaves this device.
 */

const SECRETS_KEY = 'onosendai:door-secrets'
/** Enough for years of play; the oldest fall off past it. */
const SECRETS_MAX = 2000

let kept: Record<string, Record<string, string>> | null = null

function all(): Record<string, Record<string, string>> {
  if (kept) return kept
  try {
    const raw = JSON.parse(localStorage.getItem(SECRETS_KEY) ?? '{}') as unknown
    kept = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, Record<string, string>>) : {}
  } catch { kept = {} }
  return kept
}

/** The door secret this identity knows for a door, or null. */
export function doorSecret(me: string, doorId: string): string | null {
  const s = all()[me]?.[doorId]
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s) ? s : null
}

/** Keep a door secret this identity has learned: by opening the door, or by sealing it. */
export function keepDoorSecret(me: string, doorId: string, secretHex: string): void {
  const a = all()
  const mine = { ...(a[me] ?? {}), [doorId]: secretHex }
  const ids = Object.keys(mine)
  if (ids.length > SECRETS_MAX) for (const id of ids.slice(0, ids.length - SECRETS_MAX)) delete mine[id]
  a[me] = mine
  try { localStorage.setItem(SECRETS_KEY, JSON.stringify(a)) } catch { /* quota or private mode: known for this session */ }
}

/** For tests: forget what is kept, so the next read is from localStorage. */
export function resetDoorSecrets(): void { kept = null }
