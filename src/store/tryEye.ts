/**
 * tryEye.ts - TRY WALK in SET EYE (avatar eye, UI A "the eye on the bench";
 * arkinox, 2026-11-16): walk with the workshop shard's eye before anything is
 * published, then come back to SET EYE where you left it.
 *
 * While a try runs, the WALK camera (scene/Scene.tsx Rig) and your own drawn
 * avatar (scene/AvatarShape.tsx) take the shard on the bench in place of the
 * avatar you wear, for your own pubkey only and on this device only. Nothing
 * is signed or published by the try itself; the steps you take are real
 * moves, as any WALK's are. WALK is entered the pad's way (padMode
 * enterWalk), so BUILD and SCAN end as the WALK button ends them, spectating,
 * history and hyperspace transit refuse it, and leaving goes back to the mode
 * it was entered from.
 *
 * Leaving WALK on purpose, the pad's way out (padMode leaveWalk: the lit
 * WALK, the mode button, X), still at your head, opens the workshop again on
 * the same shard, its UNDO and REDO as they were, with the eye in hand. Any
 * other end of the walk (spectating, history, VIEW, the demo or tutorial, a
 * respawn) ends the try silently and clears the override. So do DONE,
 * anything else that puts the eye down, and the workshop opening some other
 * way meanwhile. The walls a try walks against are the worn avatar's, as in
 * any WALK (store/walkWalls.ts).
 */

import { create } from 'zustand'
import type { ShardModel } from 'sno-core/shards'
import { useCyberspace } from './useCyberspace'
import { enterWalk, walkLeaves } from './padMode'
import { useWorkshop, type Tool } from './useWorkshop'

interface TryEyeState {
  /** Whose eye is overridden: your pubkey, while a try runs. */
  pubkey: string | null
  /** The workshop shard as it was when TRY WALK was pressed. */
  shard: ShardModel | null
}

export const useTryEye = create<TryEyeState>(() => ({ pubkey: null, shard: null }))

/** The shard whose eye WALK looks from for `pubkey` while a try runs, else null. */
export function tryEyeFor(pubkey: string): ShardModel | null {
  const t = useTryEye.getState()
  return t.shard && t.pubkey === pubkey ? t.shard : null
}

/** Where to come back to: the shard on the bench, its history, the tool in hand. */
interface Back { id: string; past: ShardModel[]; future: ShardModel[]; tool: Tool }

let unsubscribe: (() => void) | null = null

/** The try over, nothing to come back to. */
export function clearTryEye(): void {
  unsubscribe?.()
  unsubscribe = null
  if (useTryEye.getState().shard) useTryEye.setState({ pubkey: null, shard: null })
}

/** The workshop as it was, SET EYE on. */
function comeBack(back: Back): void {
  const w = useWorkshop.getState()
  if (!w.shards.some((s) => s.id === back.id)) { w.openWorkshop(); return }
  w.openWorkshop(back.id)
  useWorkshop.setState({ past: back.past, future: back.future, tool: back.tool })
  useWorkshop.getState().setEyeEdit(true)
}

/**
 * TRY WALK: the workshop closes, WALK starts where you stand the pad's way
 * (padMode enterWalk), looking from the workshop shard's eye. False, with the
 * workshop left open and a line on the bench, when WALK cannot start.
 */
export function startTryWalk(): boolean {
  const w = useWorkshop.getState()
  const shard = w.current()
  if (!shard) return false
  const back: Back = { id: shard.id, past: w.past, future: w.future, tool: w.tool }
  const pubkey = useCyberspace.getState().identity.pubkey
  clearTryEye()
  w.closeWorkshop()
  useTryEye.setState({ pubkey, shard })
  enterWalk()
  if (!useCyberspace.getState().walking) {
    clearTryEye()
    comeBack(back)
    useWorkshop.setState({ notice: 'WALK cannot start from here right now.' })
    return false
  }
  const leftBefore = walkLeaves()
  const offWalk = useCyberspace.subscribe((s) => {
    if (s.walking) return
    // Left the pad's way, or ended by something else (the demo, spectating, history, a respawn)?
    const onPurpose = walkLeaves() > leftBefore
    clearTryEye()
    if (!onPurpose) return
    // After the pad's way out has finished putting the earlier mode back, and
    // only still on your own head: not spectating, not in history.
    queueMicrotask(() => {
      const cs = useCyberspace.getState()
      if (cs.walking || cs.spectate !== null || cs.exploreIndex !== null || useWorkshop.getState().open) return
      comeBack(back)
    })
  })
  // The workshop opened some other way while walking: the try is over, and nothing to come back to.
  const offOpen = useWorkshop.subscribe((s, prev) => { if (s.open && !prev.open) clearTryEye() })
  unsubscribe = () => { offWalk(); offOpen() }
  return true
}

// Putting the eye down (DONE, Esc, E, a tool, a sheet) ends a try.
useWorkshop.subscribe((s, prev) => { if (prev.eyeEdit && !s.eyeEdit) clearTryEye() })
