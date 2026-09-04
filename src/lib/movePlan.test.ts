import { describe, expect, it } from 'vitest'
import { findLcaHeight } from 'cyberspace-core'
import { buildMovePlan, isSpecSidestep, isSpecSidestepMove, nextAxisMove, nextStep, planSummary, routeFeasible, summarizePlan, wallSource, type PlanStep, type Position } from './movePlan'

const P = (x: bigint, y: bigint = 5n, z: bigint = 5n): Position => ({ x, y, z })

function checkPlan(steps: PlanStep[], from: Position, to: Position, ceiling: number): void {
  let cur = from
  for (const s of steps) {
    expect(s.from).toEqual(cur)
    if (s.kind === 'hop') {
      for (const a of ['x', 'y', 'z'] as const) expect(findLcaHeight(s.from[a], s.to[a])).toBeLessThanOrEqual(ceiling)
      expect(s.from).not.toEqual(s.to)
    } else {
      expect(isSpecSidestepMove(s.from, s.to)).toBe(true)
    }
    cur = s.to
  }
  expect(cur).toEqual(to)
}

describe('spec 6.3 geometry', () => {
  it('names the leaf touching the wall on each side', () => {
    // wall at h=4 between 7 and 8
    expect(wallSource(0b0101n, 0b1000n, 4)).toBe(7n)
    expect(wallSource(0b1011n, 0b0001n, 4)).toBe(8n)
  })
  it('accepts the worked examples and rejects the counterexamples', () => {
    expect(isSpecSidestep(0b0111n, 0b1000n)).toBe(true)
    expect(isSpecSidestep(0b1000n, 0b0111n)).toBe(true)
    expect(isSpecSidestep(0b0101n, 0b1000n)).toBe(false) // source not at the wall
    expect(isSpecSidestep(0b0111n, 0b1011n)).toBe(false) // destination past the neighbour
    expect(isSpecSidestep(9n, 9n)).toBe(false)
  })
})

describe('nextAxisMove', () => {
  it('hops straight to the target within the ceiling', () => {
    expect(nextAxisMove(5n, 100n, 8)).toEqual({ kind: 'hop', to: 100n, height: 7 })
  })
  it('sidesteps when standing at the wall', () => {
    expect(nextAxisMove(7n, 12n, 2)).toEqual({ kind: 'sidestep', to: 8n, height: 4 })
    expect(nextAxisMove(8n, 3n, 2)).toEqual({ kind: 'sidestep', to: 7n, height: 4 })
  })
  it('walks to the wall first, within the ceiling', () => {
    // from 5 toward 12 with ceiling 2: the wall at h=4 is between 7 and 8; 5 -> 7 is an h=2 hop
    expect(nextAxisMove(5n, 12n, 2)).toEqual({ kind: 'hop', to: 7n, height: 2 })
  })
  it('handles a wall on the way to a wall', () => {
    // from 0 toward 2^20 + 3 with ceiling 4: the highest wall (h=21) is at 2^20 - 1 | 2^20;
    // reaching 2^20 - 1 from 0 crosses lower walls at h=5..20, each a sidestep after a walk
    const m = nextAxisMove(0n, (1n << 20n) + 3n, 4)
    expect(m).toEqual({ kind: 'hop', to: 15n, height: 4 })
  })
})

describe('buildMovePlan', () => {
  it('one hop when it fits', () => {
    const steps = buildMovePlan(P(5n), P(100n), 8)
    expect(steps).toHaveLength(1)
    expect(steps[0].kind).toBe('hop')
  })
  it('walks to the wall, sidesteps exactly one gibson, then hops on', () => {
    const from = P(0b0101n)
    const to = P(0b1011n)
    const steps = buildMovePlan(from, to, 2)
    expect(steps.map((s) => s.kind)).toEqual(['hop', 'sidestep', 'hop'])
    expect(steps[1].from.x).toBe(7n)
    expect(steps[1].to.x).toBe(8n)
    checkPlan(steps, from, to, 2)
  })
  it('crosses the same wall downward', () => {
    const from = P(0b1011n)
    const to = P(0b0101n)
    const steps = buildMovePlan(from, to, 2)
    expect(steps.map((s) => s.kind)).toEqual(['hop', 'sidestep', 'hop'])
    expect(steps[1].from.x).toBe(8n)
    expect(steps[1].to.x).toBe(7n)
    checkPlan(steps, from, to, 2)
  })
  it('the spawn-to-far-cursor case: many walls, every step legal', () => {
    const from = P(123456789n, 987654321n, 555n)
    const to = P(123456789n + (1n << 21n), 987654321n - (1n << 19n), 555n)
    const steps = buildMovePlan(from, to, 17)
    checkPlan(steps, from, to, 17)
    const s = summarizePlan(steps)
    expect(s.sidesteps).toBeGreaterThanOrEqual(2)
    expect(s.tallestWall).toBe(Math.max(findLcaHeight(from.x, to.x), findLcaHeight(from.y, to.y)))
  })
  it('a sidestep moves only the axes standing at their walls', () => {
    const from = P(7n, 7n, 3n)
    const to = P(8n, 8n, 3n)
    const steps = buildMovePlan(from, to, 1)
    expect(steps).toHaveLength(1)
    expect(steps[0].kind).toBe('sidestep')
    expect(steps[0].to).toEqual(P(8n, 8n, 3n))
  })
  it('random routes always end at the cursor with legal steps', () => {
    let seed = 7
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed }
    for (let i = 0; i < 40; i++) {
      // walls up to h24 above a ceiling of 12..17: routes stay in the tens
      const big = () => BigInt(rnd()) % (1n << 24n)
      const from = P(big(), big(), big())
      const to = P(big(), big(), big())
      const ceiling = 12 + (rnd() % 6)
      const steps = buildMovePlan(from, to, ceiling)
      checkPlan(steps, from, to, ceiling)
      const s = planSummary(from, to, ceiling)
      expect(s.steps).toBe(steps.length)
      expect(s.capped).toBe(false)
    }
  })
  it('the walk is exponential in the wall height above the ceiling, as the spec accepts', () => {
    // 0 -> 16 with ceiling 2: hop 0-3, sidestep 3-4, hop 4-7, sidestep 7-8, hop 8-11,
    // sidestep 11-12, hop 12-15, sidestep 15-16
    const steps = buildMovePlan(P(0n), P(16n), 2)
    expect(steps.map((s) => `${s.kind}:${s.to.x}`)).toEqual([
      'hop:3', 'sidestep:4', 'hop:7', 'sidestep:8', 'hop:11', 'sidestep:12', 'hop:15', 'sidestep:16',
    ])
    // one level taller wall, twice the walk
    expect(planSummary(P(0n), P(32n), 2).sidesteps).toBe(8)
    expect(planSummary(P(0n), P(1n << 30n), 17).sidesteps).toBe(1 << 13)
  })
  it('nextStep is what buildMovePlan repeats', () => {
    const from = P(0b0101n)
    const first = nextStep(from, P(0b1011n), 2)
    expect(first?.kind).toBe('hop')
    expect(first?.to.x).toBe(7n)
    expect(nextStep(from, from, 2)).toBeNull()
  })
})

