/**
 * useOffer.test.ts - the HOSAKA card is asked for, per cursor; OFFLOAD is
 * wanted only when the move needs the cloud and the cloud is not off.
 */

import { describe, expect, it } from 'vitest'
import { offloadWanted, useOffer, type OfferView } from './useOffer'

const need = (tier: OfferView['verdict']['tier']): OfferView => ({ verdict: { tallestWall: 24, tier, cloudSteps: 1, steps: 1 }, cursorKey: 'k', machineCeiling: 17 })

describe('offloadWanted', () => {
  it('wants OFFLOAD for a cloud move, or one the caps have not answered for, unless the cloud is off', () => {
    expect(offloadWanted(need('cloud'), 'auto')).toBe(true)
    expect(offloadWanted(need('cloud-unknown'), 'ask')).toBe(true)
    expect(offloadWanted(need('cloud'), 'off')).toBe(false)
    expect(offloadWanted(need('impossible'), 'auto')).toBe(false)
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
