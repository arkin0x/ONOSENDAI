/**
 * HudView.tsx - DRONE RUN's HUD as drawn: plain white words with a dark
 * shadow over the scene, lucide icons, every slot fixed so nothing moves
 * between phases (owner: no layout jumps).
 *
 * | Slot | What it shows |
 * |---|---|
 * | top left | HP pips (hearts, filled or empty); the one just lost pulses; they blink while you cannot be hit |
 * | under the pips | the radar (Radar.tsx): drones as dots, the end zone in gold, forward up |
 * | top right | WAVE n / total, drones left (a drone icon), the clock, the sound switch (M) |
 * | centre | the crosshair; a small X on it when a shot hits; on a phone with an assist gun (the PULSE RIFLE) in hand, the aim assist's box round it (AssistBox.tsx, model.ts assistShown) |
 * | edges | a red flash when you are hit |
 * | under the top bar | the safe zone's line: the wave's name, then "Leave the safe zone to start the wave." (kept empty, not removed, in other phases) |
 * | bottom left (desktop) | the stamina: STAMINA over a bar that drains while sprinting (Shift) and dims in the lockout; only for a variant with stamina (the phone's is the ring round SPRINT) |
 * | bottom (desktop) | the guns 1 2 3 with the one in hand lit, its name and its gauge; the key hints under it, folded during a wave |
 * | middle | the cards: RUN FAILED (RESTART, EXIT GAME) and WAVE n CLEAR (time, drones downed, NEXT WAVE, EXIT GAME) |
 *
 * On a phone the guns and the gauge are on the gun button above the MOVE
 * stick (TouchPad), and the key hints are not drawn.
 */

import { Drone, Heart, Volume2, VolumeX } from 'lucide-react'
import { formatClearTime } from '../../../lib/games/progress'
import { AssistBox } from './AssistBox'
import { assistShown, COPY, staminaOf, weaponIcon, type HudState, type HudWeapon } from './model'
import { Radar } from './Radar'

export interface Pulses {
  /** Counts up on each hit taken: the red flash restarts. */
  hurt: number
  /** Counts up on each shot that lands: the hit marker restarts. */
  hit: number
}

export interface HudViewProps {
  hud: HudState
  weapons: HudWeapon[]
  touch: boolean
  /** On a touch screen, whether the last pointer was a finger (not a trackpad or a mouse): the aim assist box needs it. Default true. */
  fingers?: boolean
  /** The mouse is locked to the view (desktop). */
  locked: boolean
  muted: boolean
  exiting: boolean
  pulses: Pulses
  onRestart: () => void
  onNextWave: () => void
  onExit: () => void
  onToggleSound: () => void
}

/** A click that lets go of the button's focus first, so Space (JUMP) and Enter never press it again. */
const tap = (fn: () => void) => (e?: React.MouseEvent<HTMLButtonElement>): void => { e?.currentTarget.blur(); fn() }

