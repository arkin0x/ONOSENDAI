/**
 * chainRulesEpoch.test.ts - the hop proof version 2 cutover bumps the chain
 * rules epoch, so every tab of the build before it stops moving and asks for
 * a RELOAD once this build is deployed (lib/versionGate.ts).
 */

import { describe, expect, it } from 'vitest'
import { CHAIN_RULES_EPOCH, versionFileOf } from '../chainRulesEpoch'
import { verdictOf } from '../versionGate'

describe('the cutover epoch', () => {
  it('is 2: hops carry proof, mn and mp', () => {
    expect(CHAIN_RULES_EPOCH).toBe(2)
  })

  it('is what this deploy says it requires', () => {
    expect(versionFileOf('cutover-build')).toMatchObject({ build: 'cutover-build', minChainEpoch: 2 })
  })

  it('blocks a tab of the build before (epoch 1), and nothing of its own', () => {
    const deployed = versionFileOf('cutover-build')
    expect(verdictOf(deployed, { build: 'before-cutover', epoch: 1 })).toBe('blocked')
    expect(verdictOf(deployed, { build: 'cutover-build', epoch: CHAIN_RULES_EPOCH })).toBe('ok')
    // A later deploy at the same rules is only a hint.
    expect(verdictOf(versionFileOf('later-build'), { build: 'cutover-build', epoch: CHAIN_RULES_EPOCH })).toBe('hint')
  })
})
