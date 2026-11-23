/**
 * bracket.test.ts - the templates of a game's events (spec §8.11, DECK-0002)
 * read back by the chain reader: each one in its role, no break, and the
 * reserved names refused before anything is signed.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { buildChain, firstBreak, positionHex, spawnTemplate } from '../../events'
import { enterVirtualTemplate, exitVirtualTemplate, gameActionTemplate, regionTag, teleportTemplate } from '../bracket'
import { TUTORIAL_ENTRY, TUTORIAL_GAME } from '../tutorialGame'

const sk = generateSecretKey()
const pk = getPublicKey(sk)

describe('a bracket from the templates', () => {
  it('spawn, enter, teleport, exit: valid, held at the spawn, the teleport a game position', () => {
    const spawn = finalizeEvent(spawnTemplate(pk, 100), sk)
    const links = (prev: string, t: number) => ({ createdAt: t, genesisId: spawn.id, previousId: prev })
    const enter = finalizeEvent(enterVirtualTemplate({ ...links(spawn.id, 101), coordHex: pk, game: TUTORIAL_GAME }), sk)
    const to = positionHex(TUTORIAL_ENTRY, 1)
    const tp = finalizeEvent(teleportTemplate({ ...links(enter.id, 102), toHex: to }), sk)
    const exit = finalizeEvent(exitVirtualTemplate({ ...links(tp.id, 103), entryId: enter.id, coordHex: pk, gameHex: to }), sk)
    const chain = buildChain([spawn, enter, tp, exit])
    expect(chain.map((a) => a.role)).toEqual(['base', 'enter', 'virtual', 'exit'])
    expect(firstBreak(chain)).toBeNull()
    expect(chain[1].game).toEqual({ pubkey: TUTORIAL_GAME.pubkey, relayHint: '' })
    expect(chain[1].region?.height).toBe(6)
    expect(chain[2].declared?.coordHex).toBe(to)
    expect(chain.every((a) => a.coordHex === pk)).toBe(true)
  })

  it('refuses a reserved name, an unaligned region and a malformed coordinate', () => {
    const l = { createdAt: 1, genesisId: 'a'.repeat(64), previousId: 'b'.repeat(64) }
    for (const name of ['hop', 'sidestep', 'enter-hyperspace', 'hyperjump', 'enter-virtual', 'spawn', 'exit-virtual', '']) {
      expect(() => gameActionTemplate(name, l, [])).toThrow()
    }
    expect(() => regionTag({ region: { ...TUTORIAL_GAME.region, base: { ...TUTORIAL_GAME.region.base, x: TUTORIAL_GAME.region.base.x + 1n } } })).toThrow()
    expect(() => teleportTemplate({ ...l, toHex: 'nope' })).toThrow()
    expect(() => enterVirtualTemplate({ ...l, coordHex: 'A'.repeat(64), game: TUTORIAL_GAME })).toThrow()
  })
})
