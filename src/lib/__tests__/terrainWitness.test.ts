/**
 * terrainWitness.test.ts - asking the witness (lib/terrain/witness.ts,
 * DECK-0009 §7.4) against a mock: a signed answer is read and kept; one is
 * refused on a bad signature, a body that is not ASCII, another key, results
 * that are not the request, or settles that are not the layer's settle tags;
 * the key comes from NIP-11 `self` and stays pinned; 400 is not retried soon,
 * 429, a 5xx or no answer teach nothing (every settle unwitnessed); two
 * answers that disagree stop the asking. Also rule 4 of §4.4 on what the
 * witness said (store/terrainShare.ts witnessAllows), the R tag (§4.3), and
 * a new key's start from the old keys' layers and the emptied layer (§5.7).
 *
 * Throwaway keys only; no network.
 */

import { describe, expect, it } from 'vitest'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { WITNESS_INFO_URL, WitnessBook, readWitnessAnswer, type FetchText } from '../terrain/witness'
import { retirementsOf } from '../terrain/reachChain'
import { combineLayers, emptiedPlaintext, nextPlaintext } from '../terrain/layerWriter'
import { decodePlane, expandRuns } from '../terrain/blockLayer'
import { generate } from '../terrain/generate'
import { idx, CELLS } from '../terrain/coords'
import { witnessAllows } from '../../store/terrainShare'
import { ensureBuilderKey, forgetBuilderRecords, owedTags, builderRecord, retireCurrent } from '../terrain/builderKey'

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const sk = generateSecretKey()
const KEY = getPublicKey(sk)
const id = (n: number): string => n.toString(16).padStart(64, '0')

function answer(body: unknown, signer: Uint8Array = sk, raw?: string): string {
  const text = raw ?? JSON.stringify(body)
  const sig = toHex(schnorr.sign(sha256(new TextEncoder().encode(text)), signer))
  return JSON.stringify({ body: text, sig })
}
const body = (results: unknown[], witness = KEY) => ({ v: 1, witness, tip: 925_100, results })

describe('reading an answer (§7.4)', () => {
  const layer = id(1), move = id(2)
  const tags = new Map([[layer, [id(10), id(11)]]])
  const good = body([{ id: layer, height: 925_020, settles: [[id(10), 925_020], [id(11), 925_030]] }, { id: move, height: null, settles: [] }])

  it('a signed answer is read', () => {
    const r = readWitnessAnswer(answer(good), KEY, [layer, move], tags)!
    expect(r.get(layer)?.height).toBe(925_020)
    expect(r.get(layer)?.settles.get(id(11))).toBe(925_030)
    expect(r.has(move)).toBe(false)
  })

  it('refused: a bad signature, another key, a body not ASCII, results not the request, settles not the tags', () => {
    expect(readWitnessAnswer(answer(good, generateSecretKey()), KEY, [layer, move], tags)).toBeNull()
    const other = getPublicKey(generateSecretKey())
    expect(readWitnessAnswer(answer(body(good.results, other)), KEY, [layer, move], tags)).toBeNull()
    expect(readWitnessAnswer(answer(null, sk, JSON.stringify(good).replace('}', ',"note":"é"}')), KEY, [layer, move], tags)).toBeNull()
    expect(readWitnessAnswer(answer(good), KEY, [move, layer], tags)).toBeNull()
    expect(readWitnessAnswer(answer(body([good.results[0]])), KEY, [layer, move], tags)).toBeNull()
    const swapped = body([{ id: layer, height: 925_020, settles: [[id(11), 925_030], [id(10), 925_020]] }, good.results[1]])
    expect(readWitnessAnswer(answer(swapped), KEY, [layer, move], tags)).toBeNull()
    // The body's own JSON may escape characters: the signature covers its text as decoded from the outer object.
    const escaped = JSON.stringify(good).replace('"v"', '"\\u0076"')
    expect(readWitnessAnswer(answer(null, sk, escaped), KEY, [layer, move], tags)).not.toBeNull()
  })
})

