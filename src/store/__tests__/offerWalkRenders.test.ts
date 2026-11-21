/**
 * offerWalkRenders.test.ts: the HOSAKA offer card's hook does not re-render
 * at every cursor move while no offer was asked for there (owner's walk of
 * 2026-11-21: OfferWatch and HosakaOffer rendered at every step of a fluid
 * WALK, about nine times a second, each working out the route's verdict for
 * a card that could not show).
 */

import { afterEach, describe, expect, it } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis

import { mountHook, settle } from '../../test/hookRoot'
import { useCyberspace } from '../useCyberspace'
import { useOffer, useOfferView } from '../useOffer'

const at = (x: bigint): { x: bigint; y: bigint; z: bigint } => ({ x, y: 0n, z: 0n })
const keyOf = (c: { x: bigint; y: bigint; z: bigint }, plane: number): string => `${c.x}:${c.y}:${c.z}:${plane}`
// A boundary at 2^25 on the way: past this machine's default sidestep, so the move has a verdict.
const FAR = at(1n << 25n)

function start(): void {
  useCyberspace.setState({ position: at(0n), cursor: at(0n), plane: 0, exploreIndex: null, spectate: null, focus: null, transit: null })
  useOffer.setState({ requestedFor: null, dismissedFor: null })
}

afterEach(() => { useOffer.setState({ requestedFor: null, dismissedFor: null }) })

describe('the offer card while the cursor walks', () => {
  it('re-renders nothing while no offer is asked for, however far the cursor goes', async () => {
    start()
    const h = mountHook(() => useOfferView(false), undefined)
    await settle()
    const before = h.renders()
    for (let i = 1n; i <= 30n; i++) { useCyberspace.setState({ cursor: at(i << 20n) }); await settle(1) }
    useCyberspace.setState({ cursor: FAR })
    await settle()
    expect(h.renders()).toBe(before)
    expect(h.current()).toBeNull()
    await h.unmount()
  })

  it('re-renders nothing while the cursor walks anywhere but the cursor OFFLOAD was pressed for', async () => {
    start()
    useOffer.getState().request(keyOf(FAR, 0))
    const h = mountHook(() => useOfferView(false), undefined)
    await settle()
    const before = h.renders()
    for (let i = 1n; i <= 30n; i++) { useCyberspace.setState({ cursor: at(i) }); await settle(1) }
    expect(h.renders()).toBe(before)
    expect(h.current()).toBeNull()
    await h.unmount()
  })

  it('still shows the card for the asked-for cursor, and puts it away when the cursor moves off it', async () => {
    start()
    useOffer.getState().request(keyOf(FAR, 0))
    const h = mountHook(() => useOfferView(false), undefined)
    await settle()
    expect(h.current()).toBeNull()
    useCyberspace.setState({ cursor: FAR })
    await settle()
    expect(h.current()?.cursorKey).toBe(keyOf(FAR, 0))
    expect(h.current()?.verdict).toBeTruthy()
    useCyberspace.setState({ cursor: at(5n) })
    await settle()
    expect(h.current()).toBeNull()
    // Back on the asked-for cursor, the card is back; NOT NOW puts it away.
    useCyberspace.setState({ cursor: FAR })
    await settle()
    expect(h.current()?.cursorKey).toBe(keyOf(FAR, 0))
    useOffer.getState().dismiss(keyOf(FAR, 0))
    await settle()
    expect(h.current()).toBeNull()
    await h.unmount()
  })
})
