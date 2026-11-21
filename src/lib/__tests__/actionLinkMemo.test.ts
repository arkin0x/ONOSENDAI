/**
 * actionLinkMemo.test.ts: an event's chain link is read from its tags once,
 * not at every head confirmation (owner's phone walk of 2026-11-21: chainGap
 * read every link of a 2,600-action chain before every signature).
 *
 * What would go wrong silently: a link read from tags an event no longer has.
 */
import { describe, expect, it } from 'vitest'
import { actionLink, chainGap, hopTemplate, spawnTemplate, type NostrEvent } from '../events'

const PK = 'ab'.repeat(32)
const spawn: NostrEvent = { ...spawnTemplate(PK, 1_000), id: 'cd'.repeat(32), pubkey: PK, sig: '0'.repeat(128) }
function hop(n: number, previousId: string): NostrEvent {
  return { ...hopTemplate({ createdAt: 1_000 + n, genesisId: spawn.id, previousId, prevCoordHex: PK, to: { x: BigInt(n), y: 1n, z: 1n }, plane: 0, proofHash: '0'.repeat(64), mn: '0'.repeat(16), mp: '00' }), id: n.toString(16).padStart(64, '0'), pubkey: PK, sig: '0'.repeat(128) }
}

describe('actionLink, read once per event', () => {
  it('answers the same event with the same link, read once', () => {
    const e = hop(1, spawn.id)
    const a = actionLink(e)
    expect(a).not.toBeNull()
    expect(actionLink(e)).toBe(a)
    expect(Object.isFrozen(a)).toBe(true)
  })

  it('reads afresh when the event\'s tags or fields are not the ones it was read from', () => {
    const e = hop(2, spawn.id)
    const a = actionLink(e)!
    const other = 'ef'.repeat(32)
    // A new tags array naming another previous.
    e.tags = e.tags.map((t) => (t[0] === 'e' && t[3] === 'previous' ? [t[0], other, t[2] ?? '', 'previous'] : t))
    expect(actionLink(e)!.previousId).toBe(other)
    // A tag added in place.
    const f = hop(3, spawn.id)
    expect(actionLink(f)).not.toBeNull()
    f.tags.push(['A', 'spawn'])
    expect(actionLink(f)).toBeNull()
    // Another id or kind.
    const g = hop(4, spawn.id)
    expect(actionLink(g)!.id).toBe(g.id)
    g.id = 'aa'.repeat(32)
    expect(actionLink(g)!.id).toBe(g.id)
    g.kind = 1
    expect(actionLink(g)).toBeNull()
    expect(a.previousId).toBe(spawn.id)
  })

  it('chainGap finds the same hole as before, asked again and again', () => {
    const chain: NostrEvent[] = [spawn]
    for (let n = 1; n <= 3_000; n++) chain.push(hop(n, chain[chain.length - 1].id))
    expect(chainGap(chain, spawn.id)).toBeNull()
    const holed = chain.filter((_, i) => i !== 1_500)
    for (let i = 0; i < 5; i++) expect(chainGap(holed, spawn.id)).toEqual({ until: chain[1_501].created_at, missingId: chain[1_500].id })
  })
})

describe('the one case read from memory on purpose', () => {
  it('a tag value rewritten in place, in the same array of the same length, keeps the link read before: no code does that to a signed event', () => {
    const e = hop(5, spawn.id)
    const a = actionLink(e)
    const at = e.tags.findIndex((t) => t[0] === 'e' && t[3] === 'previous')
    e.tags[at] = ['e', 'ef'.repeat(32), '', 'previous']
    expect(actionLink(e)).toBe(a)
  })
})
