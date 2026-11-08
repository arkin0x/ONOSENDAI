/**
 * useOpenedChests.ts: the chests this identity opened by hand, on this
 * device.
 *
 * Nothing opens by itself (arkinox, 2026-10-26: "everything must be opened
 * or taken manually. that's the whole Zelda experience."): a chest opens
 * when OPEN is tapped, and only then. What OPEN opened stays opened: its
 * contents, by `${identity}/${chest id}`, for the session (a chest opened
 * in one list stays open in the next, and a list leaves out the rows its
 * open chests already list), and the chest's id, kept in localStorage per
 * identity, so after a reload the scan opens that chest again, as it was,
 * with the item still held (useShards addDiscovered). A chest never opened
 * by hand is never opened by a reload, a scan or a TAKE.
 *
 * Per identity, so another identity on this device never sees what this
 * one's keys or signer opened.
 *
 * Per lock: what was opened stays opened under the lock it was opened with,
 * and a new lock closes it again for everyone who opened it before (chest
 * and door design, R10: "a new lock rotates the room key: earlier openers
 * lose the room from then on"). Today the lock is signed into the chest's
 * own event, so a new lock is a new id anyway; this holds once a door's
 * identity outlives its lock (its room, spec #82).
 *
 * CLOSE (arkinox, 2026-11-01): a door this identity opened can be closed again,
 * on this device only. Closed is kept beside opened, per identity and per lock
 * (`${door id}:${lock}`), so a reload, a scan or a relay update never opens it
 * again: only OPEN does, which forgets the close. A door closed is not opened by
 * hand (openedByHand), whatever was kept of its opening, so every reader of that
 * (the look, WALK, the reload's reopening) sees it shut. Its secret stays kept
 * (store/doorSecrets), so OPEN needs no key the second time.
 */

import { create } from 'zustand'
import type { ChestEntry } from '../lib/chests'

const OPENED_KEY = 'onosendai:chests-opened'
const CLOSED_KEY = 'onosendai:doors-closed'
/** Enough for years of play; the oldest opened fall off past it, and show OPEN again. */
const OPENED_MAX = 2000

export const openedKey = (me: string, chestId: string): string => `${me}/${chestId}`

interface OpenedChestsState {
  /** What each chest opened this session held, by openedKey. */
  opened: Record<string, ChestEntry[]>
}

export const useOpenedChests = create<OpenedChestsState>(() => ({ opened: {} }))

/**
 * The chests opened by hand, by identity, as kept: `${chest id}:${lock}`, or
 * a bare id kept before the lock was (its id names its lock: see above).
 */
let kept: Record<string, string[]> | null = null

const keptAs = (chestId: string, lock: string): string => `${chestId}:${lock}`
const keptFor = (entry: string, chestId: string): boolean => entry === chestId || entry.startsWith(`${chestId}:`)

function keptIds(): Record<string, string[]> {
  if (kept) return kept
  try {
    const raw = JSON.parse(localStorage.getItem(OPENED_KEY) ?? '{}') as unknown
    kept = {}
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [owner, ids] of Object.entries(raw as Record<string, unknown>)) {
        if (Array.isArray(ids)) kept[owner] = ids.filter((x): x is string => typeof x === 'string')
      }
    }
  } catch { kept = {} }
  return kept
}

function save(all: Record<string, string[]>): void {
  try { localStorage.setItem(OPENED_KEY, JSON.stringify(all)) } catch { /* quota or private mode: it stays open this session */ }
}

/** The doors closed with CLOSE, by identity, as `${door id}:${lock}`. */
let closed: Record<string, string[]> | null = null

function closedIds(): Record<string, string[]> {
  if (closed) return closed
  try {
    const raw = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '{}') as unknown
    closed = {}
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [owner, ids] of Object.entries(raw as Record<string, unknown>)) {
        if (Array.isArray(ids)) closed[owner] = ids.filter((x): x is string => typeof x === 'string')
      }
    }
  } catch { closed = {} }
  return closed
}

function saveClosed(all: Record<string, string[]>): void {
  try { localStorage.setItem(CLOSED_KEY, JSON.stringify(all)) } catch { /* quota or private mode: it stays closed this session */ }
}

/**
 * Whether this identity closed this door with CLOSE, under this lock. Without a
 * lock, under any: for what stands in a room whose door is not at hand.
 */
export function closedByMe(me: string, doorId: string, lock?: string): boolean {
  const ids = closedIds()[me]
  if (!ids) return false
  return lock === undefined ? ids.some((e) => keptFor(e, doorId)) : ids.includes(keptAs(doorId, lock))
}

/** The door ids this identity closed, under any lock: what worldOf leaves out the rooms of. */
export function closedDoorIds(me: string): Set<string> {
  return new Set((closedIds()[me] ?? []).map((e) => e.split(':')[0]))
}

/**
 * CLOSE closed it: kept, so it stays closed across a reload, and what this
 * session read of it forgotten, so every card and the world redraw it shut.
 * Its opening stays kept, and its secret too: OPEN opens it again with no key.
 */