const pct = (v: number): string => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`

/** The gun in hand's gauge: a heat bar, a magazine count, or a charge bar (with the rail's heat under it). Same size for every gun. */
export function Gauge({ hud, weapon }: { hud: HudState; weapon: HudWeapon | undefined }): JSX.Element {
  const gauge = weapon?.gauge ?? 'heat'
  const status = hud.overheated ? COPY.overheat : hud.reloading ? COPY.reloading : ''
  return (
    <span className={`drun-gauge drun-gauge--${gauge}${hud.overheated ? ' is-hot' : ''}`}>
      <span className="drun-gauge__main">
        {gauge === 'ammo'
          ? <span className="drun-gauge__count" aria-label="rounds">{hud.reloading ? '-' : hud.ammo} / {hud.mag}</span>
          : (
            <span className="drun-bar" role="meter" aria-label={gauge === 'charge' ? COPY.charge : COPY.heat} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((gauge === 'charge' ? hud.charge : hud.heat) * 100)}>
              <span className="drun-bar__fill" style={{ width: pct(gauge === 'charge' ? hud.charge : hud.heat) }} />
            </span>
          )}
      </span>
      <span className="drun-gauge__sub">
        {gauge === 'charge' && weapon?.heats && <span className="drun-bar drun-bar--thin" aria-hidden><span className="drun-bar__fill" style={{ width: pct(hud.heat) }} /></span>}
      </span>
      <span className="drun-gauge__status" role="status">{status}</span>
    </span>
  )
}

/** The desktop's stamina: its label over a bar, in a slot of its own; dimmed in the lockout. */
export function StaminaGauge({ hud }: { hud: HudState }): JSX.Element {
  const st = staminaOf(hud)
  return (
    <span className={`drun-stamina${st.sprinting ? ' is-sprinting' : ''}${st.locked ? ' is-locked' : ''}`}>
      <span className="drun-stamina__label" aria-hidden>{COPY.stamina}</span>
      <span className="drun-bar" role="meter" aria-label={COPY.stamina} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(st.stamina * 100)}>
        <span className="drun-bar__fill" style={{ width: pct(st.stamina) }} />
      </span>
    </span>
  )
}

export function HudView(p: HudViewProps): JSX.Element {
  const { hud, weapons, touch, pulses } = p
  const pips = Array.from({ length: Math.max(1, hud.maxHp) }, (_, i) => i < hud.hp)
  const weapon = weapons[hud.weapon]
  const card = hud.phase === 'failed' || hud.phase === 'cleared'
  const hints = hud.phase === 'safe' ? COPY.hintsFull : COPY.hintsWave
  return (
    <div className={`drun-hudview drun-hudview--${hud.phase}${touch ? ' is-touch' : ''}`}>
      {pulses.hurt > 0 && <div key={`hurt${pulses.hurt}`} className="drun-flash" aria-hidden />}

      {touch && <AssistBox shown={assistShown(p.fingers ?? true, hud, weapons, p.exiting)} />}

      <div className="drun-cross" aria-hidden>
        <span className="drun-cross__h" />
        <span className="drun-cross__v" />
        <span className="drun-cross__dot" />
        {pulses.hit > 0 && <span key={`hit${pulses.hit}`} className="drun-hitmark" />}
      </div>

      <div className="drun-top">
        <span className={`drun-pips${hud.invulnerable ? ' is-blinking' : ''}`} aria-label={`HP ${hud.hp} of ${hud.maxHp}`}>
          {pips.map((full, i) => (
            <Heart key={full ? `f${i}` : `e${i}`} className={`drun-pip${full ? ' is-full' : ' is-lost'}`} size={20} strokeWidth={2.4} aria-hidden fill={full ? 'currentColor' : 'none'} />
          ))}
        </span>
        <span className="drun-top__right">
          <span className="drun-wave">{COPY.waveOf(hud.wave, hud.wavesTotal)}</span>
          <span className="drun-left" aria-label="drones left"><Drone size={16} strokeWidth={2.2} aria-hidden />{hud.dronesLeft}</span>
          <span className="drun-clock" aria-label="time">{formatClearTime(hud.runTime * 1000)}</span>
          <button className="drun-sound" aria-label={p.muted ? 'Sound off' : 'Sound on'} title="M" onClick={tap(p.onToggleSound)}>
            {p.muted ? <VolumeX size={15} strokeWidth={2.4} aria-hidden /> : <Volume2 size={15} strokeWidth={2.4} aria-hidden />}
            {!touch && <span className="drun-sound__key">M</span>}
          </button>
        </span>
      </div>

      <Radar />

      <div className="drun-prompt" aria-hidden={hud.phase !== 'safe'}>
        <span className="drun-prompt__title">{hud.phase === 'safe' ? `${COPY.wave(hud.wave)}${hud.waveName ? `  ${hud.waveName}` : ''}` : ''}</span>
        <span className="drun-prompt__line">{hud.phase === 'safe' ? COPY.safePrompt : ''}</span>
      </div>

      {!touch && staminaOf(hud).shown && <StaminaGauge hud={hud} />}

      {!touch && (
        <div className="drun-bottom">
          <div className="drun-gun">
            <span className="drun-slots">
              {weapons.map((w, i) => {
                const Icon = weaponIcon(w)
                return (
                  <span key={w.id} className={`drun-slot${i === hud.weapon ? ' is-on' : ''}`}>
                    <Icon size={16} strokeWidth={2.4} aria-hidden />
                    <span className="drun-slot__key">{i + 1}</span>
                  </span>
                )
              })}
            </span>
            <span className="drun-gun__name">{weapon?.name ?? ''}</span>
            <Gauge hud={hud} weapon={weapon} />
          </div>
          <div className="drun-hints" aria-label="keys">
            {!p.locked && <span className="drun-hint"><kbd>CLICK</kbd>{COPY.aim}</span>}
            {hints.filter(([k]) => p.locked || k !== 'CLICK').map(([k, what]) => <span key={k} className="drun-hint"><kbd>{k}</kbd>{what}</span>)}
          </div>
        </div>
      )}

      {card && (
        <div className="drun-card" role="dialog" aria-label={hud.phase === 'failed' ? COPY.failed : COPY.cleared(hud.wave)}>
          <span className={`drun-card__title${hud.phase === 'failed' ? ' is-failed' : ''}`}>{hud.phase === 'failed' ? COPY.failed : COPY.cleared(hud.wave)}</span>
          {hud.phase === 'cleared' && (
            <>
              <span className="drun-card__time">{formatClearTime(hud.runTime * 1000)}</span>
              <span className="drun-card__stat">{COPY.downed} <b>{hud.kills}</b></span>
            </>
          )}
          <div className="drun-card__row">
            {hud.phase === 'failed'
              ? <button className="drun-card__go" onClick={tap(p.onRestart)}>{COPY.restart}{!touch && <kbd>R</kbd>}</button>
              : <button className="drun-card__go" onClick={tap(p.onNextWave)}>{COPY.nextWave}{!touch && <kbd>R</kbd>}</button>}
            <button className="drun-card__exit" disabled={p.exiting} onClick={tap(p.onExit)}>{COPY.exit}</button>
          </div>
        </div>
      )}
    </div>
  )
}
