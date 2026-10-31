/**
 * hopProgress.ts - the progress bar of a version 2 hop, in time rather than
 * in core's units of work.
 *
 * computeHopProofV2 reports one fraction across its stages: the three axis
 * trees and the temporal tree, the two region pairings, then the residue
 * extension (primes, residues, seal, re-roll, openings). Its weights are
 * work units chosen inside core, and they put the extension at about a fifth
 * of the trees. Measured in a browser it is more than half of the hop: at
 * h20 on one axis, 11.5 s of 20.3 s with the WASM word kernel (Phase 0
 * browser bench, section 3.4, Chromium). A bar driven by core's fraction
 * would race to 85% and then sit there for ten seconds.
 *
 * So the worker remaps core's fraction, stage by stage, onto the time each
 * stage takes, and adds the region key derived after core returns. Each
 * stage scales as 2^h at the height that drives it (a tree at its own
 * height, the region pairings and the key at the tallest axis, the
 * extension at h_max, which includes K), normalized to the bench's h20
 * seconds. Only the bar's pace changes; nothing here touches the proof.
 *
 * The stage boundaries in core's fraction are core's own (computeHopProofV2
 * and proveHopResidues at the pinned commit); a test holds them against a
 * real run.
 */

/** The heights a hop's stages run at: the three axis trees, and K for the temporal tree. */
export interface HopHeights {
  x: number
  y: number
  z: number
  K: number
}

/** Seconds at h20, Chromium, WASM word kernel (PHASE0-BROWSER-BENCH.md section 3.4). */
const H20 = {
  axisTree: 4.62,
  regionCombine: 3.5,
  regionKey: 0.67,
  primes: 1.35,
  /** Product tree, remainder trees and the combine modulo each prime. */
  residues: 0.99 + 8.39 + 0.08,
  seal: 0.08,
  reroll: 0.61,
  openings: 0.004,
}

/** Core's own split of the extension, proveHopResidues' phase weights. */
const CORE_EXTENSION = [3, 4, 1, 2, 0.2]

/** Seconds as a multiple of the h20 figure: 2^(h - 20). */
const at = (seconds: number, h: number): number => seconds * 2 ** (h - 20)

export interface HopProgressPlan {
  /** Core's fraction at the end of each stage, ascending, the last 1. */
  core: number[]
  /** The bar's fraction at the end of each stage; the last is where the region key begins. */
  time: number[]
  /** The bar for a fraction core reported. */
  remap: (coreFraction: number) => number
}

export function hopProgressPlan(h: HopHeights): HopProgressPlan {
  // Core's stages (computeHopProofV2): a tree weighs its levels, h + 1; the
  // region pairings 4 and 8; the extension a quarter of the trees, at least 2.
  const trees = [h.x + 1, h.y + 1, h.z + 1, h.K + 1]
  const treeWork = trees.reduce((a, b) => a + b, 0)
  const extension = Math.max(2, treeWork / 4)
  const coreExt = CORE_EXTENSION.reduce((a, b) => a + b, 0)
  const coreWork = [...trees, 4, 8, ...CORE_EXTENSION.map((w) => (extension * w) / coreExt)]

  // The same stages in seconds, and the region key after them.
  const axisMax = Math.max(h.x, h.y, h.z)
  const hMax = Math.max(axisMax, h.K)
  const floor = 1e-6
  const seconds = [
    at(H20.axisTree, h.x),
    at(H20.axisTree, h.y),
    at(H20.axisTree, h.z),
    at(H20.axisTree, h.K),
    at(H20.regionCombine, axisMax) / 3,
    (at(H20.regionCombine, axisMax) * 2) / 3,
    at(H20.primes, hMax),
    at(H20.residues, hMax),
    at(H20.seal, hMax),
    at(H20.reroll, hMax),
    at(H20.openings, hMax),
  ].map((s) => Math.max(floor, s))
  const keySeconds = Math.max(floor, at(H20.regionKey, axisMax))

  const cumulative = (xs: number[], total: number): number[] => {
    let run = 0
    return xs.map((x) => (run += x) / total)
  }
  const core = cumulative(coreWork, coreWork.reduce((a, b) => a + b, 0))
  core[core.length - 1] = 1
  const time = cumulative(seconds, seconds.reduce((a, b) => a + b, 0) + keySeconds)

  const remap = (f: number): number => {
    const c = Math.min(1, Math.max(0, f))
    let i = 0
    while (i < core.length - 1 && c > core[i]) i++
    const c0 = i === 0 ? 0 : core[i - 1]
    const t0 = i === 0 ? 0 : time[i - 1]
    const span = core[i] - c0
    return span > 0 ? t0 + ((c - c0) / span) * (time[i] - t0) : time[i]
  }
  return { core, time, remap }
}
