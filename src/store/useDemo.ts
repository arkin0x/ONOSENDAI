/**
 * useDemo.ts: the /demo guided tour's engine (arkinox, 2026-10-14).
 *
 * The script (src/demo/script.ts) is data; this walks it. Each step sets the
 * scene through the machinery the app already has (a free view for a place,
 * the /C/ route for a block, the zoom, the scene layers, the chat dock), and
 * a step that asks the visitor to do something watches the stores for it.
 * NEXT always works: waiting is an invitation, never a gate.
 *
 * The tour runs LOCAL. Entering it remembers the publishing switch and sets
 * LOCAL; leaving puts the switch back, unless the visitor chose GO LIVE in
 * the last step, which is then their setting. The tour itself never signs or
 * publishes anything: a hop the visitor makes is theirs, proved and signed
 * on this device like any hop, and stays on it while LOCAL.
 */

import { create } from 'zustand'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { DEMO_DISTRICT, DEMO_SCRIPT } from '../demo/script'
import type { DemoAction, DemoScene, DemoScript, DemoStep } from '../demo/types'
import { stopSpeaking } from '../demo/voice'
import { coordPlace } from '../lib/coordRoute'
import { MAX_SCALE_EXP } from '../lib/space'
import { startCoordRoute } from './useCoordRoute'
import { exitHyperspaceView, useHyperspace } from './useHyperspace'
import { useToast } from './useToast'
import { useChat } from './useChat'
import { useCyberspace } from './useCyberspace'
import { useLayers, type SceneLayer } from './useLayers'
import { useShards } from './useShards'
import { useWalk } from './useWalk'

interface DemoState {
  active: boolean
  /** The step on screen, an index into the script's steps. */
  index: number
  /** Whether the current step's `wait` has happened (true for a step with none). */
  done: boolean
  /** Folded to a one-line bar; NEXT and BACK still work from the keys. */
  minimized: boolean
  /** The publishing switch before the tour, put back on exit. */
  prevLive: boolean
  script: DemoScript
  start: (stepId?: string) => void
  next: () => void
  back: () => void
  goTo: (index: number) => void
  exit: () => void
  setMinimized: (minimized: boolean) => void
  /** GO LIVE from the last step: LIVE stays after the tour ends. */
  wentLive: () => void
}

/** What undoes the current step's watchers (store subscriptions, the /C/ route). */
let stepCleanups: Array<() => void> = []

function cleanupStep(): void {
  for (const c of stepCleanups.splice(0)) { try { c() } catch { /* already gone */ } }
}

/** The 64-hex place a step's target names, or null for 'self' and 'keep'. */
function placeOf(target: DemoScene['target'], pubkey: string): { hex: string; label: string } | null {
  if (target === 'spawn') return { hex: pubkey, label: 'YOUR SPAWN' }
  if (target === 'district') return { hex: DEMO_DISTRICT.coord, label: DEMO_DISTRICT.label }
  if (typeof target === 'object' && 'coord' in target) return { hex: target.coord, label: target.label }
  return null
}

/** History for the /C/ machinery when the tour drives it: the address stays /demo. */
const tourHistory: Pick<History, 'replaceState'> = { replaceState: () => {} }

/** The cursor back on your own position, unless a proof is running from it. */
function homeCursor(): void {
  const now = useCyberspace.getState()
  if (now.proof.status === 'computing' || now.walking) return
  const { position, cursor, headPlane } = now
  if (cursor.x !== position.x || cursor.y !== position.y || cursor.z !== position.z || now.plane !== headPlane) {
    useCyberspace.setState({ cursor: { ...position }, plane: headPlane })
  }
}

/** Take down a block step's sticky toast ("Block N · port/landfall"), and only that. */
function dismissBlockToast(): void {
  const t = useToast.getState().toast
  if (t && t.sticky && /^Block [\d,]+ · (port|landfall)$/.test(t.label)) useToast.getState().dismiss()
}

