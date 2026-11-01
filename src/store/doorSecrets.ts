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

const ONLY_SAID_KEY = 'onosendai:door-secrets-only-said'
let onlySaid: Record<string, Record<string, true>> | null = null

function saidByAll(): Record<string, Record<string, true>> {
  if (onlySaid) return onlySaid
  try {
    const raw = JSON.parse(localStorage.getItem(ONLY_SAID_KEY) ?? '{}') as unknown
    onlySaid = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, Record<string, true>>) : {}
  } catch { onlySaid = {} }
  return onlySaid
}

/**
 * Whether the secret kept for a door came from another door of its room, not from
 * this door's own seal. §3.7.5 has a reader open them all, and one secret to a room
 * makes that right; but a second secret can exist, so it is only what was said.
 */
export function doorSecretOnlySaid(me: string, doorId: string): boolean {
  return !!saidByAll()[me]?.[doorId]
}

/** The door secret this identity knows for a door, or null. */
export function doorSecret(me: string, doorId: string): string | null {
  const s = all()[me]?.[doorId]
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s) ? s : null
}

/** Keep a door secret this identity has learned: by opening the door, or by sealing it. */
export function keepDoorSecret(me: string, doorId: string, secretHex: string, how?: { onlySaid: true }): void {
  const said = saidByAll()
  const marks = { ...(said[me] ?? {}) }
  if (how?.onlySaid) marks[doorId] = true
  else delete marks[doorId]
  said[me] = marks
  try { localStorage.setItem(ONLY_SAID_KEY, JSON.stringify(said)) } catch { /* quota or private mode: known for this session */ }
  const a = all()
  const mine = { ...(a[me] ?? {}), [doorId]: secretHex }
  const ids = Object.keys(mine)
  if (ids.length > SECRETS_MAX) for (const id of ids.slice(0, ids.length - SECRETS_MAX)) delete mine[id]
  a[me] = mine
  try { localStorage.setItem(SECRETS_KEY, JSON.stringify(a)) } catch { /* quota or private mode: known for this session */ }
}

/** For tests: forget what is kept, so the next read is from localStorage. */
export function resetDoorSecrets(): void { kept = null; onlySaid = null }