/** A mock witness: NIP-11 with `self`, and answers per request. */
function mockFetch(reply: (url: string) => { status: number; text: string } | null): { fetch: FetchText; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    fetch: async (url) => {
      calls.push(url)
      if (url === WITNESS_INFO_URL) return { status: 200, text: JSON.stringify({ name: 'relay', pubkey: id(99), self: KEY }) }
      return reply(url)
    },
  }
}

describe('the witness book', () => {
  const layer = id(1)
  const asks = [{ id: layer, settles: [id(10)] }]
  const recorded = answer(body([{ id: layer, height: 925_020, settles: [[id(10), 925_021]] }]))

  it('learns, keeps non-null answers, and pins the NIP-11 self key', async () => {
    let pinned: string | null = null
    const m = mockFetch(() => ({ status: 200, text: recorded }))
    const book = new WitnessBook(m.fetch, () => 1, { get: async () => pinned, set: (k) => { pinned = k } })
    await book.learn(asks)
    expect(pinned).toBe(KEY)
    expect(book.settle(layer, id(10))).toBe(925_021)
    expect(book.status(layer)).toEqual({ recorded: true, height: 925_020 })
    await book.learn(asks)
    expect(m.calls.filter((u) => u !== WITNESS_INFO_URL)).toHaveLength(1)
    // Another visit reads the pinned key and never asks NIP-11 again.
    const m2 = mockFetch(() => ({ status: 200, text: recorded }))
    const again = new WitnessBook(m2.fetch, () => 1, { get: async () => pinned, set: () => undefined })
    await again.learn(asks)
    expect(m2.calls).not.toContain(WITNESS_INFO_URL)
  })

  it('unreachable (no answer, 429, 5xx) or unverified: nothing learned, every settle unwitnessed', async () => {
    for (const reply of [null, { status: 429, text: '' }, { status: 503, text: '' }, { status: 200, text: 'not json' }]) {
      const book = new WitnessBook(mockFetch(() => reply).fetch, () => 1)
      await book.learn(asks)
      expect(book.settle(layer, id(10))).toBeNull()
      expect(book.status(layer)).toBeNull()
    }
  })

  it('400 is not retried soon; a null is asked again after a while', async () => {
    let t = 1
    const m = mockFetch(() => ({ status: 400, text: '' }))
    const book = new WitnessBook(m.fetch, () => t)
    await book.learn(asks)
    await book.learn(asks)
    expect(m.calls.filter((u) => u !== WITNESS_INFO_URL)).toHaveLength(1)
    t += 61_000
    await book.learn(asks)
    expect(m.calls.filter((u) => u !== WITNESS_INFO_URL)).toHaveLength(2)
  })

  it('two signed answers that disagree: the witness lied, and is asked nothing more', async () => {
    const other = id(3)
    let n = 0
    const m = mockFetch((url) => {
      n++
      const which = url.includes(other) ? other : layer
      return { status: 200, text: answer(body([{ id: which, height: 925_020, settles: [[id(10), n === 1 ? 925_021 : 925_090]] }])) }
    })
    const book = new WitnessBook(m.fetch, () => 1)
    await book.learn(asks)
    await book.learn([{ id: other, settles: [id(10)] }])
    expect(book.lied).toBe(true)
    expect(book.settle(layer, id(10))).toBeNull()
  })
})

