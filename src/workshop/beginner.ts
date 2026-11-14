/**
 * beginner.ts - the workshop's beginner path (workshop redesign, phase 4,
 * decision 4): how many tools the dock shows, the first-visit guide's step,
 * and how often each tool has been used, which is what fades its hint.
 *
 * New users start with four tools (LOOK, STAMP, SELECT, PAINT) and MORE TOOLS,
 * which adds ADD and FACE; anyone who has made something before starts with
 * all six. The choice, the guide being done and the use counts live on this
 * device (localStorage); a private window starts fresh and that is fine.
 */

import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { Quaternion } from 'three'
import type { ShardModel } from 'sno-core/shards'
import { useWorkshop, type Tool } from '../store/useWorkshop'
import { benchPose, benchPoseFrames } from './benchAxes'

const TOOLS_KEY = 'onosendai:workshop-tools'
const HINTS_KEY = 'onosendai:workshop-hints'
/** The first-run card's flag, kept: whoever dismissed the old card has had their first visit. */
export const GUIDE_KEY = 'onosendai:workshop-intro'

/**
 * The ids the tutorial gives the shards it copies into the workshop
 * (tutorial/director.ts TUTORIAL_SHARD_ID, kept in step by a test): found,
 * not made, so they say nothing about whether someone has built before.
 */
export const TUTORIAL_SHARD_PREFIX = 'tutorial-'

/** How many uses of a tool before its hint stops showing. */
export const HINT_USES = 3

export type DockTools = 'four' | 'all'

/** The guide's three steps, in order. */
export const GUIDE_STEPS = ['stamp', 'turn', 'paint'] as const
export type GuideStep = typeof GUIDE_STEPS[number]

const read = (key: string): string | null => { try { return localStorage.getItem(key) } catch { return null } }
const write = (key: string, value: string): void => { try { localStorage.setItem(key, value) } catch { /* private mode */ } }

function readUses(): Partial<Record<Tool, number>> {
  try { const v = JSON.parse(read(HINTS_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}

interface Beginner {
  /** The dock's tools, or null until the workshop first opens and decides. */
  tools: DockTools | null
  setTools: (t: DockTools) => void
  /** The guide's step while it runs, else null. */
  step: GuideStep | null
  setStep: (s: GuideStep | null) => void
  /** The guide done or skipped: it never comes back, this session even where storage refuses the flag. */
  done: boolean
  finish: () => void
  /** What glows: the real button the guide points at. */
  glow: Tool | 'deploy' | null
  setGlow: (g: Tool | 'deploy' | null) => void
  uses: Partial<Record<Tool, number>>
  /** One more use of a tool, toward its hint fading. */
  bump: (tool: Tool) => void
}

export const useBeginner = create<Beginner>((set, get) => ({
  tools: ((): DockTools | null => { const v = read(TOOLS_KEY); return v === 'four' || v === 'all' ? v : null })(),
  setTools: (tools) => { write(TOOLS_KEY, tools); set({ tools }) },
  step: null,
  setStep: (step) => set({ step }),
  done: read(GUIDE_KEY) !== null,
  finish: () => { write(GUIDE_KEY, '1'); set({ step: null, done: true }) },
  glow: null,
  setGlow: (glow) => set({ glow }),
  uses: readUses(),
  bump: (tool) => {
    const n = get().uses[tool] ?? 0
    if (n >= HINT_USES) return
    const uses = { ...get().uses, [tool]: n + 1 }
    write(HINTS_KEY, JSON.stringify(uses))
    set({ uses })
  },
}))

/** Whether this device's first visit to the workshop is done (or the old card was dismissed). */
export const guideDone = (): boolean => useBeginner.getState().done || read(GUIDE_KEY) !== null

/**
 * The dock a newcomer gets: four tools for someone who has never been here and
 * made nothing, all six for anyone else (decision 4). Pure.
 */
export function startingTools(visited: boolean, shards: readonly Pick<ShardModel, 'id' | 'vertices' | 'parts'>[]): DockTools {
  return visited || shards.some((s) => !s.id.startsWith(TUTORIAL_SHARD_PREFIX) && (s.vertices.length > 0 || (s.parts?.length ?? 0) > 0)) ? 'all' : 'four'
}

/** The dock's tools now: the choice made, or, before it is made, what it would be. */
export function dockTools(tools: DockTools | null, shards: readonly Pick<ShardModel, 'id' | 'vertices' | 'parts'>[]): DockTools {
  return tools ?? startingTools(guideDone(), shards)
}

/** The dock's tools, live: before the first opening decides (one frame), what it will decide, so six never flash. */
export function useDockTools(): DockTools {
  const tools = useBeginner((b) => b.tools)
  return useWorkshop((s) => dockTools(tools, s.shards))
}

/** The tools on the dock for a choice, in the dock's order: ADD and FACE only with all six. */
export const shownTools = (tools: DockTools | null): ReadonlySet<Tool> => new Set<Tool>(tools === 'four' ? ['view', 'stamp', 'select', 'paint'] : ['view', 'stamp', 'select', 'paint', 'add', 'face'])

/**
 * Calls `onTurn` once the bench view has turned past `rad` radians from where
 * it was when `active` became true (the guide's TURN THE VIEW, LOOK's hint).
 * Read from the bench pose every quarter second: no store, no frames asked.
 * It measures from the first pose the bench draws after it is armed, never
 * from one left over from before (a workshop opened again starts at HOME).
 * A new `epoch` arms it again from where the view is then.
 */
export function useViewTurned(active: boolean, onTurn: () => void, rad = 0.45, epoch = 0): void {
  const cb = useRef(onTurn)
  cb.current = onTurn
  useEffect(() => {
    if (!active) return
    const armed = benchPoseFrames()
    let from: Quaternion | null = null
    const t = window.setInterval(() => {
      if (from === null) { if (benchPoseFrames() > armed) from = new Quaternion().copy(benchPose); return }
      if (from.angleTo(benchPose) > rad) { window.clearInterval(t); cb.current() }
    }, 250)
    return () => window.clearInterval(t)
  }, [active, rad, epoch])
}
