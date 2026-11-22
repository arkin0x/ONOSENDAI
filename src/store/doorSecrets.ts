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

import { hiddenDecided, ONLY_SAID_KEY, putSecretResult, secretRecord, SECRETS_KEY, storageMode, troubleOf, type SaveResult, type SaveTrouble } from './hiddenStorage'
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

/**
 * Why a door secret was not kept, in plain words (hiddenStorage SaveTrouble).
 * "Free some space" only when the browser said it was out of space.
 */
export const SECRET_NOT_KEPT: Record<SaveTrouble, string> = {
  full: 'This device could not save a door secret. It is known until you reload: free some space, then open or seal the door again.',
  fallback: 'This device could not save a door secret: storage did not open when this page loaded, and the small backup is full. It is known until you reload: reload, then open or seal the door again.',
  slow: 'This device\'s storage did not answer in time, so a door secret is not saved. It is known until you reload: open or seal the door again later.',
  refused: 'The browser would not save a door secret. It is known until you reload: open or seal the door again later.',
}
/** Why the secret of a door about to go out was not kept, so nothing was sent. */
export const SECRET_NOT_SENT: Record<SaveTrouble, string> = {
  full: 'This device could not save the door\'s secret, so nothing was sent. Free some space and try again.',
  fallback: 'This device could not save the door\'s secret, so nothing was sent: storage did not open when this page loaded. Reload the page and try again.',
  slow: 'This device could not save the door\'s secret, so nothing was sent: its storage did not answer in time. Try again.',
  refused: 'This device could not save the door\'s secret, so nothing was sent: the browser refused it. Try again.',
}

/** localStorage refused (local mode): the lack of space it says, unless the device has room (troubleOf). */
const localTrouble = (): Promise<SaveTrouble> => troubleOf(new DOMException('localStorage is full', 'QuotaExceededError'), 'local')

/** Say a secret was not kept, once known: a write that was only slow and then landed says nothing. */
async function saidNotKept(r: SaveResult | Promise<SaveTrouble>): Promise<void> {
  let trouble: SaveTrouble
  if (r instanceof Promise) trouble = await r
  else {
    trouble = r.trouble ?? 'refused'
    if (r.late) { const late = await r.late; if (late === null) return; trouble = late }
  }
  useToast.getState().show({ label: 'SECRET NOT SAVED', meta: SECRET_NOT_KEPT[trouble], mark: 'build' })
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
  if (storageMode() === 'local') { if (!keepLocally(me, doorId, secretHex, how)) void saidNotKept(localTrouble()); return }
  void hiddenDecided().then(() => {
    if (storageMode() === 'local') { if (!keepLocally(me, doorId, secretHex, how)) void saidNotKept(localTrouble()); return }
    return putSecretResult(record(me, doorId, secretHex, how)).then((r) => { if (!r.ok) void saidNotKept(r) })
  })
}

/**
 * Keep the secret of a door about to go out, on disk, before it does: a door
 * published with its secret lost cannot be edited from here. Rejects, in words, when
 * it cannot be kept, in either mode, and the caller publishes nothing.
 */
export async function commitDoorSecret(me: string, doorId: string, secretHex: string): Promise<void> {
  await hiddenDecided()
  if (storageMode() === 'local') {
    if (!keepLocally(me, doorId, secretHex)) throw new Error(SECRET_NOT_SENT[await localTrouble()])
    return
  }
  const r = await putSecretResult(record(me, doorId, secretHex))
  // Not sent on a slow write either: a door must not go out before its secret is on disk.
  if (!r.ok) throw new Error(SECRET_NOT_SENT[r.trouble ?? 'refused'])
}

/** For tests: forget what is kept, so the next read is from localStorage. */
export function resetDoorSecrets(): void { kept = null; onlySaid = null }
