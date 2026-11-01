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

import { hiddenDecided, ONLY_SAID_KEY, putSecret, secretRecord, SECRETS_KEY, storageMode } from './hiddenStorage'
import { useToast } from './useToast'

/** In local mode only (store/hiddenStorage.ts): the database has no such limit. The oldest fall off past it. */
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
  if (storageMode() === 'indexeddb') return !!secretRecord(me, doorId)?.onlySaid
  return !!saidByAll()[me]?.[doorId]
}

/** The door secret this identity knows for a door, or null. */
export function doorSecret(me: string, doorId: string): string | null {
  const s = storageMode() === 'indexeddb' ? secretRecord(me, doorId)?.secret : all()[me]?.[doorId]
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s) ? s : null
}

const NOT_KEPT = 'This device could not save a door secret. It is known until you reload: free some space, then open or seal the door again.'

function saidNotKept(): void {
  useToast.getState().show({ label: 'SECRET NOT SAVED', meta: NOT_KEPT, mark: 'build' })
}

/** As it always was, for local mode: whether it reached localStorage. */
function keepLocally(me: string, doorId: string, secretHex: string, how?: { onlySaid: true }): boolean {
  let ok = true
  const said = saidByAll()
  const marks = { ...(said[me] ?? {}) }
  if (how?.onlySaid) marks[doorId] = true
  else delete marks[doorId]
  said[me] = marks
  try { localStorage.setItem(ONLY_SAID_KEY, JSON.stringify(said)) } catch { ok = false }
  const a = all()
  const mine = { ...(a[me] ?? {}), [doorId]: secretHex }
  const ids = Object.keys(mine)
  if (ids.length > SECRETS_MAX) for (const id of ids.slice(0, ids.length - SECRETS_MAX)) delete mine[id]
  a[me] = mine
  try { localStorage.setItem(SECRETS_KEY, JSON.stringify(a)) } catch { ok = false }
  return ok
}

function record(me: string, doorId: string, secretHex: string, how?: { onlySaid: true }): { owner: string; doorId: string; secret: string; onlySaid?: true } {
  return { owner: me, doorId, secret: secretHex, ...(how?.onlySaid ? { onlySaid: true as const } : {}) }
}

/**
 * Keep a door secret this identity has learned, by opening the door: known at
 * once, and saved behind that. A failure says so. For a door about to go out, use
 * commitDoorSecret.
 */
export function keepDoorSecret(me: string, doorId: string, secretHex: string, how?: { onlySaid: true }): void {
  if (storageMode() === 'local') { if (!keepLocally(me, doorId, secretHex, how)) saidNotKept(); return }
  void hiddenDecided().then(() => {
    if (storageMode() === 'local') { if (!keepLocally(me, doorId, secretHex, how)) saidNotKept(); return }
    return putSecret(record(me, doorId, secretHex, how)).then((ok) => { if (!ok) saidNotKept() })
  })
}

/**
 * Keep the secret of a door about to go out, on disk, before it does: a door
 * published with its secret lost cannot be edited from here. Rejects, in words, when
 * the database refuses, and the caller publishes nothing. In local mode this is the
 * path it always was: a failure says so, and the door still goes.
 */
export async function commitDoorSecret(me: string, doorId: string, secretHex: string): Promise<void> {
  await hiddenDecided()
  if (storageMode() === 'local') { if (!keepLocally(me, doorId, secretHex)) saidNotKept(); return }
  if (!await putSecret(record(me, doorId, secretHex))) {
    throw new Error('This device could not save the door\'s secret, so nothing was sent. Free some space and try again.')
  }
}

/** For tests: forget what is kept, so the next read is from localStorage. */
export function resetDoorSecrets(): void { kept = null; onlySaid = null }
