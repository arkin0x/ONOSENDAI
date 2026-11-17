/**
 * devHandle.ts - window.__droneRun, a handle for scripting and measuring a
 * run from the console or a recording script. Only in development, or with
 * ?droneRunDebug=1 off the production hosts; never on www.onosendai.tech.
 *
 * Look angles here are SCREEN terms, as input.ts keeps them (yaw 0 faces the
 * way the run goes, positive turns the view left); positions are
 * region-local gibsons, cyberspace axes (the simulation's).
 *
 *   __droneRun.state         the HUD snapshot plus phase, step, hash
 *   __droneRun.player        { pos, eye, vel, grounded, look: { yaw, pitch } }
 *   __droneRun.drones        [{ index, id, enemy, pos, vel, hp, mode, sees, windup }]
 *   __droneRun.seed          the run's seed
 *   __droneRun.teleport(x, y, z)   put the feet there (stops the body)
 *   __droneRun.setLook(yaw, pitch) turn the view
 *   __droneRun.aimAt(i)            look at drone i (its index in .drones)
 *   __droneRun.move(fwd, strafe) / fire(down) / jump() / reload() / select(i)   hold or press inputs
 *   __droneRun.restart() / nextWave()
 *   __droneRun.spawn(enemy, count, at?)   add drones near `at` (default 30 ahead), for measuring
 *   __droneRun.slowMo(k)     run time at k times real time (0.1 for a slow-motion recording)
 *   __droneRun.perf()        frame times (ms) and draw calls over the last 600 frames
 *
 * teleport and spawn change the run outside its inputs: a run touched by them
 * is no longer a replayable one. They exist for testing.
 */

import type { Vec3 } from '../../lib/games/droneRun/sim'
import { eyeOf } from '../../lib/games/droneRun/sim'
import { makeDrone } from '../../lib/games/droneRun/sim/drones'
import type { DroneRunner } from './runner'
import { useDroneRunHud } from './runner'
import { lookAtScreen } from './frame'
import { holdMove, lookState, pressJump, pressReload, pressSelect, releaseMove, setFire, setLook } from './input'

const PRODUCTION_HOSTS = new Set(['onosendai.tech', 'www.onosendai.tech'])

/** Whether the handle may be installed here. */
export function devHandleAllowed(): boolean {
  if (import.meta.env.DEV) return true
  try {
    if (PRODUCTION_HOSTS.has(location.hostname.toLowerCase())) return false
    return new URLSearchParams(location.search).get('droneRunDebug') === '1'
  } catch {
    return false
  }
}

/** Frame stats the canvas writes (Canvas3D). */
export const frameStats = {
  /** The frame's interval, ms (what the screen's clock gave). */
  ms: new Float32Array(600),
  /** The two render passes' own CPU time, ms. */
  cpu: new Float32Array(600),
  calls: new Float32Array(600),
  /** The frame's own work before rendering (the steps, the camera, drones and effects), ms. */
  work: new Float32Array(600),
  at: 0,
  filled: 0,
  /** When this frame's work began (performance.now()). */
  began: 0,
  start(): void { this.began = performance.now() },
  note(ms: number, cpu: number, calls: number, work = 0): void {
    this.work[this.at] = work
    this.ms[this.at] = ms
    this.cpu[this.at] = cpu
    this.calls[this.at] = calls
    this.at = (this.at + 1) % this.ms.length
    this.filled = Math.min(this.ms.length, this.filled + 1)
  },
}

function summary(): { frames: number; avgMs: number; p50Ms: number; p95Ms: number; maxMs: number; fps: number; workMs: number; renderCpuMs: number; drawCalls: number } {
  const n = frameStats.filled
  if (!n) return { frames: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0, fps: 0, workMs: 0, renderCpuMs: 0, drawCalls: 0 }
  const work = Array.from(frameStats.work.slice(0, n)).reduce((s, x) => s + x, 0) / n
  const cpu = Array.from(frameStats.cpu.slice(0, n)).reduce((s, x) => s + x, 0) / n
  const ms = Array.from(frameStats.ms.slice(0, n)).sort((a, b) => a - b)
  const avg = ms.reduce((s, x) => s + x, 0) / n
  const calls = Array.from(frameStats.calls.slice(0, n)).reduce((s, x) => s + x, 0) / n
  const r = (x: number): number => Math.round(x * 100) / 100
  return { frames: n, avgMs: r(avg), p50Ms: r(ms[Math.floor(n * 0.5)]), p95Ms: r(ms[Math.min(n - 1, Math.floor(n * 0.95))]), maxMs: r(ms[n - 1]), fps: r(1000 / avg), workMs: r(work), renderCpuMs: r(cpu), drawCalls: r(calls) }
}

