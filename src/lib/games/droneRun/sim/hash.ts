/**
 * hash.ts - a fingerprint of a run's state, for determinism tests and for a
 * client checking a replay: two 32-bit FNV-1a lanes over every number of the
 * state that the simulation reads (as exact float64 bits) and every mode.
 * The events of the last step and the read-only world are left out.
 */

import type { RunState } from './run'

const buf = new DataView(new ArrayBuffer(8))

class Hasher {
  a = 0x811c9dc5
  b = 0x01000193 ^ 0x5bd1e995
  byte(x: number): void {
    this.a = Math.imul(this.a ^ x, 0x01000193) >>> 0
    this.b = Math.imul(this.b ^ x, 0x5bd1e995) >>> 0
    this.b ^= this.b >>> 13
  }
  num(v: number): void {
    buf.setFloat64(0, v)
    for (let i = 0; i < 8; i++) this.byte(buf.getUint8(i))
  }
  str(s: string): void {
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); this.byte(c & 255); this.byte(c >>> 8) }
    this.byte(0)
  }
  bool(v: boolean): void { this.byte(v ? 1 : 2) }
  vec(v: readonly number[]): void { for (const x of v) this.num(x) }
  hex(): string { return this.a.toString(16).padStart(8, '0') + this.b.toString(16).padStart(8, '0') }
}

/** A 64-bit hex fingerprint of `st` (see the file header). */
export function stateHash(st: RunState): string {
  const h = new Hasher()
  h.num(st.wave); h.str(st.phase); h.num(st.step); h.num(st.waveStep); h.num(st.hp); h.num(st.invuln)
  const b = st.body
  h.vec(b.pos); h.vec(b.vel); h.bool(b.grounded); h.bool(b.doubled); h.num(b.coyote); h.num(b.jumpBuffer); h.num(b.yaw); h.num(b.pitch)
  const a = st.arsenal
  h.num(a.current); h.num(a.ready); h.num(a.pulls)
  for (const g of a.guns) { h.num(g.cool); h.num(g.heat); h.num(g.lock); h.num(g.mag); h.num(g.reload); h.num(g.charge); h.bool(g.charging); h.bool(g.latched) }
  h.num(st.drones.length)
  for (const d of st.drones) {
    h.num(d.id); h.num(d.def); h.vec(d.pos); h.vec(d.vel); h.num(d.hp); h.str(d.mode); h.num(d.modeT); h.bool(d.alerted); h.bool(d.sees)
    h.vec(d.lastKnown); h.num(d.sinceSeen); h.num(d.cooldown); h.num(d.windup); h.num(d.burstLeft); h.num(d.burstGap); h.vec(d.aim)
    h.num(d.strafe); h.num(d.strafeT); h.vec(d.home); h.vec(d.patrolTo)
  }
  h.num(st.droneShots.length)
  for (const s of st.droneShots) { h.num(s.id); h.num(s.drone); h.vec(s.pos); h.vec(s.vel); h.num(s.radius); h.num(s.travelled); h.num(s.range); h.num(s.damage) }
  h.num(st.projectiles.length)
  for (const p of st.projectiles) { h.num(p.id); h.num(p.weapon); h.vec(p.pos); h.vec(p.vel); h.num(p.travelled); h.num(p.range); h.num(p.damage); h.num(p.pierceLeft); h.vec(p.hit) }
  for (const l of st.waveState.lines) { h.bool(l.started); h.num(l.startAt); h.num(l.spawned) }
  h.num(st.rng.guns.s); h.num(st.rng.drones.s); h.num(st.rng.spawns.s); h.num(st.ids.next)
  for (const k of Object.keys(st.kills).sort()) { h.str(k); h.num(st.kills[k]) }
  h.num(st.clearTimeS ?? -1); h.num(st.score)
  return h.hex()
}
