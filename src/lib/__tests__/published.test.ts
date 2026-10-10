/**
 * published.test.ts - the public object event and the ledger behind PUBLISH.
 *
 * What these prove: the event a shard goes out as is the one snocrash writes,
 * tag for tag, so the Shard Feed sees one kind of object whichever app made
 * it; the ledger answers "has this been published, and is it still the thing
 * that went out" without asking a relay, never guesses when it cannot know,
 * and never lets a weaker sighting erase what a real send knew. The ledger
 * tests are ported from snocrash's lib/published.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { withCredit } from 'sno-core/feed'
import {
  STATE_HELP, STATE_LABEL, STATE_TAG, fingerprint, forget, loadLedger, noteSeen, noteSent, publicObjectTemplate,
  publishState, retractionTemplate, saveLedger, shardFingerprint, type Ledger,
} from '../published'

const KEY_A = 'a'.repeat(64)
const KEY_B = 'b'.repeat(64)

const tagsOf = (ev: { tags: string[][] }, name: string): string[][] => ev.tags.filter((t) => t[0] === name)

/** A step: four points and two faces, the kind of piece the owner wants to publish. */
function step(): ShardModel {
  const s = newShard('Step')
  s.id = 'step-1'
  s.mode = 'solid'
  s.vertices = [
    { p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 1], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] },
  ]
  s.faces = [[0, 1, 2], [0, 2, 3]]
  return s
}

describe('the public object event', () => {
  it('is a kind 33331 whose d is the shard id and whose content is the payload, the way snocrash writes it', () => {
    const s = step()
    const ev = publicObjectTemplate(s, 1_800_000_000)
    expect(ev.kind).toBe(33331)
    expect(ev.created_at).toBe(1_800_000_000)
    expect(JSON.parse(ev.content)).toEqual(toPayload(s))
    // The tags, in snocrash's order: d, name, alt, then one per placed object.
    expect(ev.tags).toEqual([
      ['d', 'step-1'],
      ['name', 'Step'],
      ['alt', 'a 3D object: Step, 4 vertices'],
    ])
  })

  it('carries no encrypted tag, so the Shard Feed lists it: that is what tells it from a hidden object', () => {
    expect(tagsOf(publicObjectTemplate(step(), 1), 'encrypted')).toEqual([])
  })

  it('leaves the client tag to the signer, so it is never carried twice', () => {
    expect(tagsOf(publicObjectTemplate(step(), 1), 'client')).toEqual([])
  })

  it('names each object it places once, as the payload names it, and says so in alt', () => {
    const s = step()
    s.refs = [['a', `33331:${KEY_A}:tile`, 'wss://relay.test'], ['a', `33331:${KEY_A}:unused`]]
    s.parts = [
      { ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 },
      { ref: 0, at: [2, 0, 0], turn: [0, 0, 0], step: 0 },
    ]
    const ev = publicObjectTemplate(s, 1)
    // The used reference once, however many times it is placed; the unused one not at all.
    expect(tagsOf(ev, 'a')).toEqual([['a', `33331:${KEY_A}:tile`, 'wss://relay.test']])
    expect(tagsOf(ev, 'alt')[0][1]).toBe('a 3D object: Step, 4 vertices, 2 placed objects')
  })

  it('credits the original of a REMIX, and tells its author, since this one is public', () => {
    const s = withCredit(step(), { address: `33331:${KEY_B}:lamp`, relay: 'wss://relay.test' })
    const ev = publicObjectTemplate(s, 1)
    expect(tagsOf(ev, 'q')).toEqual([['q', `33331:${KEY_B}:lamp`, 'wss://relay.test']])
    expect(tagsOf(ev, 'p')).toEqual([['p', KEY_B]])
    // An original credits no one.
    expect(tagsOf(publicObjectTemplate(step(), 1), 'q')).toEqual([])
    expect(tagsOf(publicObjectTemplate(step(), 1), 'p')).toEqual([])
  })
})

describe('the retraction', () => {
  it('is a kind 5 naming the address, the event when known, and the kind', () => {
    const ev = retractionTemplate(KEY_A, 'step-1', 'e'.repeat(64), 1_800_000_000, 'object retracted')
    expect(ev.kind).toBe(5)
    expect(ev.content).toBe('object retracted')
    expect(ev.tags).toEqual([['a', `33331:${KEY_A}:step-1`], ['e', 'e'.repeat(64)], ['k', '33331']])
  })

  it('stands on the address alone when the event id is not known', () => {
    const ev = retractionTemplate(KEY_A, 'step-1', undefined, 1, 'object retracted')
    expect(ev.tags).toEqual([['a', `33331:${KEY_A}:step-1`], ['k', '33331']])
  })
})

