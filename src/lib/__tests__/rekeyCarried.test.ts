/**
 * rekeyCarried.test.ts: an object taken out of a chest into your workshop
 * carries its parts under your key (DECK-0004 §3.4 "Taking an object that
 * carries its parts", spec #82; chest and door design, R15). Each carried
 * object keyed under the event it was read from gets an address of yours
 * with a fresh `d`, every `refs` entry naming it is rewritten, links stay as
 * they are, and the workshop keeps the table (signedTableOnly).
 */
import { describe, expect, it } from 'vitest'
import { newShard, type ShardModel } from 'sno-core/shards'
import { rekeyCarried, signedTableOnly } from '../carried'

const HIDER = 'a'.repeat(64)
const ME = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)

function carrying(): ShardModel {
  const piece = `33331:${HIDER}:piece`
  const inner = `33331:${HIDER}:inner`
  const link = `33331:${OTHER}:public`
  return {
    ...newShard('Statue'),
    author: HIDER,
    refs: [['a', piece], ['a', link, 'wss://r.test']],
    parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }, { ref: 1, at: [120, 0, 0], turn: [0, 0, 0], step: 0 }],
    objects: { [piece]: { v: 2, name: 'Piece', refs: [['a', inner]] }, [inner]: { v: 2, name: 'Inner' } },
  }
}

describe('carried parts re-keyed to you on TAKE (R15)', () => {
  it('gives each carried object an address of yours and rewrites every reference to it, nested ones too', () => {
    const out = rekeyCarried(carrying(), ME)
    expect(out.author).toBe(ME)
    const keys = Object.keys(out.objects!)
    expect(keys).toHaveLength(2)
    for (const k of keys) expect(k.startsWith(`33331:${ME}:`)).toBe(true)
    expect(keys.some((k) => k.endsWith(':piece') || k.endsWith(':inner'))).toBe(false)
    const pieceKey = out.refs![0][1]
    expect(keys).toContain(pieceKey)
    const innerRef = (out.objects![pieceKey] as { refs: string[][] }).refs[0][1]
    expect(keys).toContain(innerRef)
  })

  it('leaves a link to someone’s public object as it is', () => {
    expect(rekeyCarried(carrying(), ME).refs![1]).toEqual(['a', `33331:${OTHER}:public`, 'wss://r.test'])
  })

  it('the workshop keeps the re-keyed table; without the re-key it would drop it', () => {
    expect(Object.keys(signedTableOnly(rekeyCarried(carrying(), ME), ME).objects ?? {})).toHaveLength(2)
    expect(signedTableOnly(carrying(), ME).objects).toBeUndefined()
  })

  it('changes nothing for a model carrying nothing of its author’s, or with no one signed in', () => {
    const plain = newShard('Plain')
    expect(rekeyCarried(plain, ME)).toBe(plain)
    const m = carrying()
    expect(rekeyCarried(m, null)).toBe(m)
  })
})
