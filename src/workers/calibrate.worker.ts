/**
 * calibrate.worker.ts - a quiet one-shot movement benchmark.
 *
 * The app's nominal Cantor ceiling is h20, but a real h20 hop computes up to
 * three axis trees plus terrain, and the BigInt levels of one big tree alone
 * allocate hundreds of megabytes: on real machines the tab stalls or dies well
 * below the nominal cap. Rather than let the UI promise a hop the machine
 * cannot finish, this worker measures what THIS machine actually does: single
 * axis Cantor trees at increasing heights, and the raw SHA-256 rate that
 * bounds a Merkle sidestep. lib/calibration.ts turns the timings into the
 * recommended ceilings.
 *
 * The benchmark is budgeted so the cure is not the disease: it climbs past
 * h16 only while total time stays under ~12 s AND the next height's projected
 * cost (growth fitted from the last two measurements, floored at 3x per
 * height) stays under ~8 s. It never touches h21+, and it stops BEFORE the
 * measurement that would have wedged this thread, not after.
 */

import { AXIS_CENTER, computeAxisMerkleRoot, computeSubtreeCantor } from 'cyberspace-core'

export interface CalibrateRequest {
  id: number
}

export type CalibrateResponse =
  | {
      type: 'result'
      id: number
      /** Wall-clock ms for ONE axis tree at each height actually measured. */
      cantorMsByHeight: Record<number, number>
      /** Measured SHA-256 throughput, hashes per second. */
      sha256PerSec: number
    }
  | { type: 'error'; id: number; message: string }

/** Always measured: cheap everywhere, and enough points to fit the growth. */
const BASE_HEIGHTS = [12, 14, 16]
/** Climbed one at a time, each step gated by the budgets below. */
const CLIMB_HEIGHTS = [17, 18, 19, 20]
/** Once total benchmark time passes this, stop climbing. */
const TOTAL_BUDGET_MS = 12_000
/** Never start a measurement projected to take longer than this. */
const NEXT_STEP_CAP_MS = 8_000
/** Cantor cost roughly triples per height (2x the leaves times widening
 * BigInts). The gate assumes at least this much growth so an optimistic pair
 * of fast timings cannot talk it into a tree it will never finish. */
const GROWTH_FLOOR = 3
/** Above every height measured here, so the core never refuses a tree. */
const BENCH_MAX_COMPUTE_HEIGHT = 22

/** An awaited macrotask between measurements, so a terminate() from the main
 * thread lands between trees instead of only after all of them. */
function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

self.onmessage = async (event: MessageEvent<CalibrateRequest>) => {
  const { id } = event.data
  try {
    const cantorMsByHeight: Record<number, number> = {}
    let total = 0
    const measure = (h: number): void => {
      const t0 = performance.now()
      // AXIS_CENTER is 2^84, so it is the aligned base of its own subtree at
      // every height used here: the timing is a real tree, not an error path.
      computeSubtreeCantor(AXIS_CENTER, h, BENCH_MAX_COMPUTE_HEIGHT)
      const elapsed = performance.now() - t0
      cantorMsByHeight[h] = elapsed
      total += elapsed
    }

    for (const h of BASE_HEIGHTS) {
      measure(h)
      await breathe()
    }

    let prev = BASE_HEIGHTS[BASE_HEIGHTS.length - 2]
    let last = BASE_HEIGHTS[BASE_HEIGHTS.length - 1]
    for (const h of CLIMB_HEIGHTS) {
      if (total >= TOTAL_BUDGET_MS) break
      // Project the next step from the last two timings. Coarse timers can
      // report ~0 ms at low heights; clamping keeps the ratio finite.
      const msPrev = Math.max(cantorMsByHeight[prev], 0.5)
      const msLast = Math.max(cantorMsByHeight[last], 0.5)
      const perHeight = Math.max(GROWTH_FLOOR, Math.pow(msLast / msPrev, 1 / (last - prev)))
      if (msLast * Math.pow(perHeight, h - last) >= NEXT_STEP_CAP_MS) break
      measure(h)
      prev = last
      last = h
      await breathe()
    }
    await breathe()

    // Sidesteps are pure SHA-256 in O(h) memory, so one mid-size tree gives
    // the rate: +2^16 puts the LCA at h17, which is 2^17 leaf hashes plus
    // 2^17 - 1 internal nodes.
    const SIDESTEP_HASHES = 2 ** 18 - 1
    const t0 = performance.now()
    computeAxisMerkleRoot(AXIS_CENTER, AXIS_CENTER + (1n << 16n))
    const sidestepMs = Math.max(performance.now() - t0, 0.5)
    const sha256PerSec = SIDESTEP_HASHES / (sidestepMs / 1000)

    const response: CalibrateResponse = { type: 'result', id, cantorMsByHeight, sha256PerSec }
    self.postMessage(response)
  } catch (err) {
    const response: CalibrateResponse = {
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(response)
  }
}
