/**
 * settingsLink.ts: open the menu at one row of Settings (hud/ViewPanel.tsx),
 * from somewhere else on screen: the line under the LOSING SYNC warning
 * (hud/SyncWarning.tsx; arkinox, 2026-11-18: "maybe below the red chain sync
 * warning box it can say 'turn off this warning in settings'").
 *
 * The menu opens, the Settings panel unfolds if it was folded (that choice is
 * saved, as a tap on its title would save it), and once it is drawn the row's
 * switch is scrolled to the middle of its column and takes the focus, so a
 * keyboard can flip it at once. Nothing is switched for you.
 */

import { setMenuOpen } from '../hooks/useMenuOpen'
import { usePanelLayout } from '../store/usePanelLayout'

/** The Settings row for WALK's sync limit (store/walkLimits.ts). */
export const WALK_LIMITS_ROW = 'view-walk-limits'

/** How long, in ms, the row waits for the menu to draw before it gives up looking for its switch. */
const FIND_MS = 1500

/** Open the menu at Settings row `id` (a switch's id there). */
export function openSettingAt(id: string): void {
  setMenuOpen(true)
  const layout = usePanelLayout.getState()
  if (layout.collapsed.view) layout.toggle('view')
  const start = Date.now()
  const find = (): void => {
    const el = typeof document !== 'undefined' ? document.getElementById(id) : null
    if (el) {
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      el.focus?.({ preventScroll: true })
      return
    }
    if (Date.now() - start < FIND_MS) setTimeout(find, 50)
  }
  setTimeout(find, 0)
}