const v3 = (p: Readonly<Vec3>): Vec3 => [p[0], p[1], p[2]]

/** Installs window.__droneRun for `runner`; the return removes it. */
export function installDevHandle(runner: DroneRunner): () => void {
  if (!devHandleAllowed() || typeof window === 'undefined') return () => {}
  const handle = {
    get state() {
      const st = runner.state
      return { ...useDroneRunHud.getState(), phase: st.phase, step: st.step, hash: runner.hash(), paused: runner.paused }
    },
    get player() {
      const st = runner.state
      return { pos: v3(st.body.pos), eye: eyeOf(st.body, st.world.variant.spec.player), vel: v3(st.body.vel), grounded: st.body.grounded, look: { yaw: lookState.yaw, pitch: lookState.pitch } }
    },
    get drones() {
      return runner.state.drones.map((d, index) => ({ index, id: d.id, enemy: d.enemy, pos: v3(d.pos), vel: v3(d.vel), hp: d.hp, mode: d.mode, sees: d.sees, windup: d.windup }))
    },
    get seed() {
      return runner.seed
    },
    teleport(x: number, y: number, z: number): void {
      const b = runner.state.body
      b.pos[0] = x; b.pos[1] = y; b.pos[2] = z
      b.vel[0] = 0; b.vel[1] = 0; b.vel[2] = 0
      b.grounded = false
      const e = eyeOf(b, runner.state.world.variant.spec.player)
      runner.prev.eye[0] = e[0]; runner.prev.eye[1] = e[1]; runner.prev.eye[2] = e[2]
    },
    setLook(yaw: number, pitch = 0): void {
      setLook(yaw, pitch)
    },
    aimAt(index: number): boolean {
      const st = runner.state
      const d = st.drones[index]
      if (!d) return false
      const look = lookAtScreen(eyeOf(st.body, st.world.variant.spec.player), d.pos)
      setLook(look.yaw, look.pitch)
      return true
    },
    move(fwd: number, strafe = 0): void {
      if (fwd === 0 && strafe === 0) releaseMove('dev')
      else holdMove('dev', { fwd, strafe })
    },
    fire(down: boolean): void { setFire('dev', down) },
    jump(): void { pressJump() },
    reload(): void { pressReload() },
    select(i: number): void { pressSelect(i) },
    restart(): void { runner.restart() },
    nextWave(): void { runner.nextWave() },
    spawn(enemy: string, count = 1, at?: Vec3): number {
      const st = runner.state
      const defs = st.world.variant.spec.enemies
      const di = defs.findIndex((e) => e.id === enemy)
      if (di < 0) return 0
      const eye = eyeOf(st.body, st.world.variant.spec.player)
      const base: Vec3 = at ?? [eye[0], eye[1] + 8, eye[2] - 30]
      for (let i = 0; i < count; i++) {
        const a = (i / Math.max(1, count)) * Math.PI * 2
        const p: Vec3 = [base[0] + Math.cos(a) * 6, base[1] + (i % 3), base[2] + Math.sin(a) * 6]
        st.drones.push(makeDrone(st.ids.next++, defs, di, p, eye, st.rng.drones))
      }
      return st.drones.length
    },
    /** Slow motion: run time at `k` times real time (1 normal). The steps stay 1/60 s of run time, so a run stays replayable. */
    slowMo(k: number): void { runner.timeScale = Math.max(0.01, Math.min(4, k)) },
    perf: summary,
    resetPerf(): void { frameStats.at = 0; frameStats.filled = 0 },
  }
  ;(window as unknown as { __droneRun?: typeof handle }).__droneRun = handle
  return () => {
    const w = window as unknown as { __droneRun?: typeof handle }
    if (w.__droneRun === handle) delete w.__droneRun
  }
}
