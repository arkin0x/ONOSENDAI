/**
 * radar.test.ts - DRONE RUN's radar (hud/Radar.tsx): forward is up and right
 * is right, it turns with you, things beyond its reach sit on the rim, the
 * end zone's marker points the right way, and the reach is the drones' sight.
 */

import { describe, expect, it } from 'vitest'
import { drawRadar, radarPoint, radarRange, RADAR_INSET, RADAR_COLORS, type RadarCtx, type RadarPoint } from '../Radar'
import base from '../../../../lib/games/droneRun/variants/drone-run-base.json'
import type { DroneRunVariant, RunState } from '../../../../lib/games/droneRun/sim'

const R = 48
const RANGE = 55
const REACH = R - RADAR_INSET
const at = (px: number, pz: number, yaw: number, tx: number, tz: number, range = RANGE): RadarPoint => radarPoint(px, pz, yaw, tx, tz, range, R, { x: 0, y: 0, clamped: false })

describe('where a thing lands on the radar', () => {
  // The player at (128, 200), facing the run's way (-Z) at yaw 0. Facing -Z, right on screen is -X (frame.ts).
  it('straight ahead draws above the centre', () => {
    const p = at(128, 200, 0, 128, 180)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(-20 * (REACH / RANGE))
    expect(p.clamped).toBe(false)
  })

  it('to your right draws right of the centre; behind draws below', () => {
    const right = at(128, 200, 0, 118, 200)
    expect(right.x).toBeCloseTo(10 * (REACH / RANGE))
    expect(right.y).toBeCloseTo(0)
    const behind = at(128, 200, 0, 128, 210)
    expect(behind.y).toBeGreaterThan(0)
    expect(behind.x).toBeCloseTo(0)
  })

  it('turning 90 degrees right brings the one on your right ahead, and puts the one ahead on your left', () => {
    // Positive yaw turns left (input.ts), so a right turn is -90 degrees.
    const yaw = -Math.PI / 2
    const wasRight = at(128, 200, yaw, 118, 200)
    expect(wasRight.x).toBeCloseTo(0)
    expect(wasRight.y).toBeLessThan(0)
    const wasAhead = at(128, 200, yaw, 128, 180)
    expect(wasAhead.x).toBeLessThan(0)
    expect(wasAhead.y).toBeCloseTo(0)
    // A left turn the other way.
    expect(at(128, 200, Math.PI / 2, 128, 180).x).toBeGreaterThan(0)
  })

  it('beyond the reach it sits on the rim, in its direction', () => {
    const far = at(128, 200, 0, 28, 100)
    expect(far.clamped).toBe(true)
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(REACH)
    expect(far.x).toBeCloseTo(REACH * Math.SQRT1_2)
    expect(far.y).toBeCloseTo(-REACH * Math.SQRT1_2)
    // Exactly at the reach: on the rim, not held there.
    const edge = at(128, 200, 0, 128, 200 - RANGE)
    expect(edge.clamped).toBe(false)
    expect(edge.y).toBeCloseTo(-REACH)
  })

  it('the reach is the drones\' largest sight, else the fog\'s far edge', () => {
    const v = base as unknown as DroneRunVariant
    expect(radarRange(v)).toBe(Math.max(...v.spec.enemies.map((e) => e.detect)))
    expect(radarRange({ spec: { ...v.spec, enemies: [] }, client: { fog: { far: 40 } } } as never)).toBe(40)
    for (const e of v.spec.enemies) expect(RADAR_COLORS[e.id]).toBeTruthy()
  })
})

describe('drawing it', () => {
  /** A context that records the shapes drawn. */
  function recorder() {
    const log: Array<[string, ...number[]]> = []
    const fills: unknown[] = []
    const g = {
      fillStyle: '' as unknown, strokeStyle: '' as unknown, lineWidth: 1,
      setTransform: () => {}, clearRect: () => {}, beginPath: () => {}, closePath: () => {}, stroke: () => {},
      fill: () => { fills.push(g.fillStyle) },
      arc: (x: number, y: number, r: number) => { log.push(['arc', x, y, r]) },
      moveTo: (x: number, y: number) => { log.push(['moveTo', x, y]) },
      lineTo: (x: number, y: number) => { log.push(['lineTo', x, y]) },
    }
    return { g: g as unknown as RadarCtx, log, fills }
  }
  const v = base as unknown as DroneRunVariant
  const scout = v.spec.enemies.findIndex((e) => e.id === 'scout')
  function state(yaw = 0): { st: RunState; yaw: number } {
    const st = {
      world: { variant: v, level: { finish: { lo: [114, 66, 66], hi: [142, 78, 84] } } },
      body: { pos: [128, 64, 200] },
      drones: [{ def: scout, hp: 2, pos: [118, 70, 200] }, { def: scout, hp: 0, pos: [128, 70, 190] }],
    } as unknown as RunState
    return { st, yaw }
  }

  it('the end zone far ahead: a gold marker on the rim above the centre; a live drone on the right in its colour; you in the middle', () => {
    const { g, log, fills } = recorder()
    const size = 2 * R
    const { st, yaw } = state()
    drawRadar(g, size, 2, st, yaw)
    // The end zone's diamond starts at its top point (4 px above its centre).
    const [, ex, ey] = log.find((e) => e[0] === 'moveTo')!
    expect(ex).toBeCloseTo(R)
    expect(ey + 4).toBeCloseTo(R - REACH)
    expect(fills).toContain('rgb(255, 201, 74)')
    // The disc, the half ring, one live drone (the downed one is not drawn).
    const arcs = log.filter((e) => e[0] === 'arc')
    expect(arcs.length).toBe(3)
    const [, dx, dy] = arcs[2]
    expect(dx).toBeGreaterThan(R)
    expect(dy).toBeCloseTo(R)
    expect(fills).toContain(RADAR_COLORS.scout)
  })

  it('turned around, the end zone is on the rim below', () => {
    const { g, log } = recorder()
    const { st } = state()
    drawRadar(g, 2 * R, 1, st, Math.PI)
    const [, ex, ey] = log.find((e) => e[0] === 'moveTo')!
    expect(ex).toBeCloseTo(R)
    expect(ey + 4).toBeCloseTo(R + REACH)
  })

  it('no run yet: the disc and you, nothing else', () => {
    const { g, log } = recorder()
    drawRadar(g, 2 * R, 1, null, 0)
    expect(log.filter((e) => e[0] === 'arc').length).toBe(2)
  })
})
