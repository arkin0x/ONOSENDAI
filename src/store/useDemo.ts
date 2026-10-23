/**
 * useDemo.ts: the /demo guided tour's engine (arkinox, 2026-10-14).
 *
 * The script (src/demo/script.ts) is data; this walks it. Each step sets the
 * scene through the machinery the app already has (a free view for a place,
 * the /C/ route for a block, the zoom, the scene layers, the chat dock), and
 * a step that asks the visitor to do something watches the stores for it.
 * Waiting is an invitation (NEXT reads SKIP), except on a step with `gate`,
 * where NEXT waits for it (arkinox, 2026-10-15: the spawn, a first hop, and
 * a move on the chain step).
 *
 * The tour runs LOCAL. Entering it remembers the publishing switch and sets
 * LOCAL; leaving puts the switch back, unless the visitor chose GO LIVE in
 * the last step, which is then their setting. The tour signs one thing, and
 * only when pressed: SPAWN, offered only to a key the tour generated itself
 * that has no chain yet. A login, a switch or a page load never signs a
 * spawn. A hop the visitor makes is theirs, proved and signed on this
 * device like any hop, and stays on it while LOCAL.
 */

import { create } from 'zustand'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { DEMO_CURATORS, DEMO_DISTRICT, DEMO_SCRIPT } from '../demo/script'
import type { DemoAction, DemoScene, DemoScript, DemoStep } from '../demo/types'
import { stopSpeaking } from '../demo/voice'
import { coordPlace } from '../lib/coordRoute'
import { clampAxis, MAX_SCALE_EXP } from '../lib/space'
import { moveDirection } from '../lib/moves'
import { startCoordRoute, useCoordRoute } from './useCoordRoute'
import { exitHyperspaceView, useHyperspace } from './useHyperspace'
import { useToast } from './useToast'
import { useChat } from './useChat'
import { appMinted, keyMintedOnLoad, useCyberspace } from './useCyberspace'
import { useLayers, type SceneLayer } from './useLayers'
import { useShards } from './useShards'
import { useWalk } from './useWalk'

interface DemoState {
  active: boolean
  /** The step on screen, an index into the script's steps. */
  index: number
  /** Whether the current step's `wait` has happened (true for a step with none). */
  done: boolean
  /** The step's 'open-item' wait found nothing to open once the scan was done (DemoStep.emptyHint). */
  empty: boolean
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

/**
 * The tour's key: decided when a tour starts (not when it resumes after a
 * reload) and remembered here, so a reload mid-tour keeps the answer.
 */
export const TOUR_KEY_KEY = 'onosendai:demo:tourKey'

/**
 * Whether the identity on screen counts as the tour's key at a tour's
 * start: a key this app generated on this device (not an imported nsec,
 * ncryptsec, extension or bunker) with no chain yet (arkinox's ruling,
 * 2026-10-15). A new visitor who lands on / gets a key there and then taps
 * the question bubble is the common case; the old rule only counted a key
 * made on the same page load as the tour, so that visitor was treated as an
 * existing identity, got their default LIVE back on FINISH, and their next
 * hop published the tour chain. A key generated before the marker existed
 * (appMinted null) keeps the old rule: made on this page load.
 */
export function tourKeyAtStart(): boolean {
  const cs = useCyberspace.getState()
  if (cs.signerKind !== 'local' || cs.events.length > 0) return false
  const pubkey = cs.identity.pubkey
  // Made on this page load counts whatever the marker says: two tabs opened
  // together on a first visit each make a key, and the marker names only
  // the last one written (review of #362, 2026-10-15).
  return appMinted(pubkey) === true || keyMintedOnLoad() === pubkey
}

/** Decide the tour's key for a tour starting now. */
function noteTourKey(): void {
  const pubkey = useCyberspace.getState().identity.pubkey
  try {
    if (tourKeyAtStart()) localStorage.setItem(TOUR_KEY_KEY, pubkey)
    else localStorage.removeItem(TOUR_KEY_KEY)
  } catch { /* private mode */ }
}

/**
 * What a tour changes in the view and puts back on EXIT or FINISH, taken
 * when the tour starts and kept on the device so a reload mid-tour still
 * puts it back: the zoom (a custom avatar is drawn as the plain marker above
 * 2^0, so a tour that left the zoom out left the avatar looking reset until
 * a reload, arkinox 2026-10-15), the scene layers the boundary steps turn
 * on, whether the chat dock was open, and whom you were spectating. Also whether the identity came in with
 * hops of its own (the chain step's gate, DemoStep.gateUnlessHadHops). The
 * avatar's position is never put back: a tour hop is a real move.
 */
export const SESSION_KEY = 'onosendai:demo:session'

export interface TourSession {
  scaleExp: number
  layers: Record<SceneLayer, boolean>
  chatOpen: boolean
  hadHops: boolean
  /** The pubkey being spectated when the tour started; the tour's first step ends it. */
  spectate?: string | null
}

function readSession(): TourSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<TourSession>
    if (typeof v.scaleExp !== 'number' || typeof v.hadHops !== 'boolean' || typeof v.chatOpen !== 'boolean' || typeof v.layers !== 'object' || v.layers === null) return null
    return v as TourSession
  } catch { return null }
}
function writeSession(v: TourSession | null): void {
  try { if (v === null) localStorage.removeItem(SESSION_KEY); else localStorage.setItem(SESSION_KEY, JSON.stringify(v)) } catch { /* private mode */ }
}

