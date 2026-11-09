/**
 * scrollMemory.ts - where a long list was scrolled to, kept while the list is
 * gone, and put back when it is drawn again (arkinox, 2026-11-09: "preserving
 * the scroll position in the workshop menu would be very helpful. the list of
 * shards is very long.").
 *
 * A list is named by a key, its owner's pubkey and the list's own name
 * (scrollKey), so two lists never share a place and one identity never lands
 * where another left off. The place is kept in memory for the session and in
 * sessionStorage, so a reload keeps it too; sessionStorage may be missing or
 * refuse (private mode, a full quota), and then memory alone serves.
 *
 * attachScrollMemory watches one scrolling element under one key. Every
 * scroll the user makes is remembered. On attach it puts the remembered place
 * back, once: as soon as the list is tall enough to reach it exactly, or,
 * once the caller says the list is complete (`isReady`), as near as the list
 * now reaches. Not before: a list that loads progressively is never scrolled
 * part way and then again as rows arrive, which would jump under the reader.
 *
 * The user comes first. A wheel, a touch, a press or a key on the list before
 * the place is put back, or a scroll the restore did not make, ends the
 * restore: their scroll stays where they put it, and is what is remembered.
 *
 * Pure DOM, no React, so a test can drive it with a stand-in element
 * (hooks/useScrollMemory.ts is the React side).
 */

/** What attachScrollMemory needs of the scrolling element. */
export interface ScrollBox {
  scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
  addEventListener(type: string, fn: () => void, opts?: AddEventListenerOptions): void
  removeEventListener(type: string, fn: () => void): void
}

/** A watched list: settle() tries the restore again; detach() stops watching. */
export interface ScrollMemory {
  settle: () => void
  detach: () => void
}

const PREFIX = 'onosendai:scroll:'

/** The user's hand on the list: any of these before the restore ends it. */
const INTENT = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const

/** This session's places, by key. */
const places = new Map<string, number>()

/** One list's key: whose it is and which list. */
export function scrollKey(list: string, owner: string): string {
  return `${owner}:${list}`
}

/** The place kept for a key, or 0. */
export function recallScroll(key: string): number {
  const held = places.get(key)
  if (held !== undefined) return held
  try {
    const n = Number(window.sessionStorage.getItem(PREFIX + key))
    if (Number.isFinite(n) && n > 0) {
      places.set(key, n)
      return n
    }
  } catch { /* no sessionStorage: memory only */ }
  return 0
}

/** Keep a place for a key, in memory and, where it can, in sessionStorage. */
export function rememberScroll(key: string, top: number): void {
  const n = Math.max(0, Math.round(top))
  places.set(key, n)
  try { window.sessionStorage.setItem(PREFIX + key, String(n)) } catch { /* memory only */ }
}

/** Forget every place held in memory (tests; sessionStorage is left). */
export function forgetScrollMemory(): void {
  places.clear()
}

/**
 * Watch `el` under `key`: remember where the user scrolls it, and put the
 * remembered place back once (see the file's comment). `isReady` says the
 * list has drawn every row it is going to; until then the place goes back
 * only once the list can reach it exactly.
 */
export function attachScrollMemory(el: ScrollBox, key: string, isReady: () => boolean = () => true): ScrollMemory {
  const target = recallScroll(key)
  let done = target <= 0
  // Where the restore last put the list: a scroll anywhere else is the user's.
  let ours = el.scrollTop
  let watcher: MutationObserver | null = null

  const finish = (): void => {
    done = true
    watcher?.disconnect()
    watcher = null
  }
  const settle = (): void => {
    if (done) return
    const room = el.scrollHeight - el.clientHeight
    if (room < target && !isReady()) return
    el.scrollTop = Math.min(target, Math.max(0, room))
    ours = el.scrollTop
    finish()
  }
  const onScroll = (): void => {
    if (!done && Math.abs(el.scrollTop - ours) > 1) finish()
    if (done) rememberScroll(key, el.scrollTop)
  }

  el.addEventListener('scroll', onScroll, { passive: true })
  for (const t of INTENT) el.addEventListener(t, finish, { passive: true })
  settle()
  // Rows that arrive without the caller drawing (a memoized list inside it)
  // try the restore again as they land.
  if (!done && typeof MutationObserver !== 'undefined' && typeof Node !== 'undefined' && el instanceof Node) {
    watcher = new MutationObserver(settle)
    watcher.observe(el, { childList: true, subtree: true })
  }

  return {
    settle,
    detach: () => {
      watcher?.disconnect()
      watcher = null
      el.removeEventListener('scroll', onScroll)
      for (const t of INTENT) el.removeEventListener(t, finish)
    },
  }
}
