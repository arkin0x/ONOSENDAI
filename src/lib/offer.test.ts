import { describe, expect, it } from 'vitest'
import { offerVerdict } from './offer'

const P = (x: bigint) => ({ x, y: 7n, z: 7n })
const C = { hop: 17, sidestep: 24, cloudHop: 25, cloudSidestep: 29 }

describe('offerVerdict', () => {
  it('nothing to offer within this machine', () => {
    expect(offerVerdict(P(1000n), P(1000n + (1n << 10n)), 0, C, true)).toBeNull()
    expect(offerVerdict(P(1000n), P(1000n), 0, C, true)).toBeNull()
  })
  it('the cloud can, with the counts', () => {
    const v = offerVerdict(P(1000n), P(1000n + (1n << 20n)), 0, C, true)
    expect(v).toMatchObject({ tier: 'cloud', tallestWall: 21, cloudSteps: 1, steps: 1 })
  })
  it('the cloud could, caps unknown', () => {
    const v = offerVerdict(P(1000n), P(1000n + (1n << 20n)), 0, { ...C, cloudHop: 0, cloudSidestep: 0 }, false)
    expect(v).toMatchObject({ tier: 'cloud-unknown', tallestWall: 21 })
  })
  it('nobody can', () => {
    const v = offerVerdict(P(1000n), P(1000n + (1n << 40n)), 0, C, true)
    expect(v?.tier).toBe('impossible')
    expect(v?.tallestWall).toBe(41)
  })
})
