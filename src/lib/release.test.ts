/**
 * release.test.ts — the gate rule on its own, with no store and no relay.
 *
 * The rule is four lines and every one of them is a decision somebody could
 * reasonably have made the other way, so each gets a case: the flip does not
 * publish, an action does, Local shuts it again, and a head that arrived from
 * the relay is not an action of ours.
 */

import { describe, expect, it } from 'vitest'
import { chainFacts, gateAfter, publishTag, PUBLISH_TAG_LABEL } from './release'

const facts = (live: boolean, headId: string, headSent = false): ReturnType<typeof chainFacts> =>
  ({ live, headId, headSent })

describe('the release gate', () => {
  it('stays shut when the switch goes from Local to Live', () => {
    expect(gateAfter(false, facts(false, 'a'), facts(true, 'a'))).toBe(false)
  })

  it('opens when a new action is appended while Live', () => {
    expect(gateAfter(false, facts(true, 'a'), facts(true, 'b'))).toBe(true)
  })

  it('stays open across the sends that follow', () => {
    expect(gateAfter(true, facts(true, 'b'), facts(true, 'b', true))).toBe(true)
  })

  it('shuts again on Local, and a new action taken there does not reopen it', () => {
    expect(gateAfter(true, facts(true, 'b'), facts(false, 'b'))).toBe(false)
    expect(gateAfter(false, facts(false, 'b'), facts(false, 'c'))).toBe(false)
  })

  it('does not open for a head adopted from the relay', () => {
    // adoptChain marks a relay-sourced head 'ok': it is our chain coming back,
    // not a move made here.
    expect(gateAfter(false, facts(true, 'a'), facts(true, 'b', true))).toBe(false)
  })

  it('reads its facts off the store shape', () => {
    expect(chainFacts({ live: true, prevEventId: 'b', published: { a: 'ok', b: 'queued' } }))
      .toEqual({ live: true, headId: 'b', headSent: false })
    expect(chainFacts({ live: false, prevEventId: 'a', published: { a: 'ok' } }))
      .toEqual({ live: false, headId: 'a', headSent: true })
  })
})

describe('the tag one action wears', () => {
  it('calls only a sent action Live, and tells a refusal from an untried one', () => {
    expect(publishTag('ok')).toBe('live')
    expect(publishTag('queued')).toBe('local')
    expect(publishTag('sending')).toBe('sending')
    expect(publishTag('failed')).toBe('failed')
    // An id the published map has never heard of is on this device, like any
    // other action that has not been sent.
    expect(publishTag(undefined)).toBe('local')
  })

  it('writes each of the four out', () => {
    expect(PUBLISH_TAG_LABEL.live).toBe('LIVE')
    expect(PUBLISH_TAG_LABEL.local).toBe('LOCAL')
    expect(PUBLISH_TAG_LABEL.sending).toBe('SENDING')
    expect(PUBLISH_TAG_LABEL.failed).toBe('FAILED')
  })
})
