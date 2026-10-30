/**
 * versionGate.ts - whether this tab may still move, by what the deploy says.
 *
 * Every deploy serves /version.json (vite.config.ts versionFile, no-cache
 * in vercel.json): its build id and the lowest chain epoch it accepts
 * (lib/chainRulesEpoch.ts). This tab asks for it at boot, when it is focused or
 * shown again, when the network comes back, every POLL_MS, and right before
 * every move. Three answers:
 *
 * | The deploy says | Verdict | What happens |
 * |---|---|---|
 * | a higher minChainEpoch than this build's CHAIN_RULES_EPOCH | blocked | no kind 3333 is signed or sent (store whyNoMove, store signEvent, lib/publisher.ts); the chip asks for a RELOAD |
 * | the same epoch, another build | hint | the chip says a new version is out; nothing is blocked |
 * | this build, or no answer at all | ok | nothing changes |
 *
 * An error never blocks: offline, a timeout, a 404 or a file that is not a
 * version file all leave the verdict as it was, so offline play keeps
 * working and a broken deploy cannot freeze every tab. A block, once
 * learned from a real answer, stays: the deploy that said it does not
 * stop existing because the network went away. Only a reload (or a later
 * answer with a lower epoch, a revert) ends it.
 *
 * The look before a move reuses an answer up to PRE_MOVE_MAX_AGE_MS old and
 * waits at most PRE_MOVE_TIMEOUT_MS for a new one, so a move is not slowed
 * by more than that, and WALK, many moves a minute, asks the network about
 * once a minute. The fetch itself is never cut short at that: it runs for
 * BACKGROUND_TIMEOUT_MS whoever started it, so on a slow link the answer
 * still lands a moment later, refuses the next move and holds the
 * publisher (review of #530: cut at the move's 1.5 s, a slow link never
 * learned of a block from moves at all). A look that failed or timed out is
 * remembered for as long as an answer, so a flaky network costs one wait,
 * not one per move.
 *
 * In broadcast mode (the TV stream) a block reloads the page, on the
 * stream's own backoff (lib/tv/broadcast.ts reloadBroadcast): it signs no
 * movement, but it should verify by the rules the deploy now runs.
 *
 * Nothing is fetched until startVersionGate runs (App, at boot): until then
 * mayMove answers from the verdict alone, so no test that moves an avatar
 * reaches for a version file it did not ask for.
 */

import { create } from 'zustand'
import { CHAIN_RULES_EPOCH, VERSION_FILE, parseVersionFile, type DeployedVersion } from './chainRulesEpoch'
import { reloadBroadcast } from './tv/broadcast'

export type Verdict = 'ok' | 'hint' | 'blocked'

/** This build's id, from vite.config.ts; "dev" where nothing defined it. */
export const OWN_BUILD: string = typeof __ONOSENDAI_BUILD__ === 'string' ? __ONOSENDAI_BUILD__ : 'dev'

/** What a refused move says, wherever a move's refusal is said. */
export const VERSION_BLOCKED_MESSAGE = 'A new version of ONOSENDAI changed the chain rules. RELOAD to move again.'

/** An answer this recent is used before a move without asking again. */
export const PRE_MOVE_MAX_AGE_MS = 60_000
/** The longest a move waits for the deploy to answer before going ahead. */
export const PRE_MOVE_TIMEOUT_MS = 1_500
/** The longest a background look waits. */
export const BACKGROUND_TIMEOUT_MS = 8_000
/** How often an open tab looks while nothing else asks. */
export const POLL_MS = 10 * 60_000
/** Focus and visibilitychange often fire together: one look answers both. */
const WAKE_MAX_AGE_MS = 5_000

/** What the deploy's answer means for a tab running `own`. No answer means nothing. */
export function verdictOf(deployed: DeployedVersion | null, own: { build: string; epoch: number } = { build: OWN_BUILD, epoch: CHAIN_RULES_EPOCH }): Verdict {
  if (!deployed) return 'ok'
  if (deployed.minChainEpoch > own.epoch) return 'blocked'
  return deployed.build === own.build ? 'ok' : 'hint'
}

interface VersionGateState {
  verdict: Verdict
  /** What the deploy last answered, or null before any answer. */
  deployed: DeployedVersion | null
  /** When the last look ended, answered or not (Date.now()); 0 before any. */
  checkedAt: number
  /** The deployed build whose hint was dismissed; a later build hints again. */
  hintDismissed: string | null
  dismissHint: () => void
}

export const useVersionGate = create<VersionGateState>((set, get) => ({
  verdict: 'ok',
  deployed: null,
  checkedAt: 0,
  hintDismissed: null,
  dismissHint: () => set({ hintDismissed: get().deployed?.build ?? null }),
}))

