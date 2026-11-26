/**
 * terrainInput.ts - what the controls ask of TERRAIN's body and cursor this
 * frame: the keys and pad buttons held, the look, and what the pointer
 * points at. Plain module state, read by the scene every frame
 * (TerrainScene.tsx), so a held key never re-renders anything.
 */

import { HOTBAR_SLOTS } from '../lib/terrain/terrainDb'

export interface TerrainInput {
  /** Held keys and pad buttons, by name: 'forward', 'back', 'left', 'right', 'jump', 'down'. */
  held: Map<string, number>
  /** Radians about the view's Y; 0 looks along -Z, into the screen as BUILD's view did. */
  yaw: number
  /** Radians up (positive) or down. */
  pitch: number
  /** Where the mouse rests over the scene, in normalized device coordinates, or null (touch: the cursor is the screen's centre). */
  hover: { x: number; y: number } | null
  /** A press waiting for the next frame: mine or place, at a point (NDC) or at the cursor. */
  action: { kind: 'mine' | 'place'; at: { x: number; y: number } | null } | null
  /**
   * The press now on the scene is TERRAIN's alone (the click that captures
   * the mouse again): nothing in the scene takes it, not even a shard in
   * plain view (scene/TapOccluder.tsx). Cleared at the next press.
   */
  swallowTap: boolean
}

export const terrainInput: TerrainInput = { held: new Map(), yaw: 0, pitch: -0.25, hover: null, action: null, swallowTap: false }

/** Pitch is kept short of straight up and down. */
export const PITCH_LIMIT = 1.45

export function resetTerrainInput(): void {
  terrainInput.held.clear()
  terrainInput.yaw = 0
  terrainInput.pitch = -0.25
  terrainInput.hover = null
  terrainInput.action = null
  terrainInput.swallowTap = false
}

/** Turn the look by radians. */
export function turnLook(dYaw: number, dPitch: number): void {
  terrainInput.yaw -= dYaw
  terrainInput.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, terrainInput.pitch - dPitch))
}

/** One source holds a direction (a key, or a pad button), counted so two holding one let go one at a time. */
export function hold(name: string): void {
  terrainInput.held.set(name, (terrainInput.held.get(name) ?? 0) + 1)
}

export function release(name: string): void {
  const n = (terrainInput.held.get(name) ?? 0) - 1
  if (n > 0) terrainInput.held.set(name, n)
  else terrainInput.held.delete(name)
}

export function releaseAll(): void {
  terrainInput.held.clear()
}

const has = (name: string): boolean => terrainInput.held.has(name)

/** This frame's walk, from what is held: forward and right, each -1, 0 or 1; jump; lift while floating. */
export function heldMove(): { forward: number; right: number; jump: boolean; lift: number } {
  return {
    forward: (has('forward') ? 1 : 0) - (has('back') ? 1 : 0),
    right: (has('right') ? 1 : 0) - (has('left') ? 1 : 0),
    jump: has('jump'),
    lift: (has('jump') ? 1 : 0) - (has('down') ? 1 : 0),
  }
}

/** The keys TERRAIN answers, by code, and what each holds. */
export const MOVE_KEYS: Record<string, string> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', ShiftLeft: 'down', ShiftRight: 'down', KeyC: 'down',
}

/** The hotbar slot a key chooses (Digit1 to Digit9), or null. */
export function slotKey(code: string): number | null {
  const m = /^Digit([1-9])$/.exec(code)
  if (!m) return null
  const n = Number(m[1]) - 1
  return n < HOTBAR_SLOTS ? n : null
}
