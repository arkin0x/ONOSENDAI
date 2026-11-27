/**
 * hiddenLook.ts: one rulebook for every hidden thing in the world, the
 * message's letter, an item's token, a sound and (once it lands) a
 * blueprint's marker (owner ruling, 2026-11-27: option A "One Rulebook" of
 * the hidden-item cohesion page, "these 4 types of hidden things look awesome
 * but they all look like they were designed by different people").
 *
 * Every colour, outline width, glow rule, speed, bob, ring size and label
 * rule the four share lives here and nowhere else, so they cannot drift
 * apart again. The scene's parts (scene/hiddenParts.ts) build the shared
 * materials from these numbers; each kind of hidden thing keeps only its own
 * shape.
 *
 * Sizes are in gibsons, for a thing one gibson across (a letter's width).
 *
 * Pure: nothing here reads a store, the clock or three.
 */

import { ACCENT, FG } from './palette'

// ---------- Colour (ONOSENDAI's own tokens) ----------

/** Every solid face: the letter's paper, a dark blue-black, shaded by light and out of the bloom. */
export const HIDDEN_FACE = '#0b1824'
/** The outline of a thing not yet opened: the HUD's foreground. */
export const OUTLINE_UNREAD = FG
/** The outline of a thing opened (read, seen or heard): the HUD's dim steel. */
export const OUTLINE_READ = '#5b7d8f'
/** The outline under a pointer: white. */
export const OUTLINE_HOVER = '#ffffff'
/** Every ring and its marks (glyphs, level lines, the thin line ring, the pulse): the HUD's cyan. */
export const RING_COLOUR = ACCENT
/** A ring's opacity in each state. */
export const RING_OPACITY = { unread: 0.9, new: 0.9, read: 0.42, playing: 1 } as const
/** The near-black initial pressed into a seal. */
export const SEAL_INK = '#140d03'

// ---------- Outline rule ----------

/**
 * Every hard edge of every solid is outlined, the same width on screen at any
 * distance, CSS pixels. Seals are inlays and take no outline. A blueprint's
 * blocks take it too, in each block's own edge colour.
 */
export const OUTLINE_PX = 1.5
/** The outline under a pointer, 1.6 times wider. */
export const OUTLINE_HOVER_PX = 2.4
/** A thin ring's line (an item's ring), CSS pixels. */
export const RING_LINE_PX = 1.5

// ---------- Glow ----------

/**
 * Lines and rings glow; faces never do. In the world the glow is the world's
 * one bloom (scene/worldBloom), shared by every line in it, so every hidden
 * thing glows the same: its lines and rings are drawn into the bloom and its
 * faces, seals and initials are kept out of it (shardFaces TAG_BLEND).
 */
export const GLOW = { lines: true, faces: false } as const

// ---------- Motion ----------

/** One turn of a thing about the scene's up axis, seconds. A blueprint never turns. */
export const TURN_S = 24
/** One turn of a ring, seconds; a ring always faces the camera. */
export const RING_TURN_S = 18
/** The bob each way, gibsons, and its period, seconds: the same for all four. */
export const BOB = 0.035
export const BOB_S = 5
/** The idle wave: two crests going round every ring once every WAVE_S seconds. */
export const WAVE_S = 6
/** A NEW thing sends a pulse out of its ring every PULSE_S seconds until it is opened. */
export const PULSE_S = 2.4
/** How long of each PULSE_S the pulse takes to go out and fade. */
const PULSE_RUN_S = 1.6

// ---------- Rings ----------

/** Where every ring sits, from the thing's middle, and how far out its marks reach. */
export const RING_RADIUS = 0.74
export const RING_REACH = 0.98
/** The thin line ring (an item's), just outside the ring radius. */
export const LINE_RING_RADIUS = RING_RADIUS + 0.04
/** A sound's level lines: how many, how wide. */
export const LEVEL_LINES = 32
export const LEVEL_LINE_W = 0.045

// ---------- Labels ----------

/** Name over maker, Monaspace Krypton (lib/font WORLD_FONT), white with the label's dark edge, this tall in CSS pixels. */
export const LABEL_PX = 11
/** Its lowest line stands this many CSS pixels over the ring (lib/markerSize LABEL_GAP_PX is the same 4). */
export const LABEL_GAP = 4
export const LABEL_COLOUR = '#ffffff'

/**
 * The shape every hidden thing's name stands clear of (WorldLabel `clear`
 * shape), for a thing one gibson across: the ring's reach, a disc turned to
 * the camera, so all four names stand at the same height over their rings,
 * and the body's own upright ellipsoid inside it.
 */
export function labelShape(radius: number, height: number, side = 1): { flat: number; radius: number; height: number } {
  return { flat: RING_REACH * side, radius: radius * side, height: height * side }
}

// ---------- State ----------

/** Every hidden thing is in one of three states: NEW (found, not yet opened), UNREAD, or READ (opened, seen or heard). */
export type HiddenState = 'new' | 'unread' | 'read'

/**
 * A hidden thing's state: your own are read (you made them); one opened is
 * read; one found and not yet opened is new; anything else is unread.
 */
export function hiddenState({ mine, read, fresh }: { mine: boolean; read: boolean; fresh: boolean }): HiddenState {
  if (mine || read) return 'read'
  return fresh ? 'new' : 'unread'
}

/** What a state looks like: its outline's colour and width, its ring's opacity, and whether it pulses. */
export interface HiddenLook {
  outline: string
  outlinePx: number
  ringOpacity: number
  pulse: boolean
}

/**
 * The look of a thing in `state`: playing (a sound) lifts its ring to full;
 * a pointer over it turns its outline white and wider and its ring full.
 */