export function rememberClosed(me: string, doorId: string, lock: string): void {
  const all = closedIds()
  const ids = all[me] ?? []
  if (!ids.includes(keptAs(doorId, lock))) {
    all[me] = [...ids.filter((e) => !keptFor(e, doorId)), keptAs(doorId, lock)].slice(-OPENED_MAX)
    saveClosed(all)
  }
  // A fresh record even when this session read nothing of it: every card and the world draw from it, and redraw it shut.
  useOpenedChests.setState((s) => {
    const opened = { ...s.opened }
    delete opened[openedKey(me, doorId)]
    return { opened }
  })
}

/** OPEN on a door closed before: the close forgotten, under every lock. */
function forgetClosed(me: string, doorId: string): void {
  const all = closedIds()
  const ids = all[me]
  if (!ids || !ids.some((e) => keptFor(e, doorId))) return
  all[me] = ids.filter((e) => !keptFor(e, doorId))
  saveClosed(all)
}

/**
 * Whether this identity opened this chest by hand on this device, under the
 * lock it has now (`lock`, its lock pubkey). A bare id kept before locks were
 * is kept from now on with the lock it is first asked with, which its id
 * named, so it does not outlive a new lock either.
 */
export function openedByHand(me: string, chestId: string, lock: string): boolean {
  // Closed with CLOSE: shut, until OPEN.
  if (closedByMe(me, chestId, lock)) return false
  const all = keptIds()
  const ids = all[me]
  if (!ids) return false
  if (ids.includes(keptAs(chestId, lock))) return true
  const bare = ids.indexOf(chestId)
  if (bare < 0) return false
  all[me] = ids.map((e, i) => (i === bare ? keptAs(chestId, lock) : e))
  save(all)
  return true
}

/**
 * The word a list gives a chest or a door: what the world draws (scene/
 * ChestLooks), so it is OPEN for a door open only because another of its room
 * was (the secret only said, store/rooms.ts), and LOCKED for one holding
 * another secret, which that door's opening left shut. Not whether this
 * session has read the contents: a reload forgets those, and it stays open.
 */
export function lockWord(me: string, chestId: string, lock: string): 'OPEN' | 'LOCKED' {
  return openedByHand(me, chestId, lock) ? 'OPEN' : 'LOCKED'
}

/**
 * What this identity opened of this chest this session, while its lock is
 * the one it was opened under, or null: what a card lists and the world
 * floats out of it.
 */
export function openedContents(opened: Record<string, ChestEntry[]>, me: string, chestId: string, lock: string): ChestEntry[] | null {
  return openedByHand(me, chestId, lock) ? opened[openedKey(me, chestId)] ?? null : null
}

/** OPEN opened it: what was inside, for the session, and its id with its lock, kept, so a reload opens it again. A close before is forgotten. */
export function rememberOpened(me: string, chestId: string, lock: string, contents: ChestEntry[]): void {
  forgetClosed(me, chestId)
  useOpenedChests.setState((s) => ({ opened: { ...s.opened, [openedKey(me, chestId)]: contents } }))
  const all = keptIds()
  const ids = all[me] ?? []
  if (ids.includes(keptAs(chestId, lock))) return
  // Opened again under a new lock: that lock replaces the one before.
  all[me] = [...ids.filter((e) => !keptFor(e, chestId)), keptAs(chestId, lock)].slice(-OPENED_MAX)
  save(all)
}

/**
 * Reads again (hud/ItemRows readAgain) that failed this session, a signer
 * refusing, by identity, chest and lock: not asked again each time the card
 * is shown, only when OPEN is tapped.
 */
const refused = new Set<string>()
const refusalKey = (me: string, chestId: string, lock: string): string => `${openedKey(me, chestId)}:${lock}`

/** Whether reading this chest again failed this session for this identity, under this lock. */
export function readRefused(me: string, chestId: string, lock: string): boolean {
  return refused.has(refusalKey(me, chestId, lock))
}

/** Reading it again failed: remembered for the session. */
export function refuseRead(me: string, chestId: string, lock: string): void {
  refused.add(refusalKey(me, chestId, lock))
}

/** OPEN was tapped: a refusal before is forgotten. */
export function forgetRefusal(me: string, chestId: string, lock: string): void {
  refused.delete(refusalKey(me, chestId, lock))
}

/** A chest opened again by a reload's scan: what was inside, for the session. Its id is kept already. */
export function restoreOpened(me: string, chestId: string, contents: ChestEntry[]): void {
  useOpenedChests.setState((s) => ({ opened: { ...s.opened, [openedKey(me, chestId)]: contents } }))
}

/** For tests: forget what is kept (opened and closed), so the next read is from localStorage, and every refusal. */
export function resetOpenedChests(): void {
  kept = null
  closed = null
  refused.clear()
  useOpenedChests.setState({ opened: {} })
}
