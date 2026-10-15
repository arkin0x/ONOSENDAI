/**
 * experience.ts — how HOSAKA's estimates have compared with its clock, here.
 *
 * The provider publishes a ladder of estimated seconds per height, and TIME
 * decides against those numbers. They are the cost model's means, measured on
 * the provider's machines on a good day; the jobs this identity actually ran
 * are the better witness. Every completed HOSAKA job leaves a sample: what
 * was estimated for its height, and how long it took from the moment it was
 * computing to the moment it was done, with the payment wait left out. The
 * ratio TIME uses is the median of actual over estimated across the last
 * samples, clamped so one bad day cannot swing it past reason, and 1 until
 * there are two samples to go on.
 */

import { create } from 'zustand'

export interface ExperienceSample {
  /** Seconds the ladder said, at submit. */
  estimated: number
  /** Seconds the job took, from computing to completed. */
  actual: number
  height: number
  action: string
  /** Date.now() at completion. */
  at: number
}

const KEY = 'onosendai:hosakaExperience'
/** Samples kept; the oldest go first. */
export const EXPERIENCE_MAX = 24
/** The ratio is never allowed outside this band, whatever the samples say. */
export const RATIO_MIN = 0.25
export const RATIO_MAX = 4
/** Fewer samples than this and the ratio stays at 1. */
export const RATIO_MIN_SAMPLES = 2

function load(): ExperienceSample[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as unknown
    return Array.isArray(list)
      ? (list as ExperienceSample[]).filter((s) => s && Number.isFinite(s.estimated) && s.estimated > 0 && Number.isFinite(s.actual) && s.actual >= 0)
      : []
  } catch {
    return []
  }
}

function save(samples: ExperienceSample[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(samples.slice(-EXPERIENCE_MAX))) } catch { /* private mode */ }
}

/** The median of actual over estimated, clamped; 1 with too few samples. */
export function ratioOf(samples: ExperienceSample[]): number {
  if (samples.length < RATIO_MIN_SAMPLES) return 1
  const ratios = samples.map((s) => s.actual / s.estimated).sort((a, b) => a - b)
  const mid = ratios.length >> 1
  const median = ratios.length % 2 === 1 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, median))
}

interface ExperienceState {
  samples: ExperienceSample[]
  record: (sample: Omit<ExperienceSample, 'at'>) => void
  clear: () => void
}

export const useExperience = create<ExperienceState>((set, get) => ({
  samples: load(),
  record: (sample) => {
    if (!Number.isFinite(sample.estimated) || sample.estimated <= 0 || !Number.isFinite(sample.actual) || sample.actual < 0) return
    const samples = [...get().samples, { ...sample, at: Date.now() }].slice(-EXPERIENCE_MAX)
    save(samples)
    set({ samples })
  },
  clear: () => { save([]); set({ samples: [] }) },
}))

/** The multiplier TIME applies to the provider's estimates: what this identity has seen. */
export function experienceRatio(): number {
  return ratioOf(useExperience.getState().samples)
}

/** Record a finished job. `computingAt` falls back to the submit time when the driver never marked it. */
export function recordJobExperience(record: { estSeconds?: number; computingAt?: number; createdAt: number; action: string }, height: number): void {
  if (typeof record.estSeconds !== 'number' || record.estSeconds <= 0) return
  const actual = (Date.now() - (record.computingAt ?? record.createdAt)) / 1000
  useExperience.getState().record({ estimated: record.estSeconds, actual, height, action: record.action })
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __experience: typeof useExperience }).__experience = useExperience
}
