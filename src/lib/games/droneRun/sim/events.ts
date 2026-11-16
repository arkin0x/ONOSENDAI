/**
 * events.ts - what a step tells the view: everything the screen, the sound
 * and the HUD react to, in the order it happened. A step's list is fresh
 * each step (RunState.events). Never read back by the simulation.
 */

import type { Vec3 } from '../types'

export type RunEvent =
  /** The player fired a pellet: where it began, its direction, and where it stopped (a solid, the last drone it hit, or its range). Projectile guns report `end` as the muzzle and fly as `projectile`. */
  | { type: 'shot'; weapon: number; origin: Vec3; dir: Vec3; end: Vec3; projectile?: number }
  /** A charge gun let go before its minimum charge. */
  | { type: 'charge-fizzled'; weapon: number }
  /** A shot or projectile of the player's hit a drone. */
  | { type: 'hit'; drone: number; damage: number; point: Vec3 }
  /** A player projectile stopped (a solid, its range, or its last pierce). */
  | { type: 'projectile-ended'; id: number; at: Vec3 }
  | { type: 'drone-spawned'; drone: number; enemy: string; at: Vec3 }
  | { type: 'drone-destroyed'; drone: number; enemy: string; at: Vec3 }
  /** A shooter drone began its telegraph; it fires after `windupS`. */
  | { type: 'drone-windup'; drone: number; windupS: number }
  /** A drone fired a projectile. */
  | { type: 'drone-shot'; drone: number; shot: number; origin: Vec3; vel: Vec3; radius: number }
  /** A drone's projectile stopped: at a solid, out of range, or on the player. */
  | { type: 'drone-shot-ended'; shot: number; at: Vec3; reason: 'solid' | 'range' | 'player' }
  /** A dive drone committed to a dive at `target`. */
  | { type: 'drone-dive'; drone: number; target: Vec3 }
  /** A drone saw the player (`seen`) or lost them for good (`lost`). */
  | { type: 'drone-alert'; drone: number; seen: boolean }
  /** The player lost `damage` HP (`hp` left). Hits inside the invulnerability window are not reported. */
  | { type: 'player-hit'; by: string; drone: number; damage: number; hp: number }
  | { type: 'wave-started'; wave: number }
  | { type: 'cleared'; wave: number; timeS: number; score: number }
  | { type: 'failed'; wave: number; timeS: number }
  | { type: 'weapon-switched'; from: number; to: number }
  | { type: 'overheated'; weapon: number }
  | { type: 'reload-started'; weapon: number }
  | { type: 'reloaded'; weapon: number }
  | { type: 'jumped'; double: boolean }
  | { type: 'landed' }