/** Whether a move is refused now, from what is already known. Never waits. */
export function movementBlocked(): boolean {
  return useVersionGate.getState().verdict === 'blocked'
}

let inFlight: Promise<Verdict> | null = null
let armed = false

/** One look at the deploy's version file, at most `timeoutMs`. Never throws. */
async function look(timeoutMs: number): Promise<Verdict> {
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { abort.abort(); reject(new Error('version file: timed out')) }, timeoutMs)
  })
  let deployed: DeployedVersion | null = null
  try {
    // A fresh URL as well as no-store, so no cache between here and the deploy answers for it.
    const res = await Promise.race([fetch(`/${VERSION_FILE}?t=${Date.now()}`, { cache: 'no-store', signal: abort.signal }), late])
    if (res.ok) deployed = parseVersionFile(await Promise.race([res.json() as Promise<unknown>, late]))
  } catch {
    // Offline, a timeout, a page that is not JSON: no answer.
  } finally {
    clearTimeout(timer)
  }
  if (deployed) useVersionGate.setState({ deployed, verdict: verdictOf(deployed), checkedAt: Date.now() })
  else useVersionGate.setState({ checkedAt: Date.now() })
  return useVersionGate.getState().verdict
}

/**
 * Ask the deploy, unless an answer (or a failed look) younger than
 * `maxAgeMs` is in hand. The look runs for BACKGROUND_TIMEOUT_MS whoever
 * starts it; this caller waits on it for no longer than its own
 * `timeoutMs` and then has the verdict as it stands, while the look goes on
 * and records its answer when it lands. Resolves to the verdict; never
 * throws.
 */
export function checkVersion({ maxAgeMs = 0, timeoutMs = BACKGROUND_TIMEOUT_MS }: { maxAgeMs?: number; timeoutMs?: number } = {}): Promise<Verdict> {
  const s = useVersionGate.getState()
  if (s.checkedAt > 0 && Date.now() - s.checkedAt < maxAgeMs) return Promise.resolve(s.verdict)
  if (!inFlight) inFlight = look(BACKGROUND_TIMEOUT_MS).finally(() => { inFlight = null })
  const out = inFlight
  let timer: ReturnType<typeof setTimeout> | undefined
  const enough = new Promise<Verdict>((resolve) => { timer = setTimeout(() => resolve(useVersionGate.getState().verdict), timeoutMs) })
  return Promise.race([out, enough]).finally(() => clearTimeout(timer))
}

/**
 * The look right before a move: true unless the deploy requires a newer
 * chain epoch than this build's. A recent answer is reused; no answer in
 * time, or an error, lets the move go.
 *
 * Answered at once, with no promise, when the answer is in hand (a recent
 * one, or the gate not started), so a move that needs no look takes no
 * extra turn of the event loop: a commit's first steps run as they did
 * before the gate (store commitToward). A promise only when it must ask.
 */
export function lookBeforeMove(): boolean | Promise<boolean> {
  if (!armed) return !movementBlocked()
  const s = useVersionGate.getState()
  if (s.checkedAt > 0 && Date.now() - s.checkedAt < PRE_MOVE_MAX_AGE_MS) return s.verdict !== 'blocked'
  return checkVersion({ maxAgeMs: PRE_MOVE_MAX_AGE_MS, timeoutMs: PRE_MOVE_TIMEOUT_MS }).then((v) => v !== 'blocked')
}

/** lookBeforeMove, always as a promise. */
export async function mayMove(): Promise<boolean> {
  return lookBeforeMove()
}

/** Idempotent. Looks now, on focus, a return to the tab or the network, and every POLL_MS. */
export function startVersionGate(): void {
  if (armed) return
  armed = true
  const wake = (): void => {
    if (document.visibilityState === 'hidden') return
    void checkVersion({ maxAgeMs: WAKE_MAX_AGE_MS })
  }
  window.addEventListener('focus', wake)
  window.addEventListener('online', wake)
  document.addEventListener('visibilitychange', wake)
  useVersionGate.subscribe(reloadStreamOnBlock)
  window.setInterval(() => { void checkVersion() }, POLL_MS)
  void checkVersion()
}

/** The TV stream reloads when it learns of a block; nothing outside broadcast mode (reloadBroadcast). */
export function reloadStreamOnBlock(now: { verdict: Verdict }, prev: { verdict: Verdict }, reload: () => void = reloadBroadcast): void {
  if (now.verdict === 'blocked' && prev.verdict !== 'blocked') reload()
}

/** Tests: forget every answer; `arm` makes mayMove look, as startVersionGate does, without its listeners. */
export function resetVersionGateForTests(arm = false): void {
  armed = arm
  inFlight = null
  useVersionGate.setState({ verdict: 'ok', deployed: null, checkedAt: 0, hintDismissed: null })
}