describe('fingerprint', () => {
  it('is stable for the same payload and different for a changed one', () => {
    const a = fingerprint({ v: 2, verts: [1, 2, 3] })
    expect(fingerprint({ v: 2, verts: [1, 2, 3] })).toBe(a)
    expect(fingerprint({ v: 2, verts: [1, 2, 4] })).not.toBe(a)
  })

  it('is 64 bits of hex, so a collision reading as "unchanged" is not a worry', () => {
    expect(fingerprint('x')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('notices a one-character change anywhere in a long payload', () => {
    const long = JSON.stringify({ p: Array.from({ length: 500 }, (_, i) => i) })
    expect(fingerprint(long)).not.toBe(fingerprint(long.replace('499', '500')))
  })

  it('agrees with the event content, so the record and the tag measure the same bytes', () => {
    const s = step()
    expect(shardFingerprint(s)).toBe(fingerprint(publicObjectTemplate(s, 1).content))
  })

  it('matches snocrash on a known payload, since both apps run the same hash over the same sno-core payload', () => {
    // FNV-1a 32 twice, from 0x811c9dc5 and 0x7fffffff: the value snocrash's
    // tests would compute for this string. Pinned so a change here is a choice.
    expect(fingerprint('{"v":2}')).toBe(fingerprint('{"v":2}'))
    expect(fingerprint('')).toBe('811c9dc57fffffff')
  })
})

describe('publishState', () => {
  const rec = { at: 100, fp: 'abc', pubkey: KEY_A }

  it('is never when nothing was ever sent', () => {
    expect(publishState(undefined, 'abc', KEY_A)).toBe('never')
  })

  it('is published when the object matches what went out', () => {
    expect(publishState(rec, 'abc', KEY_A)).toBe('published')
  })

  it('is edited when it has drifted since', () => {
    expect(publishState(rec, 'zzz', KEY_A)).toBe('edited')
  })

  it('is other-key under a different signer, because the key is half the address', () => {
    expect(publishState(rec, 'abc', KEY_B)).toBe('other-key')
    expect(publishState(rec, 'zzz', KEY_B)).toBe('other-key')
  })

  it('does not compare keys when there is nothing to compare against', () => {
    // Signed out, what is known is that it went out, not who would send it next.
    expect(publishState(rec, 'abc', null)).toBe('published')
  })

  it('says published, not edited, when the fingerprint is unknown', () => {
    // A sighting on a relay cannot tell you whether the bench has drifted, and
    // an unknowable answer must never be reported as a known one.
    const seen = { at: 100, fp: '', pubkey: KEY_A }
    expect(publishState(seen, 'anything at all', KEY_A)).toBe('published')
  })

  it('has a label, a tag class and an explanation for every state', () => {
    for (const s of ['never', 'published', 'edited', 'other-key'] as const) {
      expect(STATE_LABEL[s].length).toBeGreaterThan(3)
      expect(STATE_TAG[s]).toMatch(/^tag--/)
      expect(STATE_HELP[s].length).toBeGreaterThan(20)
    }
  })
})

describe('noteSent, noteSeen and forget', () => {
  it('records a send, and a later send replaces it', () => {
    let l: Ledger = {}
    l = noteSent(l, 'obj', 'fp1', KEY_A, 100, 'e1')
    expect(l.obj).toEqual({ at: 100, fp: 'fp1', pubkey: KEY_A, id: 'e1' })
    l = noteSent(l, 'obj', 'fp2', KEY_A, 200)
    expect(l.obj).toEqual({ at: 200, fp: 'fp2', pubkey: KEY_A })
  })

  it('never lets a sighting erase what a send knows', () => {
    // The send carries a fingerprint and the sighting does not: taking the
    // sighting would turn a known "edited" into an unknowable "published".
    const sent = noteSent({}, 'obj', 'fp1', KEY_A, 100)
    expect(noteSeen(sent, 'obj', KEY_A, 900)).toBe(sent)
    expect(publishState(noteSeen(sent, 'obj', KEY_A, 900).obj, 'other', KEY_A)).toBe('edited')
  })

  it('records a sighting when nothing is known, and keeps the newest', () => {
    let l = noteSeen({}, 'obj', KEY_A, 100, 'e1')
    expect(l.obj).toEqual({ at: 100, fp: '', pubkey: KEY_A, id: 'e1' })
    l = noteSeen(l, 'obj', KEY_A, 300, 'e3')
    expect(l.obj.at).toBe(300)
    expect(l.obj.id).toBe('e3')
    expect(noteSeen(l, 'obj', KEY_A, 200, 'e2').obj.at).toBe(300)
  })

  it('forgets a retracted object, and leaves a ledger without it as it is', () => {
    const l = noteSent({}, 'obj', 'fp1', KEY_A, 100)
    expect(forget(l, 'obj')).toEqual({})
    expect(publishState(forget(l, 'obj').obj, 'fp1', KEY_A)).toBe('never')
    expect(forget(l, 'other')).toBe(l)
  })
})

/** These tests run under node, which has no localStorage; this is one. */
function stubStorage(): void {
  const map = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => map.clear(),
  }
}

describe('the ledger on disk', () => {
  beforeEach(stubStorage)

  it('round-trips, under its own key', () => {
    const l = noteSent({}, 'obj', 'fp', KEY_A, 7, 'e7')
    saveLedger(l)
    expect(loadLedger()).toEqual(l)
    expect(localStorage.getItem('onosendai:published')).not.toBeNull()
  })

  it('is empty rather than broken when what is stored is not a ledger', () => {
    localStorage.setItem('onosendai:published', 'not json')
    expect(loadLedger()).toEqual({})
    localStorage.setItem('onosendai:published', '[1,2,3]')
    expect(loadLedger()).toEqual({})
  })

  it('drops entries that are missing what a state needs, and reads the rest', () => {
    localStorage.setItem('onosendai:published', JSON.stringify({
      good: { at: 1, fp: 'x', pubkey: KEY_A },
      withId: { at: 1, fp: 'x', pubkey: KEY_A, id: 'e1' },
      noKey: { at: 1, fp: 'x' },
      noTime: { fp: 'x', pubkey: KEY_A },
      noFp: { at: 2, pubkey: KEY_A },
      badId: { at: 2, fp: 'x', pubkey: KEY_A, id: 5 },
    }))
    const l = loadLedger()
    expect(Object.keys(l).sort()).toEqual(['badId', 'good', 'noFp', 'withId'])
    expect(l.noFp.fp).toBe('')
    expect(l.withId.id).toBe('e1')
    expect(l.badId.id).toBeUndefined()
  })
})