function takeSession(): TourSession {
  const cs = useCyberspace.getState()
  const l = useLayers.getState()
  return {
    scaleExp: cs.scaleExp,
    layers: { dots: l.dots, boxes: l.boxes, walkAvatarHidden: l.walkAvatarHidden, walkLookSphere: l.walkLookSphere },
    chatOpen: useChat.getState().open,
    hadHops: hasHop(cs.events),
    spectate: cs.spectate?.pubkey ?? null,
  }
}

/** Put back what the tour changed in the view (TourSession), zoom last. */
function restoreSession(v: TourSession): void {
  for (const [layer, on] of Object.entries(v.layers) as Array<[SceneLayer, boolean]>) {
    if (useLayers.getState()[layer] !== on) useLayers.getState().setLayer(layer, on)
  }
  if (useChat.getState().open !== v.chatOpen) useChat.getState().setOpen(v.chatOpen)
  const now = useCyberspace.getState()
  const want = Math.max(0, Math.min(MAX_SCALE_EXP, v.scaleExp))
  if (now.scaleExp !== want) now.adjustScale(want - now.scaleExp)
  // Watching someone again, unless something since already put you on someone.
  if (v.spectate && useCyberspace.getState().spectate === null) useCyberspace.getState().beginSpectate(v.spectate)
}

/** Whether the identity came into this tour with hops of its own. */
export function hadHopsAtStart(): boolean {
  return readSession()?.hadHops ?? false
}

/** A history entry the tour pushed itself (startTourInPlace), so EXIT can step back off it. */
const PUSHED = 'onosendaiDemo'

/** Whether the identity on screen is the key the tour generated (and signs locally). */
export function isTourKey(): boolean {
  const cs = useCyberspace.getState()
  if (cs.signerKind !== 'local') return false
  try { return localStorage.getItem(TOUR_KEY_KEY) === cs.identity.pubkey } catch { return false }
}

/**
 * Whether the tour offers SPAWN now: the identity is the key the tour
 * generated, signs locally, and has no chain yet. Any other identity is
 * never offered it.
 */
export function tourKeyNeedsSpawn(): boolean {
  return useCyberspace.getState().events.length === 0 && isTourKey()
}

/** Whether a chain holds a hop or a sidestep of its own. */
function hasHop(events: ReadonlyArray<{ tags: string[][] }>): boolean {
  return events.some((e) => { const a = e.tags.find((t) => t[0] === 'A')?.[1]; return a === 'hop' || a === 'sidestep' })
}