describe('rule 4 of §4.4 on the witness\'s answers', () => {
  const W = (m: Record<string, { recorded: true; height: number } | { recorded: false } | null>) => ({ witness: { learn: async () => undefined, settle: () => null, status: (e: string) => m[e] ?? null } })
  const ret = { all: false, ids: [id(50)] }

  it('valid only when the witness recorded the layer below the retirement', () => {
    expect(witnessAllows(W({ [id(1)]: { recorded: true, height: 99 }, [id(50)]: { recorded: true, height: 100 } }), id(1), ret)).toBe(true)
    expect(witnessAllows(W({ [id(1)]: { recorded: true, height: 100 }, [id(50)]: { recorded: true, height: 100 } }), id(1), ret)).toBe(false)
    expect(witnessAllows(W({ [id(1)]: { recorded: false }, [id(50)]: { recorded: true, height: 100 } }), id(1), ret)).toBe(false)
    // No retirement recorded: holds. No answer: the rule cannot run.
    expect(witnessAllows(W({ [id(1)]: { recorded: true, height: 200 }, [id(50)]: { recorded: false } }), id(1), ret)).toBe(true)
    expect(witnessAllows(W({}), id(1), ret)).toBe(true)
  })
})

describe('the R tag (§4.3)', () => {
  it('rides beside every builder-retire, and retirements are read from what #R brings back', () => {
    forgetBuilderRecords()
    const me = getPublicKey(generateSecretKey())
    const k = ensureBuilderKey(me).current!
    retireCurrent(me, true)
    expect(owedTags(builderRecord(me))).toContainEqual(['R', k])
    expect(owedTags(builderRecord(me))).toContainEqual(['builder-retire', k, 'all'])
    const ev = (n: number, tags: string[][]) => ({ id: id(n), pubkey: me, kind: 3333, created_at: 1, content: '', sig: '', tags })
    const r = retirementsOf([ev(1, [['builder-retire', k], ['R', k]]), ev(2, [['R', k]]), ev(3, [['builder-retire', k, 'all'], ['R', k]])] as never, me, k)
    expect(r).toEqual({ all: true, ids: [id(1), id(3)] })
  })
})

describe('a new key at a chunk (§5.7)', () => {
  const ground = generate({ x: 0n, y: 0n, z: 0n, plane: 0 }).blocks
  const H = '00000000000000000001a7d1f3a2d3c4b5a69788796a5b4c3d2e1f0a1b2c3d4e'
  const a = idx(1, 31, 1), b = idx(2, 31, 1)
  const layerWith = (cells: Record<number, number>, height: number) => {
    const v = ground.slice()
    for (const [c, x] of Object.entries(cells)) v[Number(c)] = x
    return nextPlaintext({ prev: null, plane: 0, values: v, ground, block: { height, hash: H } })!
  }
  const times = (p: ReturnType<typeof layerWith>) => p.settles.map((s) => ({ height: s[0], witness: null, work: 0 }))

  it('starts from the old layers: every placement and its settles unchanged; where two place a cell, the later', () => {
    const one = layerWith({ [a]: 196, [b]: 196 }, 100)
    const two = layerWith({ [b]: 197 }, 200)
    const c = combineLayers([{ pubkey: id(7), plaintext: one, times: times(one) }, { pubkey: id(8), plaintext: two, times: times(two) }], () => ground)!
    const d = decodePlane(c.planes[0], ground, c.settles.length)
    if (!d || d === 'aside') throw new Error('plane')
    expect(d.values[a]).toBe(196)
    expect(d.values[b]).toBe(197)
    expect(c.settles).toContainEqual(one.settles[0])
    expect(c.settles).toContainEqual(two.settles[0])
    expect(c.settles[d.t0[d.placements.indexOf(a)]]).toEqual(one.settles[0])
  })

  it('an emptied old layer keeps survey and ground, no placements, and one fresh settle that claims nothing', () => {
    const one = layerWith({ [a]: 196 }, 100)
    const e = emptiedPlaintext(one, { height: 300, hash: H }, '0'.repeat(16))
    expect(e.planes.map((p) => [p.plane, p.survey, p.ground, p.pal, p.cells])).toEqual([[0, true, 2, [null], [0, -32767]]])
    expect(e.settles).toHaveLength(1)
    expect(e.settles[0][0]).toBe(300)
    expect(expandRuns(e.settles[0][3][0], CELLS, 2)!.every((x) => x === 0)).toBe(true)
  })
})
