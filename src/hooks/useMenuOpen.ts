/**
 * useMenuOpen.ts - whether the menu (the panels the hamburger shows and
 * hides) is open, kept across a refresh (arkinox, 2026-11-09: "Settings menu
 * panel reopens when I had it closed on refresh. it should stay closed").
 *
 * The folds of the panels inside it were already kept (usePanelLayout); the
 * menu itself was not, so on a desktop, where it starts open, a menu closed
 * with the hamburger came back open on every load. Now the last open or
 * closed is read before the first render, so there is no flash, and written
 * whenever it changes, by the hamburger, Escape or anything that folds it.
 *
 * Nothing saved (a first visit, or storage that is missing or throws) is the
 * old default the caller passes: open on a desktop, closed on a phone. The
 * first render writes nothing, so a visitor who never touches the menu keeps
 * getting that default as the window changes size.
 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

export const MENU_OPEN_KEY = 'onosendai:menu-open'

/** The menu as it was last left, or `fallback` when nothing usable is saved. */
export function loadMenuOpen(fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(MENU_OPEN_KEY)
    if (raw === 'open') return true
    if (raw === 'closed') return false
  } catch {
    /* private mode, or no storage: the default */
  }
  return fallback
}

export function saveMenuOpen(open: boolean): void {
  try {
    localStorage.setItem(MENU_OPEN_KEY, open ? 'open' : 'closed')
  } catch {
    /* private mode, or storage full: it lasts this page */
  }
}

/** useState for the menu's open state, starting where it was last left and saving every change. */
export function useMenuOpen(defaultOpen: boolean): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [open, setOpen] = useState(() => loadMenuOpen(defaultOpen))
  const saved = useRef(open)
  useEffect(() => {
    if (open === saved.current) return
    saved.current = open
    saveMenuOpen(open)
  }, [open])
  return [open, setOpen]
}
