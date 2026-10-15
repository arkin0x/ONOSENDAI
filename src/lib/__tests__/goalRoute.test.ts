/**
 * goalRoute.test.ts - the trip GOAL plans (arkinox, 2026-10-14): walk when the
 * goal is no farther from you than from the stop nearest it, otherwise board
 * at your station, ride to the stop nearest the goal in its plane, and walk
 * the last mile; and say it is still looking while the line syncs.
 */
import { describe, expect, it } from 'vitest'
import { xyzToCoord } from 'cyberspace-core'
import { buildIndex } from '../hyperspace/station'
import { landfallCoord, landfallCoordApprox } from '../hyperspace/landfall'
import type { Stop } from '../hyperspace/stops'
import { goalSummary, planGoal } from '../goalRoute'
import { coordToXyz } from 'cyberspace-core'

const LF_HASH = '000000000000000000010538edbfd2d5b809a33dd83f284aeea41c6d0d96968a'
const hex = (n: bigint): string => n.toString(16).padStart(64, '0')

function port(height: number, x: bigint, y: bigint, z: bigint): Stop {
  const c = xyzToCoord(x, y, z, 1)
  return { height, kind: 'port', merkleRoot: hex(c), blockHash: null, coordExact: c, coordApprox: c }
}
function landfall(height: number): Stop {
  return { height, kind: 'landfall', merkleRoot: '0'.repeat(63) + '2', blockHash: LF_HASH, coordExact: null, coordApprox: landfallCoordApprox(LF_HASH) }
}

const FAR = 1n << 80n
const here = { x: 5n, y: 5n, z: 5n }
const target = { x: FAR + 1000n, y: FAR + 2000n, z: FAR + 3000n }

describe('planning a trip to the place on screen', () => {
  it('rides: board at your station, ride to the port nearest the goal, walk the last mile', () => {
    const index = buildIndex([port(100, 9n, 9n, 9n), port(150, FAR + 1024n, FAR + 2048n, FAR + 3072n), port(120, 1n << 60n, 0n, 0n)])
    const plan = planGoal({ here, herePlane: 1, target, targetPlane: 1, index, tip: 200, ready: true })
    expect(plan.kind).toBe('ride')
    if (plan.kind !== 'ride') return
    expect(plan.station.height).toBe(100)
    expect(plan.exit.height).toBe(150)
    expect(plan.exit.kind).toBe('port')
    expect(plan.blocks).toBe(50)
    expect(plan.exit.distance).toBeLessThan(plan.directDistance)
    expect(goalSummary(plan)).toBe('Board at block 100, ride 50 blocks to block 150 (port), then walk h' + plan.exit.distance + '.')
  })

  it('walks when the goal is a few hops away, nearer than any stop', () => {
    const index = buildIndex([port(100, 9n << 40n, 0n, 0n), port(150, FAR, FAR, FAR)])
    const plan = planGoal({ here, herePlane: 1, target: { x: 7n, y: 6n, z: 5n }, targetPlane: 1, index, tip: 200, ready: true })
    expect(plan.kind).toBe('direct')
    expect(plan.directDistance).toBeLessThanOrEqual(3)
  })

  it('exits at a landfall for a goal in dataspace, even with a port nearer by prefix', () => {
    const lf = landfall(300)
    const exact = coordToXyz(landfallCoord(LF_HASH))
    const index = buildIndex([port(100, 9n, 9n, 9n), lf, port(301, exact.x + 1n, exact.y, exact.z)])
    const plan = planGoal({ here, herePlane: 1, target: { x: exact.x + 5n, y: exact.y, z: exact.z }, targetPlane: 0, index, tip: 400, ready: true })
    expect(plan.kind).toBe('ride')
    if (plan.kind === 'ride') {
      expect(plan.exit.height).toBe(300)
      expect(plan.exit.kind).toBe('landfall')
    }
  })

  it('says it is still finding a stop while the line syncs, never naming one', () => {
    const index = buildIndex([port(100, 9n, 9n, 9n), port(150, FAR, FAR, FAR)])
    const plan = planGoal({ here, herePlane: 1, target, targetPlane: 1, index, tip: 200, ready: false })
    expect(plan.kind).toBe('loading')
    expect(goalSummary(plan)).toMatch(/still syncing/)
  })

  it('walks when your station is already the stop nearest the goal', () => {
    const index = buildIndex([port(150, FAR + 1024n, FAR + 2048n, FAR + 3072n)])
    const plan = planGoal({ here, herePlane: 1, target, targetPlane: 1, index, tip: 200, ready: true })
    expect(plan.kind).toBe('direct')
  })
})
