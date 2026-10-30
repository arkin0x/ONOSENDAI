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
 */

import { create } from 'zustand'
import type { ChestEntry } from '../lib/chests'

const OPENED_KEY = 'onosendai:chests-opened'
/** Enough for years of play; the oldest opened fall off past it, and show OPEN again. */
const OPENED_MAX = 2000

export const openedKey = (me: string, chestId: string): string => `${me}/${chestId}`

interface OpenedChestsState {
  /** What each chest opened this session held, by openedKey. */
  opened: Record<string, ChestEntry[]>
}

export const useOpenedChests = create<OpenedChestsState>(() => ({ opened: {} }))

/** The ids of the chests opened by hand, by identity, as kept. */
let kept: Record<string, string[]> | null = null

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

/** Whether this identity opened this chest by hand on this device. */
export function openedByHand(me: string, chestId: string): boolean {
  return keptIds()[me]?.includes(chestId) ?? false
}

/** OPEN opened it: what was inside, for the session, and its id, kept, so a reload opens it again. */
export function rememberOpened(me: string, chestId: string, contents: ChestEntry[]): void {
  useOpenedChests.setState((s) => ({ opened: { ...s.opened, [openedKey(me, chestId)]: contents } }))
  const all = keptIds()
  const ids = all[me] ?? []
  if (ids.includes(chestId)) return
  all[me] = [...ids, chestId].slice(-OPENED_MAX)
  try { localStorage.setItem(OPENED_KEY, JSON.stringify(all)) } catch { /* quota or private mode: it stays open this session */ }
}

/** A chest opened again by a reload's scan: what was inside, for the session. Its id is kept already. */
export function restoreOpened(me: string, chestId: string, contents: ChestEntry[]): void {
  useOpenedChests.setState((s) => ({ opened: { ...s.opened, [openedKey(me, chestId)]: contents } }))
}

/** For tests: forget what is kept, so the next read is from localStorage. */
export function resetOpenedChests(): void {
  kept = null
  useOpenedChests.setState({ opened: {} })
}