/** Put the scene where a step says. Returns nothing; watchers go in stepCleanups. */
export function applyScene(scene: DemoScene, walkStep = false): void {
  const cs = useCyberspace.getState()
  const target = scene.target
  // WALK is the walk step's alone: any later step that sets a scene ends it,
  // its own position included, or chapter 5 opened in first person on the
  // black sun alone (rehearsal, 2026-10-15). `walkStep` keeps it for the
  // step that asks for it.
  if (target !== 'keep' && cs.walking && !walkStep) useWalk.getState().exit()
  // A block step leaves the scene in the hyperspace stop view, which is its
  // own state beside the focus: clearing the focus alone left VIEWING
  // HYPERSPACE and its RETURN on screen for the rest of the tour, with the
  // cursor still out at the stop (rehearsal, 2026-10-15).
  if (target !== 'keep' && useHyperspace.getState().viewOwned) exitHyperspaceView()
  if (target === 'self') {
    if (cs.spectate) cs.endSpectate()
    if (useCyberspace.getState().focus) useCyberspace.getState().clearFocus(true)
    homeCursor()
  } else if (target !== 'keep') {
    const place = placeOf(target, cs.identity.pubkey)
    if (place) {
      const { position, plane } = coordPlace(place.hex)
      useCyberspace.getState().focusOn(position, plane, place.label)
    } else if (typeof target === 'object' && 'block' in target) {
      // The /C/ route's own machinery: a merkle root or block hash lands on
      // its hyperspace stop, with the block's toast (useCoordRoute.ts).
      stepCleanups.push(startCoordRoute({ pathname: `/C/${target.block}`, search: '', hash: '' }, tourHistory))
      // The block's toast waits for a tap; the tour takes its own toast with it.
      stepCleanups.push(dismissBlockToast)
    }
  }
  if (scene.scale !== undefined) {
    const now = useCyberspace.getState()
    const want = Math.max(0, Math.min(MAX_SCALE_EXP, scene.scale))
    if (want !== now.scaleExp) now.adjustScale(want - now.scaleExp)
  }
  if (scene.layers) for (const [layer, on] of Object.entries(scene.layers)) if (on !== undefined) useLayers.getState().setLayer(layer as SceneLayer, on)
  if (scene.chat) useChat.getState().setOpen(true)
}

/**
 * Watch the stores for the visitor doing `action`, from now on. Calls
 * `onDone` once. A condition already true (WALK already on) counts at once.
 */
export function watchAction(action: DemoAction, onDone: () => void): () => void {
  let fired = false
  const fire = (): void => { if (!fired) { fired = true; onDone() } }
  if (action === 'hop') {
    const base = useCyberspace.getState().events.length
    return useCyberspace.subscribe((s) => {
      if (s.events.length <= base) return
      const head = s.events[s.events.length - 1]
      const a = head?.tags.find((t) => t[0] === 'A')?.[1]
      if (a === 'hop' || a === 'sidestep') fire()
    })
  }
  if (action === 'walk') {
    if (useCyberspace.getState().walking) { fire(); return () => {} }
    return useCyberspace.subscribe((s) => { if (s.walking) fire() })
  }
  if (action === 'open-item') {
    return useShards.subscribe((s, prev) => { if (s.selectedSecret !== null && s.selectedSecret !== prev.selectedSecret) fire() })
  }
  // scan: one that is running now, or starts after this, has to finish.
  let started = useShards.getState().scanning
  return useShards.subscribe((s) => {
    if (s.scanning) started = true
    else if (started) fire()
  })
}

/** The coordinate a pubkey spawns at (spec §3.1), for tests and panels. */
export function spawnPlace(pubkey: string): { x: bigint; y: bigint; z: bigint; plane: number } {
  return coordToXyz(hexToCoord(pubkey))
}

function stepAt(state: { script: DemoScript }, index: number): DemoStep | undefined {
  return state.script.steps[index]
}

export const useDemo = create<DemoState>((set, get) => {
  const enter = (index: number): void => {
    cleanupStep()
    stopSpeaking()
    const step = stepAt(get(), index)
    if (!step) return
    set({ index, done: !step.wait })
    applyScene(step.scene, step.wait === 'walk')
    if (step.wait) stepCleanups.push(watchAction(step.wait, () => { if (get().index === index && get().active) set({ done: true }) }))
  }

  return {
    active: false,
    index: 0,
    done: true,
    minimized: false,
    prevLive: false,
    script: DEMO_SCRIPT,

    start: (stepId) => {
      const cs = useCyberspace.getState()
      // Remembered once: starting again while running keeps the first answer.
      if (!get().active) set({ prevLive: cs.live })
      if (cs.live) cs.setLive(false)
      const at = stepId ? get().script.steps.findIndex((s) => s.id === stepId) : 0
      set({ active: true, minimized: false })
      enter(at >= 0 ? at : 0)
    },

    next: () => {
      if (!get().active) return
      const i = get().index + 1
      if (i < get().script.steps.length) enter(i)
    },

    back: () => {
      if (!get().active) return
      const i = get().index - 1
      if (i >= 0) enter(i)
    },

    goTo: (index) => {
      if (!get().active) return
      if (index >= 0 && index < get().script.steps.length) enter(index)
    },

    exit: () => {
      if (!get().active) return
      cleanupStep()
      stopSpeaking()
      const cs = useCyberspace.getState()
      if (cs.walking) useWalk.getState().exit()
      if (useHyperspace.getState().viewOwned) exitHyperspaceView()
      if (useCyberspace.getState().focus) useCyberspace.getState().clearFocus()
      homeCursor()
      dismissBlockToast()
      if (useCyberspace.getState().live !== get().prevLive) useCyberspace.getState().setLive(get().prevLive)
      set({ active: false, minimized: false })
      try { if (/^\/demo(\/|$)/i.test(window.location.pathname)) window.history.replaceState(null, '', '/') } catch { /* no history here */ }
    },

    setMinimized: (minimized) => set({ minimized }),

    wentLive: () => set({ prevLive: true }),
  }
})
