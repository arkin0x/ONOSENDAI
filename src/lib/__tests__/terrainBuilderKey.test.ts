/**
 * terrainBuilderKey.test.ts - the builder key (lib/terrain/builderKey.ts,
 * builderTags.ts), DECK-0009 §4: the tag owed until an action carrying it
 * is on the relay; never on a mined template, never on anything but a
 * movement action, never twice; a fixed template left alone; retirement (with
 * its R tag) owed on the next action with a new key named beside it. Key
 * validity itself is the DECK's vectors (terrainLayer.test.ts).
 *
 * Every key is a throwaway made here.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import {
  builderRecord, ensureBuilderKey, forgetBuilderRecords, namedKey, noteFound, owedTags, retireCurrent, waitingIds,
} from '../terrain/builderKey'
import { fixTags, noteActionSigned, owedBuilderTags, withBuilderTags } from '../terrain/builderTags'

beforeEach(() => forgetBuilderRecords())

const move = (tags: string[][] = []) => ({ kind: 3333, created_at: 1_790_000_000, tags: [['A', 'hop'], ...tags], content: '' })

describe('the builder tag rides on the next movement action', () => {
  it('is owed from the first TERRAIN use until an action carrying it is found on the relay', () => {
    const me = getPublicKey(generateSecretKey())
    expect(owedBuilderTags(me)).toEqual([])
    const rec = ensureBuilderKey(me)
    const pub = rec.current!
    expect(pub).toMatch(/^[0-9a-f]{64}$/)
    expect(pub).not.toBe(me)
    expect(owedBuilderTags(me)).toEqual([['builder', pub]])
    // Added to a move, once; a move that has it is left as the same object.
    const t = withBuilderTags(move(), me)
    expect(t.tags).toContainEqual(['builder', pub])
    expect(withBuilderTags(t, me)).toBe(t)
    // Never on another kind, a mined template, or another identity's move.
    const bag = { ...move(), kind: 33330 }
    expect(withBuilderTags(bag, me)).toBe(bag)
    const mined = move([['nonce', '1', '8']])
    expect(withBuilderTags(mined, me)).toBe(mined)
    const other = move()
    expect(withBuilderTags(other, getPublicKey(generateSecretKey()))).toBe(other)
    // Signed: remembered as waiting; still owed until the relay holds one.
    noteActionSigned({ id: 'a'.repeat(64), pubkey: me, kind: 3333, tags: t.tags })
    expect(waitingIds(me)).toEqual(['a'.repeat(64)])
    expect(owedBuilderTags(me)).toEqual([['builder', pub]])
    expect(namedKey(me)).toBeNull()
    noteFound(me, new Set(['a'.repeat(64)]))
    expect(namedKey(me)?.named).toBe('a'.repeat(64))
    expect(owedBuilderTags(me)).toEqual([])
    expect(withBuilderTags(other, me)).toBe(other)
  })

  it('a fixed template is fixed', () => {
    const t = fixTags(move())
    expect(t.tags).toHaveLength(1)
  })

  it('retiring: builder-retire for the old key and builder for a new one, on the same next action', () => {
    const me = getPublicKey(generateSecretKey())
    const old = ensureBuilderKey(me).current!
    noteActionSigned({ id: 'b'.repeat(64), pubkey: me, kind: 3333, tags: [['builder', old]] })
    noteFound(me, new Set(['b'.repeat(64)]))
    retireCurrent(me)
    const rec = builderRecord(me)!
    const fresh = rec.current!
    expect(fresh).not.toBe(old)
    // With the R tag beside the retirement, so relays index it (§4.3).
    expect(owedTags(rec)).toEqual([['builder', fresh], ['builder-retire', old], ['R', old]])
    expect(namedKey(me)).toBeNull()
    const t = withBuilderTags(move(), me)
    noteActionSigned({ id: 'c'.repeat(64), pubkey: me, kind: 3333, tags: t.tags })
    noteFound(me, new Set(['c'.repeat(64)]))
    expect(owedTags(builderRecord(me))).toEqual([])
    expect(namedKey(me)?.pub).toBe(fresh)
  })
})
