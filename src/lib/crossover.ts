/**
 * crossover.ts - the wall height where buying the hop beats walking it.
 *
 * LOOT is structural on purpose: any boundary above this machine's hop
 * ceiling goes to HOSAKA, because the key is the point. TIME asks a different
 * question, and measured, the structural answer is wrong for it at the
 * bottom of the range. A single sidestep is one hash chain and this machine
 * beats HOSAKA at every height it can reach at all: a 2^20 crossing is four
 * seconds here against about two and a half minutes there.
 *
 * What the cloud actually replaces is not one sidestep but the walk. Crossing
 * a wall at height h with a hop ceiling of c takes about 2^(h-c) steps, each
 * one a signed, published event, and that is what grows out of hand: 4 steps
 * at 2^18, 128 at 2^23, 256 at 2^24. So the honest question is not "is there a
 * wall" but "does the walk cost more than the hop", and the answer moves with
 * the machine, with the signer, and with what the provider charges in time.
 *
 * This module answers it in seconds, from what is already known: the walk from
 * the planner and the calibration, the hop from the provider's own published
 * ladder. The planner is left pure and quick: it takes the resulting height as
 * one number.
 */

import { buildMovePlan, localOnly, type RouteProfile } from './movePlan'
import { projectCantorMs } from './calibration'
import type { SignerKind } from './signers'

/**
 * What one event costs beyond its computation: the signature and the publish.
 *
 * A local key signs in a millisecond. An extension asks the browser. A bunker
 * is a round trip to another device over a relay, which is the case that turns
 * a 256-step walk into an afternoon.
 */
export const EVENT_SECONDS: Record<SignerKind, number> = {
  local: 0.5,
  nip07: 1.2,
  nip46: 4,
}

/** Quote, submit and the queue before HOSAKA's own clock starts, when the balance covers it. */
export const PAYMENT_SECONDS = 30

/** Longer walks than this are not costed step by step; they have already lost. */
const WALK_STEPS_MAX = 4096

export interface CrossoverInputs {
  /** This machine's ceilings, from the calibration. */
  hopCeiling: number
  sidestepCeiling: number
  /** The provider's hop cap; 0 when the cloud is off or unknown. */
  cloudHop: number
  cantorMsByHeight: Record<number, number> | null
  sha256PerSec: number | null
  /** The provider's published hop ladder. */
  ladder: Array<{ max_height: number; est_seconds?: number; est_time?: string }> | null
  signerKind: SignerKind
  /** Actual over estimated across this identity's finished jobs (lib/experience); 1 when unknown. */
  experience?: number
}

/** "about 5 min", "under 10 sec", "about 1.5 hr" as seconds; null when it is none of those. */
export function parseEstTime(text: string | undefined): number | null {
  if (!text) return null
  const m = /(\d+(?:\.\d+)?)\s*(sec|min|hr|hour)/i.exec(text)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const unit = m[2].toLowerCase()
  return unit === 'sec' ? n : unit === 'min' ? n * 60 : n * 3600
}

/** Seconds HOSAKA says a hop at this height takes, from its own ladder. */
export function cloudSeconds(height: number, ladder: CrossoverInputs['ladder']): number | null {
  if (!ladder || ladder.length === 0) return null
  const band = [...ladder].sort((a, b) => a.max_height - b.max_height).find((b) => height <= b.max_height)
  if (!band) return null
  if (typeof band.est_seconds === 'number' && band.est_seconds > 0) return band.est_seconds
  return parseEstTime(band.est_time)
}

/** Seconds one step of a walk costs this machine: its computation and its event. */
export function stepSeconds(
  kind: 'hop' | 'sidestep',
  height: number,
  inputs: CrossoverInputs,
): number {
  const event = EVENT_SECONDS[inputs.signerKind] ?? EVENT_SECONDS.local
  if (kind === 'sidestep') {
    const rate = inputs.sha256PerSec && inputs.sha256PerSec > 0 ? inputs.sha256PerSec : 500_000
    return (2 ** (height + 1)) / rate + event
  }
  const ms = inputs.cantorMsByHeight ? projectCantorMs(inputs.cantorMsByHeight, height) : NaN
  // Three axes may move in one hop, and the worker runs them one after another.
  return (Number.isFinite(ms) ? (ms * 3) / 1000 : 0.2) + event
}

