import { describe, expect, it } from 'vitest'
import { generateSecretKey } from 'nostr-tools/pure'
import { verifyEvent } from 'nostr-tools'
// The store first: signers -> relay -> useCyberspace -> signers is a cycle, and
// entering it at signers leaves the store half-built.
import '../../store/useCyberspace'
import { CLIENT_TAG, attributed } from '../client'
import { localSigner } from '../signers'
import { avatarTemplate } from '../avatar'

const template = (kind: number, tags: string[][] = []) => ({ kind, created_at: 1_700_000_000, tags, content: '' })

describe('attributed', () => {
  it('adds the client tag to an event that has none', () => {
    expect(attributed(template(3333, [['A', 'hop']])).tags).toEqual([['A', 'hop'], CLIENT_TAG])
  })

  it('leaves a template that already names a client alone, so work mined over its tags holds', () => {
    const t = template(11333, [['client', 'ONOSENDAI'], ['nonce', '42', '20']])
    expect(attributed(t)).toBe(t)
  })

  it('never attributes an auth event', () => {
    for (const kind of [22242, 24242, 27235]) expect(attributed(template(kind)).tags).toEqual([])
  })

  it('does not change the template it is given', () => {
    const t = template(1)
    attributed(t)
    expect(t.tags).toEqual([])
  })
})

describe('signing', () => {
  it('a local signer signs the attributed event, and its id and signature verify', async () => {
    const signed = await localSigner(generateSecretKey()).signEvent(template(3333, [['A', 'spawn']]))
    expect(signed.tags).toContainEqual(CLIENT_TAG)
    expect(verifyEvent(signed as Parameters<typeof verifyEvent>[0])).toBe(true)
  })

  it('an avatar carries the tag in its template, before any work is mined over it', () => {
    expect(avatarTemplate(null, 1).tags).toEqual([CLIENT_TAG])
  })
})
