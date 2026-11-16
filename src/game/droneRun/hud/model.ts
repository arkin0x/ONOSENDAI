/**
 * model.ts - what DRONE RUN's HUD draws from, and its words.
 *
 * HudState is the runner's HUD store as the HUD reads it (runner.ts
 * useDroneRunHud); HudWeapon is one gun as the HUD shows it: its name, its
 * icon and which gauge it has (heat, a magazine, or a charge with heat
 * under it), read from the variant's WeaponDefs.
 *
 * Every word the HUD prints is in COPY, so the owner reads them in one
 * place. Ledger class (c), client.
 */

import { Activity, Crosshair, Sparkles, Zap, type LucideIcon } from 'lucide-react'
import type { WeaponDef } from '../../../lib/games/droneRun/types'
import base from '../../../lib/games/droneRun/variants/drone-run-base.json'
import type { DroneRunHud } from '../runner'

export type HudPhase = DroneRunHud['phase']

/** The runner's HUD numbers (runner.ts useDroneRunHud), as the HUD reads them. */
export type HudState = DroneRunHud

export type Gauge = 'heat' | 'ammo' | 'charge'

export interface HudWeapon {
  id: string
  name: string
  gauge: Gauge
  /** A charge gun that also heats (the rail): a thin heat line under its charge bar. */
  heats: boolean
  /** Its WeaponDef's `assist`: "auto" (the PULSE RIFLE in the base variant) shows the aim assist box on a phone while it is in hand. */
  assist: 'auto' | null
}

/** Which gauge a gun has: a magazine, a charge, or heat. */
export function gaugeOf(def: Pick<WeaponDef, 'mode' | 'ammo' | 'heat'>): Gauge {
  if (def.ammo) return 'ammo'
  if (def.mode === 'charge') return 'charge'
  return 'heat'
}

export function hudWeapons(defs: readonly WeaponDef[]): HudWeapon[] {
  return defs.map((d) => ({ id: d.id, name: d.name, gauge: gaugeOf(d), heats: !!d.heat, assist: d.assist ?? null }))
}

/** The guns as the runner's store lists them (names, what each runs on, which charge, which take the assist); the base variant's when it lists none. */
export function weaponsOfHud(h: Pick<DroneRunHud, 'weaponNames' | 'weaponKinds' | 'weaponCharges' | 'weaponAssists'>): HudWeapon[] {
  if (h.weaponNames.length === 0) return BASE_WEAPONS
  return h.weaponNames.map((name, i) => ({
    id: `${i}:${name}`,
    name,
    gauge: h.weaponCharges[i] ? 'charge' : (h.weaponKinds[i] ?? 'heat'),
    heats: (h.weaponKinds[i] ?? 'heat') === 'heat',
    assist: h.weaponAssists[i] ?? null,
  }))
}

/** The base variant's guns, for a HUD whose runner does not say. */
export const BASE_WEAPONS: HudWeapon[] = hudWeapons((base as { spec: { weapons: WeaponDef[] } }).spec.weapons)

const ICONS: Record<Gauge, LucideIcon> = { heat: Activity, ammo: Sparkles, charge: Zap }

/** A gun's icon, by its gauge: a pulse for heat, sparks for the scatter, a bolt for the rail. */
export function weaponIcon(w: HudWeapon | undefined): LucideIcon {
  return w ? ICONS[w.gauge] : Crosshair
}

/**
 * The phone controls' sizes as styles.css draws them on a tall screen, CSS
 * px (--drun-stick, --drun-fire, --drun-jump): for the places a finger is
 * measured from before the controls are drawn, and for tests. The CSS is the
 * source; keep these in step with it.
 */
export const STICK_PX = 120
export const FIRE_PX = 88
export const JUMP_PX = 64
/** The aim assist box's side: halfway between FIRE and the MOVE stick (--drun-assist). */
export const ASSIST_PX = (STICK_PX + FIRE_PX) / 2

/**
 * The aim assist box shows (and so the assist runs) only when all hold:
 * - `fingers`: a touch screen whose last pointer was a finger (an iPad
 *   driven by a trackpad or a mouse hides it until the next touch);
 * - the gun in hand has `assist: "auto"` (the variant's data);
 * - no card is up and the game is not exiting.
 */
export function assistShown(fingers: boolean, hud: Pick<HudState, 'phase' | 'weapon'>, weapons: readonly HudWeapon[], exiting = false): boolean {
  return fingers && !exiting && weapons[hud.weapon]?.assist === 'auto' && hud.phase !== 'failed' && hud.phase !== 'cleared'
}

/** The HUD before the runner says anything (the world loading): the safe zone, full health, the base variant's guns. */
export const IDLE_HUD: HudState = {
  phase: 'safe', hp: 3, maxHp: 3, invulnerable: false, wave: 1, waveName: '', wavesTotal: 3, dronesLeft: 0,
  weapon: 0, weaponNames: BASE_WEAPONS.map((w) => w.name), weaponKinds: BASE_WEAPONS.map((w) => (w.gauge === 'ammo' ? 'ammo' : 'heat')),
  weaponCharges: BASE_WEAPONS.map((w) => w.gauge === 'charge'), weaponAssists: BASE_WEAPONS.map((w) => w.assist), heat: 0, overheated: false, ammo: 0, mag: 0, reloading: false,
  charge: 0, switching: false, runTime: 0, kills: 0, score: 0,
}

/** Every word the HUD prints (drafts for the owner's approval). */
export const COPY = {
  safePrompt: 'Leave the safe zone to start the wave.',
  wave: (n: number) => `WAVE ${n}`,
  waveOf: (n: number, total: number) => `WAVE ${n} / ${total}`,
  failed: 'RUN FAILED',
  cleared: (n: number) => `WAVE ${n} CLEAR`,
  downed: 'DRONES DOWNED',
  restart: 'RESTART',
  nextWave: 'NEXT WAVE',
  exit: 'EXIT GAME',
  overheat: 'OVERHEAT',
  reloading: 'RELOADING',
  reload: 'RELOAD',
  fire: 'FIRE',
  jump: 'JUMP',
  move: 'MOVE',
  look: 'LOOK',
  heat: 'HEAT',
  charge: 'CHARGE',
  /** The desktop hint line: key, then what it does. */
  hintsFull: [['WASD', 'MOVE'], ['SPACE', 'JUMP'], ['CLICK', 'FIRE'], ['1 2 3 Q', 'GUNS'], ['R', 'RELOAD'], ['M', 'SOUND']] as const,
  hintsWave: [['1 2 3 Q', 'GUNS'], ['R', 'RELOAD']] as const,
  /** Before the pointer is locked, the click aims (takes the mouse). */
  aim: 'AIM',
} as const
