/**
 * useOffer.test.ts - the HOSAKA card is asked for, per cursor; OFFLOAD is
 * wanted only when the move needs the cloud and the cloud is not off.
 */

import { describe, expect, it } from 'vitest'
import { offloadWanted, useOffer, type OfferView } from './useOffer'

const need = (tier: OfferView['verdict']['tier'], localFeasible: boolean): OfferView => ({ verdict: { tallestWall: 24, tier, cloudSteps: 1, steps: 1 }, cursorKey: 'k', machineCeiling: 17, localFeasible })

describe('offloadWanted', () => {
  it('wants OFFLOAD only when no local walk crosses: a wall above the sidestep ceiling, whatever the cloud mode', () => {
    expect(offloadWanted(need('cloud', false), 'auto')).toBe(true)
    expect(offloadWanted(need('cloud', false), 'off')).toBe(true)
    expect(offloadWanted(need('impossible', false), 'auto')).toBe(true)
    // A wall above the hop ceiling only: the machine hops, sidesteps, hops on. COMMIT.
    expect(offloadWanted(need('cloud', true), 'auto')).toBe(false)
    expect(offloadWanted(need('cloud-unknown', true), 'ask')).toBe(false)
    expect(offloadWanted(null, 'auto')).toBe(false)
  })
})

describe('the request', () => {
  it('is per cursor, and NOT NOW clears it', () => {
    useOffer.getState().request('a:b:c:0')
    expect(useOffer.getState().requestedFor).toBe('a:b:c:0')
    expect(useOffer.getState().dismissedFor).toBeNull()
    useOffer.getState().dismiss('a:b:c:0')
    expect(useOffer.getState().requestedFor).toBeNull()
    expect(useOffer.getState().dismissedFor).toBe('a:b:c:0')
    useOffer.getState().request('a:b:c:0')
    expect(useOffer.getState().dismissedFor).toBeNull()
  })
})