/**
 * Seconds this machine needs to cross a wall at `height`, the whole walk: the
 * hops to the leaf touching it, the sidestep across, and the hops on the far
 * side, each with its signature.
 */
export function walkSeconds(height: number, inputs: CrossoverInputs): number {
  if (height > inputs.sidestepCeiling) return Infinity
  // A crossing whose LCA height is exactly `height`: from the origin to the
  // block boundary below it, which is the canonical wall of that height with a
  // full block to walk on the far side. (0 to 2^k has LCA k+1, not k.)
  const from = { x: 0n, y: 0n, z: 0n }
  const to = { x: 1n << BigInt(height - 1), y: 0n, z: 0n }
  let steps
  try {
    steps = buildMovePlan(from, to, localOnly(inputs.hopCeiling, inputs.sidestepCeiling), WALK_STEPS_MAX)
  } catch {
    return Infinity
  }
  let total = 0
  for (const s of steps) total += stepSeconds(s.kind, s.maxHeight, inputs)
  return total
}

/**
 * The lowest wall height at which the paid hop is the faster way across.
 *
 * Below it the walk is quicker and free, so nothing is bought. Infinity when
 * the walk always wins, or when the provider says nothing about its own times.
 */
export function crossoverHeight(inputs: CrossoverInputs): number {
  if (inputs.cloudHop <= inputs.hopCeiling) return Infinity
  for (let h = inputs.hopCeiling + 1; h <= inputs.cloudHop; h++) {
    const cloud = cloudSeconds(h, inputs.ladder)
    if (cloud === null) return Infinity
    // The provider's estimate, corrected by what its jobs have actually taken here.
    if (walkSeconds(h, inputs) > cloud * (inputs.experience ?? 1) + PAYMENT_SECONDS) return h
  }
  return Infinity
}

let cached: { key: string; value: number } | null = null

/** The same, memoised: the inputs change rarely and the answer is asked per cursor move. */
export function crossoverFor(profile: RouteProfile, inputs: CrossoverInputs): number {
  // COST never buys a hop; LOOT buys every wall above this machine's hop
  // ceiling; TIME is the measured question below.
  if (profile === 'cost') return Infinity
  if (profile === 'loot') return inputs.hopCeiling + 1
  const key = [
    inputs.hopCeiling, inputs.sidestepCeiling, inputs.cloudHop, inputs.signerKind,
    Math.round(inputs.sha256PerSec ?? 0),
    inputs.ladder ? inputs.ladder.map((b) => `${b.max_height}:${b.est_seconds ?? b.est_time ?? ''}`).join(',') : '',
    inputs.cantorMsByHeight ? Object.keys(inputs.cantorMsByHeight).length : 0,
    (inputs.experience ?? 1).toFixed(3),
  ].join('|')
  if (cached && cached.key === key) return cached.value
  const value = crossoverHeight(inputs)
  cached = { key, value }
  return value
}

/**
 * The height for the profile and the state of the world, ready for a Ceilings.
 * The one place the three planners (preview, button, commit) ask, so they
 * cannot disagree about where HOSAKA takes over.
 */
export function offloadFrom(
  profile: RouteProfile,
  opts: {
    hopCeiling: number
    sidestepCeiling: number
    cloudHop: number
    provider: { pricing?: { hop?: Array<{ max_height: number; est_seconds?: number; est_time?: string }> } } | null
    signerKind: SignerKind
    cantorMsByHeight?: Record<number, number> | null
    sha256PerSec?: number | null
    experience?: number
  },
): number {
  return crossoverFor(profile, {
    hopCeiling: opts.hopCeiling,
    sidestepCeiling: opts.sidestepCeiling,
    cloudHop: opts.cloudHop,
    cantorMsByHeight: opts.cantorMsByHeight ?? null,
    sha256PerSec: opts.sha256PerSec ?? null,
    ladder: opts.provider?.pricing?.hop ?? null,
    signerKind: opts.signerKind,
    experience: opts.experience,
  })
}