/** Whether a step's gate is open now: done, or a hop gate the identity came in past. */
export function gateHeld(step: DemoStep | undefined, done: boolean): boolean {
  if (!step?.gate || done) return false
  return !(step.gateUnlessHadHops && hadHopsAtStart())
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

/**
 * The cursor back on your own position and the scene back in your own
 * plane, unless a proof is running from it. The plane goes back through
 * setPlane, which puts the shown plane back as well as the lined-up one:
 * setting only the lined-up plane left the scene in ideaspace after the
 * cube step until the next hop (2026-10-15).
 */
function homeCursor(): void {
  const now = useCyberspace.getState()
  if (now.proof.status === 'computing' || now.walking) return
  const { position, cursor, headPlane } = now
  if (cursor.x !== position.x || cursor.y !== position.y || cursor.z !== position.z) {
    useCyberspace.setState({ cursor: { ...position } })
  }
  if (now.exploreIndex === null && (now.plane !== headPlane || now.anchorPlane !== headPlane)) now.setPlane(headPlane)
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
    // Your own head: out of the chain's history if it was being browsed,
    // where the scene stands on an older action and in its plane.
    if (useCyberspace.getState().exploreIndex !== null) useCyberspace.getState().explore(null)
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
  if (scene.plane !== undefined && target === 'self') useCyberspace.getState().setPlane(scene.plane)
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
  if (action === 'spawn') {
    // Done once SPAWN is no longer the tour's to offer: signed, a chain
    // arrived, or the identity is not the tour's key (then at once).
    if (!tourKeyNeedsSpawn()) { fire(); return () => {} }
    return useCyberspace.subscribe(() => { if (!tourKeyNeedsSpawn()) fire() })
  }
  if (action === 'own-hop') {
    if (hasHop(useCyberspace.getState().events)) { fire(); return () => {} }
    return useCyberspace.subscribe((s) => { if (hasHop(s.events)) fire() })
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

/**
 * Put the cursor `aim` gibsons from where you stand, along the pad's own up,
 * right and forward (into the screen), as the pad would move it; with
 * `aim.scale`, at that zoom first. Only at your head, never mid-proof.
 */
export function aimCursor(aim: NonNullable<DemoStep['aim']>): void {
  const cs = useCyberspace.getState()
  if (!cs.atHead() || cs.walking || cs.proof.status === 'computing') return
  if (aim.scale !== undefined && aim.scale !== cs.scaleExp) cs.adjustScale(aim.scale - cs.scaleExp)
  const now = useCyberspace.getState()
  const axes = now.screenAxes ?? now.axes()
  const cursor = { ...now.position }
  for (const [name, n] of [['up', aim.up], ['right', aim.right], ['away', aim.forward]] as const) {
    const d = moveDirection(axes, name)
    cursor[d.axis] = clampAxis(cursor[d.axis] + BigInt(n * d.dir))
  }
  useCyberspace.setState({ cursor, plane: now.headPlane })
}

/** The coordinate a pubkey spawns at (spec §3.1), for tests and panels. */
export function spawnPlace(pubkey: string): { x: bigint; y: bigint; z: bigint; plane: number } {
  return coordToXyz(hexToCoord(pubkey))
}

/**
 * The publishing switch from before the tour, kept on the device while the
 * tour runs: the tour's LOCAL is saved like any switch change, so a reload
 * mid-tour (or a closed tab) would otherwise forget that the visitor was
 * LIVE and leave them LOCAL for good (rehearsal, 2026-10-15).
 */
export const PREV_LIVE_KEY = 'onosendai:demo:prevLive'

function readPrevLive(): boolean | null {
  try { const v = localStorage.getItem(PREV_LIVE_KEY); return v === null ? null : v === '1' } catch { return null }
}
function writePrevLive(v: boolean | null): void {
  try { if (v === null) localStorage.removeItem(PREV_LIVE_KEY); else localStorage.setItem(PREV_LIVE_KEY, v ? '1' : '0') } catch { /* private mode */ }
}

/**
 * Outside /demo: a tour left without EXIT (the tab closed, the address
 * changed) puts the switch back as the visitor had it, once.
 */
export function restoreAfterUnfinishedTour(): void {
  // The layers and the chat are kept on the device too; the zoom is not, and
  // a fresh page starts at its own.
  const session = readSession()
  if (session) {
    writeSession(null)
    restoreSession({ ...session, scaleExp: useCyberspace.getState().scaleExp, spectate: null })
  }
  const prev = readPrevLive()
  if (prev === null) return
  writePrevLive(null)
  if (useCyberspace.getState().live !== prev) useCyberspace.getState().setLive(prev)
}

/**
 * Start the tour where you are, without a page load (the question bubble,
 * AskBubble.tsx): the address becomes /demo on a new history entry the tour
 * marks as its own, so Back leaves the tour (App's popstate) and EXIT steps
 * back off it rather than leaving a dead /demo entry behind.
 */
export function startTourInPlace(): void {
  // A /C/ link's view still on screen ends first, as the tour's first step
  // would end it a moment later: its ending puts / in place of its own
  // address (useCoordRoute.ts), and after the push that would be the /demo
  // entry, leaving the tour running on / (review of #362, 2026-10-15).
  if (useCoordRoute.getState().label !== null && useCyberspace.getState().focus) useCyberspace.getState().clearFocus(true)
  try { window.history.pushState({ [PUSHED]: 1 }, '', '/demo') } catch { /* no history here */ }
  useDemo.getState().start()
}

function stepAt(state: { script: DemoScript }, index: number): DemoStep | undefined {
  return state.script.steps[index]
}

/**
 * Steps that were removed, to the nearest step still there, so an old
 * /demo/<id> link still lands somewhere sensible (arkinox, 2026-10-15:
 * chapter 2 now makes the hops, and no-cheat carries the proof fact).
 */
export const STEP_ALIASES: Record<string, string> = { hop: 'no-cheat', 'hop-event': 'no-cheat' }

/** Gated steps already done this tour: going BACK and on again does not ask twice. */
const gatesPassed = new Set<string>()

export const useDemo = create<DemoState>((set, get) => {
  const enter = (index: number): void => {
    cleanupStep()
    stopSpeaking()
    const step = stepAt(get(), index)
    if (!step) return
    set({ index, empty: false, done: !step.wait || (step.gate === true && gatesPassed.has(step.id)) })
    // The district's steps show only the curators' things; every other step the whole world.
    useShards.getState().setCurated(step.scene.curated ? DEMO_CURATORS : null)
    applyScene(step.scene, step.wait === 'walk')
    if (step.wait && !get().done) {
      stepCleanups.push(watchAction(step.wait, () => {
        if (get().index !== index || !get().active) return
        if (step.gate) gatesPassed.add(step.id)
        set({ done: true })
      }))
    }
    // Nothing to open here (the place is empty, or nothing the curators
    // placed): once the scan is done the step says so and counts as done,
    // rather than waiting on a tap that cannot come. Something arriving
    // later makes it a wait again. After the watcher above, so a step that
    // opened empty still hears the tap once something lands; and only
    // something arriving undoes "empty", not a later scan merely starting,
    // so the line does not flicker on every rescan (review of #364).
    if (step.wait === 'open-item' && step.emptyHint) {
      const check = (): void => {
        if (get().index !== index || !get().active) return
        const sh = useShards.getState()
        const any = sh.worldItems().length > 0
        if (!any && !sh.scanning && !get().done) set({ done: true, empty: true })
        else if (any && get().empty) set({ done: false, empty: false })
      }
      check()
      stepCleanups.push(useShards.subscribe(check))
    }
    // A step with no wait aims as a preview; one with a wait, until it happens.
    if (step.aim && (!step.wait || !get().done)) aimCursor(step.aim)
  }

  return {
    active: false,
    index: 0,
    done: true,
    empty: false,
    minimized: false,
    prevLive: false,
    script: DEMO_SCRIPT,

    start: (stepId) => {
      const cs = useCyberspace.getState()
      if (!get().active) {
        gatesPassed.clear()
        // A tour starting, not one resuming after a reload (which finds its
        // own answers kept on the device): decide the tour's key and take
        // what the view is, to put back on EXIT.
        if (readPrevLive() === null) { noteTourKey(); writeSession(takeSession()) }
        else if (!readSession()) writeSession(takeSession())
      }
      // Remembered once: starting again while running keeps the first answer,
      // and so does a reload mid-tour (PREV_LIVE_KEY).
      if (!get().active) {
        // The switch to put back on EXIT. A key the tour generated had no
        // switch of its own before the tour (a new visitor starts LIVE by
        // default, which nobody chose), so it goes back to LOCAL unless GO
        // LIVE is pressed (wentLive): FINISH used to flip a new visitor to
        // LIVE, and their next hop published the whole tour chain (review of
        // #337, 2026-10-15). Any other identity gets its own switch back.
        const prev = readPrevLive() ?? (isTourKey() ? false : cs.live)
        writePrevLive(prev)
        set({ prevLive: prev })
      }
      if (cs.live) cs.setLive(false)
      const id = stepId ? STEP_ALIASES[stepId] ?? stepId : undefined
      const at = id ? get().script.steps.findIndex((s) => s.id === id) : 0
      set({ active: true, minimized: false })
      enter(at >= 0 ? at : 0)
    },

    next: () => {
      if (!get().active) return
      // A gated step waits for its action (DemoStep.gate).
      if (gateHeld(stepAt(get(), get().index), get().done)) return
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
      // First, before anything below can throw: the whole world is back.
      useShards.getState().setCurated(null)
      stopSpeaking()
      const cs = useCyberspace.getState()
      if (cs.walking) useWalk.getState().exit()
      if (useHyperspace.getState().viewOwned) exitHyperspaceView()
      if (useCyberspace.getState().focus) useCyberspace.getState().clearFocus()
      homeCursor()
      dismissBlockToast()
      const session = readSession()
      if (session) restoreSession(session)
      writeSession(null)
      if (useCyberspace.getState().live !== get().prevLive) useCyberspace.getState().setLive(get().prevLive)
      writePrevLive(null)
      set({ active: false, minimized: false })
      // Off the /demo address. An entry the tour pushed itself is stepped
      // back off, so Back from the page you return to does not land on a
      // /demo entry that no longer starts anything; a /demo the visitor
      // loaded is replaced by / as before.
      try {
        if (/^\/demo(\/|$)/i.test(window.location.pathname)) {
          if ((window.history.state as Record<string, unknown> | null)?.[PUSHED]) window.history.back()
          else window.history.replaceState(null, '', '/')
        }
      } catch { /* no history here */ }
    },

    setMinimized: (minimized) => set({ minimized }),

    wentLive: () => { writePrevLive(true); set({ prevLive: true }) },
  }
})
