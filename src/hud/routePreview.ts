/**
 * routePreview.ts - the route the cursor lines up, as data the HUD can show
 * live: the Movement proof panel and the route overlay above the controls
 * read the same preview, so the two never disagree.
 *
 * The steps are built once per cursor position (buildMovePlan, capped) and
 * the summary is read off them, so a cursor held on a key costs one walk of
 * at most PREVIEW_STEPS_MAX steps per move; a walk longer than that is
 * summarised with a "+" and its list shows the first and last few.
 */

import { useMemo } from 'react'
import { estimateHopCost } from 'cyberspace-core'
import { useCalibration } from '../lib/calibration'
import { buildMovePlan, planSummary, type Ceilings, type PlanStep, type PlanSummary } from '../lib/movePlan'
import { MAX_COMPUTE_HEIGHT, samePosition, useCyberspace } from '../store/useCyberspace'

/** The preview lists this many steps at most; beyond it, the first and last few with a gap. */
export const PREVIEW_STEPS_MAX = 2_000
const PREVIEW_HEAD = 6
const PREVIEW_TAIL = 3

export interface RoutePreview {
  hop: ReturnType<typeof estimateHopCost>
  /** Null when one hop reaches the cursor: nothing to list. */
  route: PlanSummary | null
  steps: PlanStep[] | null
  /** Some step of the way is HOSAKA's. */
  needsCloud: boolean
}

function summaryOf(steps: PlanStep[]): PlanSummary {
  let hops = 0, sidesteps = 0, tallestWall = 0, cloudSteps = 0
  let infeasibleAt: number | null = null
  steps.forEach((s, i) => {
    if (s.kind === 'hop') hops++
    else { sidesteps++; if (s.maxHeight > tallestWall) tallestWall = s.maxHeight }
    if (s.source === 'cloud') cloudSteps++
    if (s.source === 'infeasible' && infeasibleAt === null) infeasibleAt = i
  })
  return { steps: steps.length, hops, sidesteps, tallestWall, capped: false, cloudSteps, infeasibleAt }
}

/** The route from the avatar to the cursor, with this machine's ceilings and HOSAKA's caps as they stand. */
export function useRoutePreview(): RoutePreview | null {
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const plane = useCyberspace((s) => s.plane)
  const limits = useCyberspace((s) => s.cloud.limits)
  const hopCeil = useCalibration((s) => s.hopHeight)
  const sidestepCeil = useCalibration((s) => s.sidestepHeight)
  const ceiling = Math.min(MAX_COMPUTE_HEIGHT, hopCeil)
  const cloudHop = limits?.max_hop_height ?? 0
  const cloudSidestep = limits?.max_sidestep_height ?? 0
  return useMemo(() => {
    if (samePosition(position, cursor)) return null
    const hop = estimateHopCost(position.x, position.y, position.z, cursor.x, cursor.y, cursor.z, plane, ceiling)
    if (!hop.exceedsLimit) return { hop, route: null, steps: null, needsCloud: false }
    // HOSAKA's caps whatever the cloud mode: what a move needs does not
    // depend on a setting, and the button (useOffer) reads it the same way.
    const ceilings: Ceilings = { hop: ceiling, sidestep: sidestepCeil, cloudHop, cloudSidestep }
    let steps: PlanStep[] | null = null
    try { steps = buildMovePlan(position, cursor, ceilings, PREVIEW_STEPS_MAX) } catch { steps = null }
    const route = steps ? summaryOf(steps) : planSummary(position, cursor, ceilings, PREVIEW_STEPS_MAX)
    return { hop, route, steps, needsCloud: route.cloudSteps > 0 }
  }, [position, cursor, plane, ceiling, sidestepCeil, cloudHop, cloudSidestep])
}

export interface PreviewRow { index: number; kind: string; height: string; state: string; label: string }

export function previewRow(step: PlanStep, index: number): PreviewRow {
  return {
    index,
    kind: `${step.source === 'cloud' ? 'CLOUD ' : ''}${step.kind === 'sidestep' ? 'SIDESTEP' : 'HOP'}`,
    height: `2^${step.maxHeight}`,
    state: step.source === 'cloud' ? 'funding' : step.source === 'infeasible' ? 'failed' : 'next',
    label: step.source === 'cloud' ? 'HOSAKA' : step.source === 'infeasible' ? 'beyond reach' : 'this machine',
  }
}

/**
 * Every step when the route is short. When it is not, the first and last few
 * with the count of the rest between them (a number is a gap), and the step
 * nobody can do always shown, however deep in the walk it sits: the notice
 * names it, so the list must too.
 */
export function previewWindow(steps: PlanStep[], head: number = PREVIEW_HEAD, tail: number = PREVIEW_TAIL): Array<PreviewRow | number> {
  if (steps.length <= head + tail + 1) return steps.map(previewRow)
  const keep = new Set<number>()
  for (let i = 0; i < head; i++) keep.add(i)
  for (let i = steps.length - tail; i < steps.length; i++) keep.add(i)
  const blocked = steps.findIndex((s) => s.source === 'infeasible')
  if (blocked >= 0) keep.add(blocked)
  const out: Array<PreviewRow | number> = []
  let skipped = 0
  steps.forEach((s, i) => {
    if (keep.has(i)) {
      if (skipped) { out.push(skipped); skipped = 0 }
      out.push(previewRow(s, i))
    } else skipped++
  })
  return out
}

export function routeLabel(r: PlanSummary): string {
  const more = r.capped ? '+' : ''
  const hops = `${r.hops}${more} hop${r.hops === 1 ? '' : 's'}`
  const sides = `${r.sidesteps}${more} sidestep${r.sidesteps === 1 ? '' : 's'}`
  return `${hops}, ${sides}`
}
