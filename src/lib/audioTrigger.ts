/**
 * audioTrigger.ts: when a one-shot plays by itself (DECK-0007 §5.2,
 * arkinox's ruling of 2026-10-23).
 *
 * Hidden audio without `loop` is a ONE-SHOT. With `autoplay`, its fade sphere
 * is its trigger zone: it starts when the listener enters the sphere. Its
 * `retrigger` says what happens on the next entry: `once`, the default, plays
 * it the first time only; `auto` plays it again every time the listener
 * leaves and comes back in. Without `autoplay` there is no trigger: it plays
 * only from its card. `walk` gates the trigger too: outside WALK mode the
 * listener is not in the zone at all, so stepping into WALK while inside the
 * sphere is an entry.
 *
 * Whether a once-trigger has fired is this device's own record, never
 * published: it is the listener's memory of hearing it, kept in localStorage
 * by the item's lineage id. RESET TRIGGER on the card forgets it, so leaving
 * and entering again plays it once more.
 *
 * The step itself is pure (stepTrigger), so the rules are tested here and
 * the scene only feeds it whether the listener is inside, frame by frame.
 */

import type { AudioItem } from './audioItem'

/** One source's trigger, between frames: whether the listener was in the zone last time. */
export interface TriggerState {
  inside: boolean
}

export const TRIGGER_START: TriggerState = { inside: false }

export interface TriggerInput {
  /** The listener is within the sphere (fadeRadius) of the source, and inside the region. */
  inSphere: boolean
  /** The viewer is in WALK mode: the only time a `walk` item is heard. */
  walking: boolean
  /** This device's record says the once-trigger already fired. */
  fired: boolean
}

export interface TriggerStep {
  state: TriggerState
  /** Start the one-shot now. */
  fire: boolean
}

/** Whether an item has a trigger at all: a one-shot that plays by itself. */
export function hasTrigger(a: Pick<AudioItem, 'autoplay' | 'loop'>): boolean {
  return a.autoplay && !a.loop
}

/**
 * One frame of a one-shot's trigger. It fires on an ENTRY, the frame the
 * listener is in the zone after a frame it was not (the first frame counts
 * as one, so finding the bag while standing in the sphere plays it), and
 * only when `retrigger` is `auto` or the once-trigger has not fired here.
 */
export function stepTrigger(a: Pick<AudioItem, 'autoplay' | 'loop' | 'retrigger' | 'walkOnly'>, state: TriggerState, input: TriggerInput): TriggerStep {
  const inside = hasTrigger(a) && input.inSphere && (!a.walkOnly || input.walking)
  const entered = inside && !state.inside
  const fire = entered && (a.retrigger === 'auto' || !input.fired)
  return { state: { inside }, fire }
}

// ---------------------------------------------------------------------------
// The fired record: local per device, never published.

const FIRED_KEY = 'onosendai:audio-fired'
/** The most records kept; the oldest go first. */
const FIRED_CAP = 2000

let fired: string[] | null = null
const listeners = new Set<() => void>()
let version = 0

function load(): string[] {
  if (fired) return fired
  try {
    const raw = JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]') as unknown
    fired = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  } catch {
    fired = []
  }
  return fired
}

function save(next: string[]): void {
  fired = next.slice(-FIRED_CAP)
  version++
  try { localStorage.setItem(FIRED_KEY, JSON.stringify(fired)) } catch { /* kept for this visit only */ }
  for (const l of listeners) l()
}

/** Whether this device has heard this once-trigger fire. `id` is the item's lineage id. */
export function triggerFired(id: string): boolean {
  return load().includes(id)
}

/** Note that the once-trigger fired here. */
export function markFired(id: string): void {
  const list = load()
  if (!list.includes(id)) save([...list, id])
}

/** RESET TRIGGER: forget that it fired, so the next entry plays it again. */
export function resetTrigger(id: string): void {
  const list = load()
  if (list.includes(id)) save(list.filter((v) => v !== id))
}

/** For useSyncExternalStore: subscribe, and a number that rises on every change. */
export function onTriggers(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function triggersVersion(): number {
  return version
}

/** Forget the in-memory copy (tests). */
export function forgetTriggers(): void {
  fired = null
  version++
}