describe('two ceilings: local first per step, cloud only where no local step exists', () => {
  const c = { hop: 17, sidestep: 24, cloudHop: 25, cloudSidestep: 29 }
  const localStep = (s: PlanStep) => s.source === 'local' && (s.kind === 'hop' ? s.maxHeight <= c.hop : s.maxHeight <= c.sidestep)
  const cloudStep = (s: PlanStep) => s.source === 'cloud' && (s.kind === 'hop' ? s.maxHeight > c.hop : s.maxHeight > c.sidestep)
  it('a walk this machine can make is never paid, however long', () => {
    const steps = buildMovePlan(P(1000n), P(1000n + (1n << 22n)), c)
    expect(steps.length).toBeGreaterThan(5)
    expect(steps.every(localStep)).toBe(true)
  })
  it('within the local ceiling nothing is paid', () => {
    expect(buildMovePlan(P(1000n), P(1000n + (1n << 10n)), c).map((s) => s.source)).toEqual(['local'])
  })
  it('at a wall this machine cannot cross HOSAKA hops to the cursor when its cap reaches', () => {
    // Standing on the leaf touching the h25 wall: the local sidestep is above h24.
    const steps = buildMovePlan(P((1n << 24n) - 1n), P((1n << 24n) + 5n), c)
    expect(steps.map((s) => `${s.kind}:${s.source}:h${s.maxHeight}`)).toEqual(['hop:cloud:h25'])
  })
  it('above the cloud hop cap HOSAKA sidesteps, and the walk goes on locally', () => {
    const steps = buildMovePlan(P((1n << 25n) - 1n), P((1n << 25n) + 5n), c)
    expect(steps.map((s) => `${s.kind}:${s.source}:h${s.maxHeight}`)).toEqual(['sidestep:cloud:h26', 'hop:local:h3'])
  })
  it('a far cursor: local walk, paid crossing, local walk, for every wall this machine cannot cross', () => {
    const from = P(5n)
    const to = P((1n << 26n) + 3n)   // wall at h27
    const steps = buildMovePlan(from, to, c)
    expect(steps.every((s) => localStep(s) || cloudStep(s))).toBe(true)
    expect(steps.filter((s) => s.source === 'cloud').map((s) => `${s.kind}:h${s.maxHeight}`)).toEqual([
      'hop:h25', 'sidestep:h26', 'hop:h25', 'sidestep:h27',
    ])
    expect(steps[0].source).toBe('local')
    expect(planSummary(from, to, c)).toMatchObject({ cloudSteps: 4, infeasibleAt: null })
  })
  it('a wall no one sells is named as the first infeasible step', () => {
    const s = planSummary(P(5n), P((1n << 40n) + 3n), c)
    expect(s.infeasibleAt).not.toBeNull()
  })
  it('routeFeasible agrees with the walk, in constant time', () => {
    const cases: Array<[bigint, bigint]> = [[5n, (1n << 40n) + 3n], [5n, (1n << 26n) + 3n], [1000n, 1000n + (1n << 22n)], [(1n << 28n) - 1n, 1n << 28n], [(1n << 29n) - 1n, 1n << 29n]]
    for (const [a, b] of cases) expect(routeFeasible(P(a), P(b), c)).toBe(planSummary(P(a), P(b), c).infeasibleAt === null)
    expect(routeFeasible(P(0n), P(1n << 30n), 17)).toBe(true) // a number: sidesteps unbounded
  })
  it('a plain number still means local only', () => {
    expect(buildMovePlan(P(0b0101n), P(0b1011n), 2).map((s) => s.source)).toEqual(['local', 'local', 'local'])
  })
})
