/**
 * buildRoute.ts: "Build something", followed one press at a time until
 * something stands in the world (owner, 2026-11-23: "this step doesnt pulse
 * anything, and shows too many things from the menu at once. it should
 * follow each step until you place something in the world").
 *
 * One tour step (tutorial/script.ts BUILD_PLACE) whose next press is worked
 * out again from what the player has really done each time anything changes
 * (buildStage), so going off script never strands them: closing the menu
 * early points back at the menu button, another shard picked is as good as
 * the first, a shard already in the workshop skips the moving. The stage's
 * line stands in place of the step's hint and its control pulses (the step
 * note and highlight; the pulse survives a control's class changing,
 * hud/TutorialCoach.tsx markPulse):
 *
 *   1. menu      the menu button, while the menu is shut;
 *   2. loot      OTHER LOOT, with ITEMS alone in the menu;
 *   3. actions   ACTIONS on a shard's row; then
 *      move      MOVE TO WORKSHOP under it;
 *   4. close     the ITEMS card's ✕, then the menu button, to see the world;
 *      build     the mode button, round to BUILD (or B);
 *   5. object    OBJECT on the BUILD bar; then
 *      pick      a shard in the picker;
 *   6. place     HIDE on the placing bar, aimed with the arrows.
 *
 * The step waits for 'placed' (something placed since it came up) and stays
 * on its ✓ with FINISH (TutorialStep stay); BACK and SKIP stay as on every
 * step. Nothing here moves, places or signs anything: those are the
 * player's presses.
 */

import { registerTutorialEffect, registerTutorialWatcher, useTutorial } from '../store/useTutorial'
import { useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { useShards } from '../store/useShards'
import { useWorkshop } from '../store/useWorkshop'
import { usePanelLayout } from '../store/usePanelLayout'
import { useMenuIsOpen } from '../hooks/useMenuOpen'
import { useItemsModal, useOpenActions } from '../hud/InventoryPanel'
import { useStash } from '../hud/stash'
import { MENU_SHUT } from './script'

/** Where the player is in placing something. */
export type BuildStage = 'menu' | 'loot' | 'actions' | 'move' | 'close' | 'build' | 'object' | 'pick' | 'place'

/** What buildStage reads: the player's real state, nothing the tour keeps. */
export interface BuildFacts {
  menuOpen: boolean
  /** The ITEMS card open: 'loot' for OTHER LOOT. */
  itemsOpen: 'keys' | 'loot' | null
  /** ACTIONS open on a shard's row in OTHER LOOT. */
  shardActionsOpen: boolean
  /** A shard of the player's is in the workshop: moved there in this step, or there already. */
  inWorkshop: boolean
  building: boolean
  /** The OBJECT picker open. */
  picking: boolean
  /** Something lined up to place. */
  lined: boolean
}

/** The next press, from what the player has done, the latest first so any order of doing it lands right. Pure. */
export function buildStage(f: BuildFacts): BuildStage {
  if (f.lined) return 'place'
  if (f.picking) return 'pick'
  if (f.building) return 'object'
  if (f.inWorkshop) {
    if (f.itemsOpen !== null || f.menuOpen) return 'close'
    return 'build'
  }
  if (f.itemsOpen === 'loot') return f.shardActionsOpen ? 'move' : 'actions'
  if (f.itemsOpen === 'keys') return 'close'
  return f.menuOpen ? 'loot' : 'menu'
}

/** Each stage's line, in place of the step's hint, and the control it pulses. */
export const BUILD_STAGES: Readonly<Record<BuildStage, { note: string; glow: string }>> = {
  menu: { note: 'Open the menu.', glow: MENU_SHUT },
  loot: { note: 'Tap OTHER LOOT.', glow: '[data-panel-id="items"] .items-kinds__go--loot' },
  actions: { note: 'Pick a shard: tap its ACTIONS.', glow: '.items-modal--loot [data-kind="shard"] .held__acts .chest__act' },
  move: { note: 'Tap MOVE TO WORKSHOP.', glow: '.items-modal--loot .held__move' },
  close: { note: 'Close the menu to see the world.', glow: '.items-modal .modal-close, .hamburger-menu[aria-expanded="true"]' },
  build: { note: 'Tap the mode button until it says BUILD (or press B).', glow: '.touchops__commit.is-hop, .touchops__commit.is-view, .touchops__commit.is-scan' },
  object: { note: 'Tap OBJECT.', glow: '.buildbar__act[aria-label="Place object"]' },
  pick: { note: 'Tap the shard you moved.', glow: '.objpick__row:not(:disabled)' },
  // The placing bar's own button (hud/DeployBar.tsx): HIDE (LOCAL), or HIDE & PUBLISH while ONLINE.
  place: { note: 'Aim with the arrows, then tap HIDE to place it.', glow: '.deploybar__deploy' },
}

/** Workshop shards that are the player's own (not the tour's copies, tutorial-...). */
function ownShards(): number {
  return useWorkshop.getState().shards.filter((s) => !s.id.startsWith('tutorial-')).length
}

/**
 * The build step's effect: ITEMS first and alone in the menu while the step
 * is up (usePanelLayout front and frontOnly, never written to the saved
 * order), and the stage worked out again on every change. Returns what
 * takes it all away.
 */
registerTutorialEffect('teach-build', () => {
  const index = useTutorial.getState().index
  const layout = usePanelLayout.getState()
  layout.setFront('items')
  layout.setFrontOnly(true)
  const point = (): void => {
    const open = useOpenActions.getState().open
    const facts: BuildFacts = {
      menuOpen: useMenuIsOpen.getState().open,
      itemsOpen: useItemsModal.getState().open,
      shardActionsOpen: open !== null && typeof document !== 'undefined' && document.querySelector(`[data-actions-row="${CSS.escape(open)}"][data-kind="shard"]`) !== null,
      inWorkshop: ownShards() > 0,
      building: useBuilder.getState().active,
      picking: useStash.getState().models,
      lined: useShards.getState().pending !== null,
    }
    const stage = BUILD_STAGES[buildStage(facts)]
    useTutorial.getState().noteStep(index, stage.note)
    useTutorial.getState().highlightStep(index, stage.glow)
  }
  point()
  const offs = [
    useMenuIsOpen.subscribe(point),
    useItemsModal.subscribe(point),
    useOpenActions.subscribe(point),
    useWorkshop.subscribe((s, prev) => { if (s.shards !== prev.shards) point() }),
    useBuilder.subscribe((s, prev) => { if (s.active !== prev.active) point() }),
    useStash.subscribe(point),
    useShards.subscribe((s, prev) => { if (s.pending !== prev.pending) point() }),
    useCyberspace.subscribe((s, prev) => { if (s.walking !== prev.walking) point() }),
  ]
  return () => {
    for (const off of offs) off()
    const l = usePanelLayout.getState()
    l.setFrontOnly(false)
    if (l.front === 'items') l.setFront(null)
  }
})

/** Something placed in the world since the step came up (useShards placedLast, set on every placement). */
registerTutorialWatcher('placed', (onDone) => {
  const before = useShards.getState().placedLast
  let fired = false
  return useShards.subscribe((s) => {
    if (fired || s.placedLast === null || s.placedLast === before) return
    fired = true
    onDone()
  })
})
