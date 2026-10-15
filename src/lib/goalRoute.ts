/**
 * goalRoute.ts - the trip GOAL plans to a place you are looking at
 * (arkinox, 2026-10-14: "pressing it plans a route to that point, including
 * the nearest hyperjump port/landfall to exit from").
 *
 * A trip is one of two shapes, chosen by the protocol's own distance (DECK-0001
 * §4.1: the height of the smallest aligned cube holding both points, the same
 * max-axis LCA every hop is priced by):
 *
 * | Shape | When | Legs |
 * |---|---|---|
 * | direct | the goal is no farther from you than from the stop nearest it | hops and sidesteps from where you stand |
 * | ride | the stop nearest the goal is nearer to it than you are | board at your station, ride the line to that stop, then the last mile |
 *
 * The exit stop is the stop nearest the goal in the goal's plane: a landfall
 * for a place in dataspace, a port for one in ideaspace. Until the line has
 * synced, a nearer stop may simply not be loaded yet, so the plan says it is
 * still finding one rather than name a stop that may be wrong.
 *
 * Pure: the store (useGoal.ts) feeds it the index and the sync state.
 */

import { xyzToCoord, type Plane } from 'cyberspace-core'
import { findNearestInPlane, findStation, maxAxisLca, type StopIndex } from './hyperspace/station'
import { rideBlocks } from './hyperspace/ride'
import { stopCoordExact, type Stop } from './hyperspace/stops'
import type { Position } from './movePlan'

export interface GoalStop {
  height: number
  kind: 'port' | 'landfall'
  /** The stop's exact coordinate (coord256). */
  coord: bigint
  /** Max-axis LCA height from the stop to the point it was chosen for. */
  distance: number
}

export type GoalPlan =
  /** The line is still syncing: the stop nearest the goal is not known yet. */
  | { kind: 'loading'; directDistance: number }
  /** Walk: the goal is no farther from you than from any stop near it. */
  | { kind: 'direct'; directDistance: number; exit: GoalStop | null }
  /** Ride: board at `station`, ride `blocks` blocks to `exit`, then walk `exit.distance`. */
  | { kind: 'ride'; directDistance: number; station: GoalStop; exit: GoalStop; blocks: number }

export interface GoalInput {
  here: Position
  herePlane: Plane
  target: Position
  targetPlane: Plane
  index: StopIndex
  /** The synced tip, which bounds the station set (DECK-0001 §4.2 as amended); null before any sync. */
  tip: number | null
  /** The line has finished its sync, so a nearest stop found now is the real one. */
  ready: boolean
}

function stopOf(r: { stop: Stop; distance: number }): GoalStop {
  return { height: r.stop.height, kind: r.stop.kind, coord: stopCoordExact(r.stop), distance: r.distance }
}

/** The trip to `target` from `here`, as GOAL shows it. Nothing here signs or pays. */
export function planGoal(input: GoalInput): GoalPlan {
  const hereCoord = xyzToCoord(input.here.x, input.here.y, input.here.z, input.herePlane)
  const goalCoord = xyzToCoord(input.target.x, input.target.y, input.target.z, input.targetPlane)
  const directDistance = maxAxisLca(hereCoord, goalCoord)
  if (!input.ready || input.tip === null) return { kind: 'loading', directDistance }

  const exitFound = findNearestInPlane(input.index, goalCoord, input.targetPlane)
  if (exitFound === null) return { kind: 'direct', directDistance, exit: null }
  const exit = stopOf(exitFound)
  // The ride only helps when it leaves you nearer the goal than you are now.
  if (exit.distance >= directDistance) return { kind: 'direct', directDistance, exit }

  const stationFound = findStation(input.index, hereCoord, input.tip)
  // No station, or already at the stop the trip would ride to: walk instead.
  if (stationFound === null || stationFound.stop.height === exit.height) return { kind: 'direct', directDistance, exit }
  const station = stopOf(stationFound)
  return { kind: 'ride', directDistance, station, exit, blocks: rideBlocks(station.height, exit.height).length }
}

/** One line for the GOAL chip: what the trip is, in the words the HYPERSPACE panel uses. */
export function goalSummary(plan: GoalPlan): string {
  if (plan.kind === 'loading') return `Finding the stop nearest it (the line is still syncing). Direct: h${plan.directDistance} away.`
  if (plan.kind === 'direct') return `Walk there: h${plan.directDistance} away${plan.exit ? `, nearer than any stop (block ${plan.exit.height} is h${plan.exit.distance} from it)` : ''}.`
  return `Board at block ${plan.station.height}, ride ${plan.blocks.toLocaleString('en-US')} blocks to block ${plan.exit.height} (${plan.exit.kind}), then walk h${plan.exit.distance}.`
}
