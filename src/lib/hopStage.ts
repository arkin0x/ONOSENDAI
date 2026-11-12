/**
 * hopStage.ts: the order a hop is shown in (owner, 2026-11-12: "When I do
 * the first hop I never see the animation it seems to just freeze for a
 * second and then I appear at the next location").
 *
 * Nothing here changes a move. The proof, the event and the store's step to
 * the new place are exactly what they were; this only orders what is SHOWN
 * around that step:
 *   1. the work comes first: the proof (its worker), the signature and the
 *      check all finish before the store moves, as they always did;
 *   2. the glide may wait a moment for the camera (holdGlide): the tutorial's
 *      first hop frames start and end before the avatar sets off;
 *   3. what can wait for the glide does (afterHop): discovery's scan and its
 *      decryption, which reveal the chest, and the camera's next shot. Each
 *      runs in its own idle slot once the avatar has arrived, so none of it
 *      lands in the frames the glide is drawn in.
 *
 * Measured before (scripts/hop-probe.mjs, 2026-11-12): a newcomer's first
 * hop drew no glide frame at all, and the landing frame took 280 to 1,050 ms
 * as the trail's material compiled and the box's bags opened under it.
 */

import { AVATAR_LERP_MS } from './avatarLerp'

/**
 * How long past the glide's planned end the deferred work waits at most for
 * the avatar to report that it arrived: a scene that is not drawing (the
 * workshop over it, a hidden tab) never reports, and discovery must not wait
 * on it.
 */
export const HOP_SETTLE_SLACK_MS = 1500

let holdUntil = 0
let landing = false
let queue: Array<() => void> = []
let timer: ReturnType<typeof setTimeout> | null = null

/** An idle callback where there is one, the next task where there is not. */
function later(fn: () => void): void {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
  if (idle) idle(fn, { timeout: 200 })
  else setTimeout(fn, 0)
}

/**
 * The next glide of your own avatar starts no earlier than `until`
 * (performance.now() time): the camera is still easing into place. A hold
 * that has passed by the time the move lands holds nothing.
 */
export function holdGlide(until: number): void {
  holdUntil = until
}

/** When a glide registered at `now` starts: the hold, if one is still ahead, and the hold is spent. */
export function glideStart(now: number): number {
  const at = Math.max(now, holdUntil)
  holdUntil = 0
  return at
}

/**
 * Your own move is about to land (the store moves next): what asks to wait
 * for the glide waits from now until the avatar arrives (glideDone), or until
 * the planned glide plus HOP_SETTLE_SLACK_MS, whichever is first.
 */
export function hopLanding(now: number = performance.now()): void {
  landing = true
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(flush, Math.max(0, holdUntil - now) + AVATAR_LERP_MS + HOP_SETTLE_SLACK_MS)
}

/** The avatar arrived, or was put there without a glide: what waited runs. */
export function glideDone(): void {
  if (landing) flush()
}

/**
 * Run `fn` once your own avatar has finished arriving, in an idle slot of
 * its own; at once when no move of yours is landing.
 */
export function afterHop(fn: () => void): void {
  if (!landing) { fn(); return }
  queue.push(fn)
}

/** Whether a move of yours has landed and its glide is not over. */
export function hopSettling(): boolean {
  return landing
}

function flush(): void {
  landing = false
  if (timer !== null) { clearTimeout(timer); timer = null }
  const run = queue
  queue = []
  for (const fn of run) later(() => { try { fn() } catch (err) { console.warn('[hop] deferred work failed:', err) } })
}

/**
 * A frame budget for a loop of main-thread work (opening a region's bags):
 * the returned pause yields to the browser, so a frame can be drawn, once
 * `ms` have gone since the last yield, and costs nothing before that.
 */
export function frameBudget(ms = 8): () => Promise<void> {
  let since = performance.now()
  return async () => {
    if (performance.now() - since < ms) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    since = performance.now()
  }
}

/** Forget every hold and queue: for tests. */
export function resetHopStage(): void {
  holdUntil = 0
  landing = false
  queue = []
  if (timer !== null) { clearTimeout(timer); timer = null }
}