export function hiddenLook(state: HiddenState, { playing = false, hover = false }: { playing?: boolean; hover?: boolean } = {}): HiddenLook {
  return {
    outline: hover ? OUTLINE_HOVER : state === 'read' ? OUTLINE_READ : OUTLINE_UNREAD,
    outlinePx: hover ? OUTLINE_HOVER_PX : OUTLINE_PX,
    ringOpacity: hover || playing ? RING_OPACITY.playing : RING_OPACITY[state],
    pulse: state === 'new',
  }
}

// ---------- Motion, as functions of time ----------

const TAU = Math.PI * 2

/** The bob at `t` seconds for a thing whose phase is `phase` radians, gibsons; none with reduced motion. */
export function bobAt(t: number, phase: number, reduced: boolean): number {
  return reduced ? 0 : Math.sin((t / BOB_S) * TAU + phase) * BOB
}

/** A thing's turn about the up axis at `t`, radians; square on to the view's front with reduced motion. */
export function turnAt(t: number, phase: number, reduced: boolean): number {
  return reduced ? 0 : phase + (t / TURN_S) * TAU
}

/** A ring's own turn at `t`, radians; still with reduced motion. */
export function ringTurnAt(t: number, reduced: boolean): number {
  return reduced ? 0 : ((t % RING_TURN_S) / RING_TURN_S) * TAU
}

/** The wave's phase at `t`, radians; still with reduced motion. */
export function wavePhaseAt(t: number, reduced: boolean): number {
  return reduced ? 0 : ((t % WAVE_S) / WAVE_S) * TAU
}

/** The idle wave at angle `a` round a ring (its turn included), 0 to 1: two crests going round. */
export function waveAt(a: number, wavePhase: number): number {
  return 0.5 + 0.5 * Math.sin(2 * a - wavePhase)
}

/**
 * A NEW thing's pulse at `t`: its radius as a share of the ring's reach and
 * its opacity. It leaves the ring every PULSE_S, grows out to the ring's reach
 * and fades there, never past it, so it never crosses the name standing
 * LABEL_GAP over the reach (labelShape; review of #945: the design's pulse
 * grew to 1.1 gibson and ran through the labels). Held at a faint still ring
 * at the reach with reduced motion, so NEW still shows.
 */
export function pulseAt(t: number, phase: number, reduced: boolean, out: { scale: number; opacity: number } = { scale: 0, opacity: 0 }): { scale: number; opacity: number } {
  // `out` is written and returned, so a frame loop can pass one it keeps and allocate nothing.
  if (reduced) { out.scale = 1; out.opacity = 0.35; return out }
  const cyc = (((t + phase) % PULSE_S) + PULSE_S) % PULSE_S
  const k = Math.min(1, cyc / PULSE_RUN_S)
  // From the ring itself out to the reach.
  const from = RING_RADIUS / RING_REACH
  out.scale = from + (1 - from) * k
  out.opacity = (1 - k) * 0.9
  return out
}

/** A small, stable 0..1 hash of (i, seed). */
function hash01(i: number, seed: number): number {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** A level line's length `t` seconds in, as a share of a gibson: dancing while it plays, riding the wave while quiet. */
export function levelLength(i: number, t: number, playing: boolean, reduced: boolean, wave: number): number {
  const most = RING_REACH - RING_RADIUS
  if (playing && reduced) return 0.15
  if (playing) {
    const x = 0.5 + 0.5 * Math.sin(t * (5 + 7 * hash01(i, 91)) + hash01(i, 17) * TAU)
    const y = 0.6 + 0.4 * Math.sin(t * 1.3 + i * 0.45)
    return 0.06 + (most - 0.06) * x * y
  }
  return 0.05 + 0.06 * wave
}

// ---------- A sound's layer slices ----------

/** How many slices a sound's stack has, how far apart they stand, and how thick each is. */
export const SLICES = 7
export const SLICE_GAP = 0.09
export const SLICE_T = 0.03

/** Slice `i`'s share of the stack's shape: thin at the ends, full in the middle. */
export function sliceEnvelope(i: number): number {
  return Math.sin(((i + 0.5) / SLICES) * Math.PI)
}

/** Slice `i`'s height in the stack, from its middle. */
export function sliceY(i: number): number {
  return (i - (SLICES - 1) / 2) * SLICE_GAP
}

/**
 * Slice `i`'s radius at `t`: it swells with the sound while it plays and
 * breathes with the idle wave while quiet; still with reduced motion.
 */
export function sliceRadius(i: number, t: number, playing: boolean, reduced: boolean): number {
  let level: number
  if (playing && !reduced) level = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (5 + 6 * hash01(i, 53)) + i))
  else if (playing) level = 0.8
  else if (reduced) level = 0.675
  else level = 0.55 + 0.25 * (0.5 + 0.5 * Math.sin(i * 0.7 - (t / WAVE_S) * TAU))
  return 0.07 + 0.25 * sliceEnvelope(i) * level
}

/** The farthest a slice reaches from the stack's middle: its widest radius. */
export const SLICE_MAX_R = 0.07 + 0.25
/** How far the stack reaches under its middle. */
export const SLICES_LOW = -sliceY(0) + SLICE_T / 2

// ---------- An item's notch code ----------

/** An FNV-1a hash of a string. */
function fnv(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/**
 * An item's notch code: `n` notch depths of 1 to 3, cut into its card's
 * edge, the same for the same item everywhere and unlike its neighbours'.
 */
export function notchCode(id: string, n = 5): number[] {
  let a = fnv(id)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    out.push(1 + Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 3))
  }
  return out
}
