/**
 * forkWording.test.ts - a forked chain is told as what it is: dead, with
 * the identity at its spawn coordinate, the rule said once (review of #236,
 * item 8).
 *
 * What would go wrong silently: the notice's title, its chip and every
 * refused move saying "frozen at your last valid position" when a fork
 * stands at the spawn coordinate, and the notice stating the fork twice.
 */

import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) }, clear: () => { mem.clear() },
  }
})
vi.mock('../workers', async (orig) => ({ ...(await orig() as object), postProof: () => {}, cancelProof: () => {} }))

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { FORK_RULE_WORDS, buildChain, firstBreak, positionHex, spawnTemplate, type NostrEvent } from '../events'
import { brokenWords } from '../chainBreak'
import { BROKEN_CHAIN_MESSAGE, FORKED_CHAIN_MESSAGE, whyNoMove } from '../../store/useCyberspace'
import { hopEvent, nextId } from './chainFixtures'

const pk = getPublicKey(generateSecretKey())
const home = coordToXyz(hexToCoord(pk))
const at = (dx: bigint) => ({ x: home.x + dx, y: home.y, z: home.z })
const spawn: NostrEvent = { ...spawnTemplate(pk, 1_000), id: nextId(), pubkey: pk, sig: '0'.repeat(128) }
const hop1 = hopEvent({ pubkey: pk, createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(1n), plane: home.plane })
const a = hopEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: positionHex(at(1n), home.plane), to: at(2n), plane: home.plane })
const b = hopEvent({ pubkey: pk, createdAt: 1_021, genesisId: spawn.id, previousId: hop1.id, c: positionHex(at(1n), home.plane), to: at(3n), plane: home.plane })

describe('a forked chain, in words', () => {
  const forked = buildChain([spawn, hop1, a, b])
  const broken = firstBreak(forked)!

  it('the notice and its chip say the spawn coordinate, never the last valid position', () => {
    const w = brokenWords(broken)
    expect(w.title).toBe('Your chain forked: you stand at your spawn coordinate')
    expect(w.chip).toBe('CHAIN FORKED')
    expect(w.chipMeta).toMatch(/^AT YOUR SPAWN COORDINATE/)
    for (const text of Object.values(w)) expect(text).not.toMatch(/last valid/i)
  })

  it('the respawn warning puts the End of Chain entry at the spawn coordinate, not at a last valid position (verification of #236)', () => {
    expect(brokenWords(broken).respawnPlace).toBe('at your spawn coordinate, where the forked chain stands')
  })

  it('"Why" is the rule, once; the branches are named elsewhere, not repeated in it', () => {
    const w = brokenWords(broken)
    expect(w.why).toBe(FORK_RULE_WORDS)
    expect(w.why).not.toMatch(/both name|all name/)
    expect(broken.action.breaks!.split(FORK_RULE_WORDS)).toHaveLength(2)
  })

  it('a move refused on a forked chain says it forked and stands at the spawn coordinate', () => {
    expect(whyNoMove(forked)).toBe(FORKED_CHAIN_MESSAGE)
    expect(FORKED_CHAIN_MESSAGE).toMatch(/spawn coordinate/)
    expect(FORKED_CHAIN_MESSAGE).not.toMatch(/last valid/i)
  })

  it('any other break keeps its own words', () => {
    const wrong: NostrEvent = { ...a, tags: a.tags.map((t) => (t[0] === 'S' ? ['S', '9-9-9'] : t)) }
    const chain = buildChain([spawn, hop1, wrong])
    expect(whyNoMove(chain)).toBe(BROKEN_CHAIN_MESSAGE)
    expect(brokenWords(firstBreak(chain)!).title).toBe('Frozen at your last valid position')
    expect(brokenWords(firstBreak(chain)!).respawnPlace).toBe('at your last valid position')
  })
})
