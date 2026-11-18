/**
 * sealedLooks.test.ts: a chest's look carried as a SEALED LOOK (DECK-0004
 * §3.6, "A look sealed as its own event", spec PR #115). Opening a chest without
 * its model going blank is chestOpenNoBlank.test.ts and chestOpenMount.test.tsx.
 *
 * Written: a look up to 16,384 bytes stays in its tag; a larger one becomes its
 * own kind 33331 hidden object sealed with the bag's key, and the tag a wrapper
 * of a few hundred bytes, so the chest (and its bag) grows by the reference
 * alone; over the size limit of one event it is refused in words; a moved chest's
 * sealed look is sealed again under the new bag's key.
 *
 * Read: the chest is drawn with the default look while the object is fetched,
 * with the model once it opens, and with the default when it is missing or does
 * not open (another bag's key): exactly whoever can read the chest can draw it.
 * Built-in and inline looks read as before. The cache stays bounded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { toPayload, type ShardModel } from 'sno-core/shards'
import { BAG_SAFE_BYTES, signedBytes } from '../bagSize'
import { OBJECT_PREVIEW, chestInnerTemplate, chestItemOf, type ChestItem } from '../hidden'
import { builtInLook, builtInLookTags, drawnLook, forgetSealedLooks, lookOf, lookTagsOf, sealedLookAddress, sealedLooksKept, sealedLooksVersion, setSealedLookFetch, MAX_LOOK_BYTES } from '../looks'
import { LOOK_NOT_FETCHED, sealLookTags, sealedLookAddresses, sealedLookLimit, sealedLookPayload, type SealLooksIo } from '../sealedLooks'
import { bytesToHex, type EventTemplate, type NostrEvent } from '../events'
import { forgeKey, openWithSecret, sealEntries } from '../chests'

const sk = generateSecretKey()
const PK = getPublicKey(sk)
const sign = async (t: EventTemplate): Promise<NostrEvent> => finalizeEvent(t, sk) as NostrEvent
const bagKey = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32))
let counter = 0
const newD = (): string => (++counter).toString(16).padStart(32, '0')

/** A model whose payload is about `kb` kilobytes: points along a line, one face. */
function sized(name: string, kb: number): ShardModel {
  const vertices: ShardModel['vertices'] = []
  const base = JSON.stringify(toPayload({ id: name, name, unit: 0, extent: 8, mode: 'solid', up: false, spin: 0, updatedAt: 0, vertices: [], faces: [] })).length
  let n = 0
  while (base + n * 14 < kb * 1024) n++
  for (let i = 0; i < n; i++) vertices.push({ p: [(i % 60) - 30, Math.floor(i / 60) % 60, Math.floor(i / 3600)], c: [1, 0.5, 0] })
  return { id: name, name, unit: 0, extent: 64, mode: 'solid', up: false, spin: 0, updatedAt: 0, vertices, faces: [[0, 1, 2]] }
}
const payloadOf = (m: ShardModel): string => JSON.stringify(toPayload(m))
const bytes = (s: string): number => new TextEncoder().encode(s).length

/** A relay of signed events by address, as lib/references.ts would answer. */
function relayOf(events: NostrEvent[]): (ref: string[]) => Promise<NostrEvent | null> {
  return async (ref) => events.find((e) => `${e.kind}:${e.pubkey}:${e.tags.find((t) => t[0] === 'd')?.[1]}` === ref[1]) ?? null
}

function io(key: Uint8Array, extra: Partial<SealLooksIo> = {}): SealLooksIo & { sent: NostrEvent[] } {
  const sent: NostrEvent[] = []
  return { key, owner: PK, createdAt: 1_700_000_000, newD, sign, send: async (o) => { sent.push(o); return 'wss://relay.test' }, sent, ...extra }
}

/** The lock secret of the last chest chestWith sealed. */
let lastLockSecret = ''

/** A signed chest event wearing these look tags, sealed empty to a fresh key. */
function chestWith(look: string[][]): NostrEvent {
  const lock = forgeKey('Key')
  lastLockSecret = lock.secretHex
  const sealed = sealEntries([], lock.itemPubkey)
  const chest: ChestItem = { name: 'Hoard', lockPubkey: lock.itemPubkey, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload, look }
  return finalizeEvent(chestInnerTemplate(chest, { x: 1n, y: 2n, z: 3n }, 0, 1_700_000_000), sk) as NostrEvent
}

/** Every promise in flight settles (a fetch, a decrypt). */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => { forgetSealedLooks() })
afterEach(() => { setSealedLookFetch(null); forgetSealedLooks() })

describe('writing a sealed look', () => {
  it('a 15 KB look stays in its tag; a 40 KB look goes as its own sealed event and the chest grows only by the reference', async () => {
    const key = bagKey()
    const small = payloadOf(sized('Crate', 15))
    const large = payloadOf(sized('Hoard', 40))
    expect(bytes(small)).toBeLessThanOrEqual(MAX_LOOK_BYTES)
    expect(bytes(large)).toBeGreaterThan(40_000)

    const a = io(key)
    const inline = await sealLookTags([['look', small]], a)
    expect(inline.tags).toEqual([['look', small]])
    expect(inline.objects).toEqual([])
    expect(a.sent).toEqual([])

    const b = io(key)
    const sealed = await sealLookTags([['look', large], ['look', small, 'open']], b)
    expect(sealed.objects).toHaveLength(1)
    expect(b.sent).toEqual(sealed.objects)
    const object = sealed.objects[0]
    // A DECK-0003 §3.4 hidden object: the preview, a fresh d, nothing that says where.
    expect(object.kind).toBe(33331)
    expect(object.content).toBe(OBJECT_PREVIEW)
    expect(object.tags.map((t) => t[0]).sort()).toEqual(['alt', 'd', 'encrypted'])
    expect(object.tags.find((t) => t[0] === 'encrypted')?.[3]).toBe('cyberspace:region')
    // The tag: a wrapper of a few hundred bytes naming it, placed unturned at the origin.
    const [closed, open] = sealed.tags
    expect(bytes(closed[1])).toBeLessThan(400)
    const wrapper = JSON.parse(closed[1])
    expect(wrapper.vertices).toEqual([])
    expect(wrapper.objects).toBeUndefined()
    expect(wrapper.refs).toEqual([['a', `33331:${PK}:${object.tags.find((t) => t[0] === 'd')![1]}`, 'wss://relay.test']])
    expect(wrapper.parts).toEqual([[0, 0, 0, 0, 0, 0, 0, 0]])
    expect(wrapper.name).toBe('Hoard')
    // The open look, small, rides in its tag as it was.
    expect(open).toEqual(['look', small, 'open'])

    // The chest event (what its bag carries) grows by the wrapper, not by the 40 KB look.
    const plain = chestWith([])
    const withSmall = chestWith([['look', small]])
    const withLarge = chestWith(sealed.tags.slice(0, 1))
    expect(bytes(JSON.stringify(withLarge)) - bytes(JSON.stringify(plain))).toBeLessThan(500)
    expect(bytes(JSON.stringify(withLarge))).toBeLessThan(bytes(JSON.stringify(withSmall)))
  })

  it('the size limit is that of one event of its own (240,000 bytes as signed): a look at it seals, one byte over is refused in words', async () => {
    const limit = sealedLookLimit()
    expect(limit).toBeGreaterThan(170_000)
    expect(limit).toBeLessThan(BAG_SAFE_BYTES)
    const key = bagKey()
    const at = JSON.stringify({ pad: 'x'.repeat(limit - 10) })
    expect(bytes(at)).toBe(limit)
    const ok = await sealLookTags([['look', at]], io(key))
    // Measured as this client signs: within the limit of one event.
    const { id: _i, pubkey: _p, sig: _s, ...template } = ok.objects[0]
    void _i; void _p; void _s
    expect(signedBytes(template)).toBeLessThanOrEqual(BAG_SAFE_BYTES)
    const over = JSON.stringify({ pad: 'x'.repeat(limit - 9) })
    await expect(sealLookTags([['look', over]], io(key))).rejects.toThrow(/over the size limit: 1\d\d,\d{3} of 1\d\d,\d{3} bytes/)
  })

  it('a moved chest’s sealed look is opened with the old bag’s key and sealed again under the new one, at a new address', async () => {
    const oldKey = bagKey()
    const newKey = bagKey()
    const large = payloadOf(sized('Hoard', 40))
    const first = await sealLookTags([['look', large]], io(oldKey))
    const relay = relayOf(first.objects)
    const opener = async (address: string, keyHex: string) => {
      const { openSealedLookPayload } = await import('../sealedLooks')
      return openSealedLookPayload(address, keyHex, relay)
    }
    const moved = await sealLookTags(first.tags, io(newKey, { fromKeyHex: bytesToHex(oldKey), open: opener }))
    const [oldAddress] = sealedLookAddresses(first.tags, PK)
    const [newAddress] = sealedLookAddresses(moved.tags, PK)
    expect(newAddress).not.toBe(oldAddress)
    expect(moved.dropped).toEqual([oldAddress])
    // It opens with the new key now, to the same look.
    setSealedLookFetch(relayOf(moved.objects))
    const event = chestWith(moved.tags)
    lookOf({ type: 'chest', event, bagKeyHex: bytesToHex(newKey) })
    await settle()
    expect(lookOf({ type: 'chest', event, bagKeyHex: bytesToHex(newKey) })!.closed.vertices.length).toBe(sized('Hoard', 40).vertices.length)
    // Within its own bag it is kept as it is: nothing new is sealed.
    const same = await sealLookTags(first.tags, io(oldKey, { fromKeyHex: bytesToHex(oldKey), open: opener }))
    expect(same.objects).toEqual([])
    expect(same.tags).toEqual(first.tags)
    // One that cannot be fetched stops the move in words, rather than moving a look that would never open.
    await expect(sealLookTags(first.tags, io(newKey, { fromKeyHex: bytesToHex(oldKey), open: async () => null }))).rejects.toThrow(LOOK_NOT_FETCHED)
  })
})

describe('a FEED look of your own published object, which has a sealed look\u2019s shape', () => {
  it('moves to another bag as it is: never refused, never resealed', async () => {
    const pub = finalizeEvent({ kind: 33331, created_at: 1, content: payloadOf(sized('Statue', 1)), tags: [['d', 'statue']] }, sk) as NostrEvent
    const tags = [['look', sealedLookPayload(payloadOf(sized('Statue', 1)), `33331:${PK}:statue`)]]
    const { openSealedLookPayload } = await import('../sealedLooks')
    const moved = await sealLookTags(tags, io(bagKey(), { fromKeyHex: bytesToHex(bagKey()), open: (a, k) => openSealedLookPayload(a, k, relayOf([pub])) }))
    expect(moved.tags).toEqual(tags)
    expect(moved.objects).toEqual([])
    expect(moved.dropped).toEqual([])
  })
})

describe('reading a sealed look', () => {
  async function sealedChest(key: Uint8Array, kb = 40): Promise<{ event: NostrEvent; objects: NostrEvent[]; model: ShardModel }> {
    const model = sized('Hoard', kb)
    const { tags, objects } = await sealLookTags([['look', payloadOf(model)]], io(key))
    return { event: chestWith(tags), objects, model }
  }

  it('is drawn as the default chest while it loads, and as its model once fetched; opening never waits on it', async () => {
    const key = bagKey()
    const { event, objects, model } = await sealedChest(key)
    let answer: (e: NostrEvent | null) => void = () => undefined
    setSealedLookFetch(() => new Promise((r) => { answer = r }))
    const subject = { type: 'chest', event, bagKeyHex: bytesToHex(key) }
    const loading = lookOf(subject)!
    expect(loading).toBe(builtInLook('treasure'))
    // The chest still opens and draws while it loads: its look is the default's, open and closed.
    expect(drawnLook(loading, true)).toBe(builtInLook('treasure').open)
    expect(chestItemOf(event)).not.toBeNull()
    const v = sealedLooksVersion()
    answer(objects[0])
    await settle()
    expect(sealedLooksVersion()).toBeGreaterThan(v)
    const ready = lookOf(subject)!
    expect(ready.name).toBe('custom')
    expect(ready.closed.vertices.length).toBe(model.vertices.length)
    // Its own walls and its table count under its signer, the chest's.
    expect(ready.closed.author).toBe(PK)
    // Opened, a chest with one model keeps it (§3.6).
    expect(drawnLook(ready, true)).toBe(ready.closed)
  })

  it('a missing reference falls back to the default look, and the chest opens normally', async () => {
    const key = bagKey()
    const { event } = await sealedChest(key)
    const secret = lastLockSecret
    setSealedLookFetch(async () => null)
    const subject = { type: 'chest', event, bagKeyHex: bytesToHex(key) }
    lookOf(subject)
    await settle()
    const look = lookOf(subject)!
    expect(look).toBe(builtInLook('treasure'))
    expect(drawnLook(look, true)).not.toBeNull()
    // Its contents open with its lock regardless of its look.
    expect(openWithSecret(chestItemOf(event)!, secret)).toEqual([])
  })

  it('a missing one is asked for again after a minute, and drawn once it can be had', async () => {
    const key = bagKey()
    const { event, objects, model } = await sealedChest(key)
    let answer: NostrEvent | null = null
    setSealedLookFetch(async () => answer)
    const subject = { type: 'chest', event, bagKeyHex: bytesToHex(key) }
    const flush = async (): Promise<void> => { for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r)) }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      lookOf(subject)
      await flush()
      expect(lookOf(subject)).toBe(builtInLook('treasure'))
      answer = objects[0]
      // Within the minute it stays missing; the minute's wake-up has whoever drew it read again.
      expect(lookOf(subject)).toBe(builtInLook('treasure'))
      const v = sealedLooksVersion()
      vi.advanceTimersByTime(60_000)
      expect(sealedLooksVersion()).toBeGreaterThan(v)
      lookOf(subject)
      await flush()
      expect(lookOf(subject)!.closed.vertices.length).toBe(model.vertices.length)
    } finally {
      vi.useRealTimers()
    }
  })

  it('is readable by someone who can see the chest (its bag key) and by nobody else', async () => {
    const key = bagKey()
    const { event, objects, model } = await sealedChest(key)
    setSealedLookFetch(relayOf(objects))
    const seer = { type: 'chest', event, bagKeyHex: bytesToHex(key) }
    const stranger = { type: 'chest', event: chestWith(event.tags.filter((t) => t[0] === 'look')), bagKeyHex: bytesToHex(bagKey()) }
    lookOf(seer)
    lookOf(stranger)
    await settle()
    expect(lookOf(seer)!.closed.vertices.length).toBe(model.vertices.length)
    // Another key opens nothing: the default look, never the preview.
    expect(lookOf(stranger)).toBe(builtInLook('treasure'))
    // The object itself says nothing but the preview.
    expect(objects[0].content).toBe(OBJECT_PREVIEW)
    expect(JSON.stringify(objects[0])).not.toContain('Hoard')
  })

  it('built-in looks and old inline looks read exactly as before, with or without a bag key', () => {
    const fetched: string[][] = []
    setSealedLookFetch(async (ref) => { fetched.push(ref); return null })
    const key = bytesToHex(bagKey())
    const builtIn = chestWith(builtInLookTags('treasure', { unit: 0, turn: [0, 0, 0], constrain: 'all' }))
    const a = lookOf({ type: 'chest', event: builtIn })!
    const b = lookOf({ type: 'chest', event: chestWith(builtIn.tags.filter((t) => t[0] === 'look')), bagKeyHex: key })!
    expect(b.name).toBe(a.name)
    expect(b.closed).toBe(a.closed)
    expect(b.lid).toBeDefined()
    const inlineTags = [['look', payloadOf(sized('Crate', 4))]]
    const c = lookTagsOf(inlineTags, PK)
    const d = lookTagsOf(inlineTags, PK, key)
    expect(d.closed).toBe(c.closed)
    expect(d.pending).toBeUndefined()
    // Another author's FEED wrapper is a live placement, never fetched as a sealed look.
    const feed = JSON.stringify({ v: 2, name: 'Statue', unit: 0, mode: 'solid', vertices: [], colors: [], faces: [], refs: [['a', `33331:${'b'.repeat(64)}:statue`]], parts: [[0, 0, 0, 0, 0, 0, 0, 0]] })
    const e = lookTagsOf([['look', feed]], PK, key)
    expect(e.closed?.refs?.[0][1]).toBe(`33331:${'b'.repeat(64)}:statue`)
    expect(fetched).toEqual([])
  })

  it('a FEED look of your own public object is fetched once and stays a live placement', async () => {
    const pub = finalizeEvent({ kind: 33331, created_at: 1, content: payloadOf(sized('Statue', 1)), tags: [['d', 'statue']] }, sk) as NostrEvent
    const address = `33331:${PK}:statue`
    let asked = 0
    setSealedLookFetch(async () => { asked++; return pub })
    const tags = [['look', sealedLookPayload(payloadOf(sized('Statue', 1)), address)]]
    const key = bytesToHex(bagKey())
    lookTagsOf(tags, PK, key)
    await settle()
    const read = lookTagsOf(tags, PK, key)
    expect(read.closed?.refs?.[0][1]).toBe(address)
    expect(read.pending).toBeUndefined()
    lookTagsOf(tags, PK, key)
    expect(asked).toBe(1)
  })

  it('only a wrapper of exactly that shape, under the chest’s signer, is a sealed look', () => {
    const address = `33331:${PK}:${'0'.repeat(32)}`
    const wrapper = (over: object): ShardModel => ({ id: 'w', name: 'w', unit: 0, extent: 1, mode: 'solid', up: false, spin: 0, updatedAt: 0, vertices: [], faces: [], refs: [['a', address]], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }], ...over })
    expect(sealedLookAddress(wrapper({}), PK)).toBe(address)
    expect(sealedLookAddress(wrapper({}), 'c'.repeat(64))).toBeNull()
    expect(sealedLookAddress(wrapper({}), null)).toBeNull()
    expect(sealedLookAddress(wrapper({ parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 90, 0], step: 0 }] }), PK)).toBeNull()
    expect(sealedLookAddress(wrapper({ parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 1 }] }), PK)).toBeNull()
    expect(sealedLookAddress(wrapper({ objects: { [address]: {} } }), PK)).toBeNull()
  })

  it('keeps the cache bounded by bytes, newest kept', async () => {
    const key = bagKey()
    const chests = await Promise.all([0, 1, 2, 3].map(() => sealedChest(key, 40)))
    setSealedLookFetch(relayOf(chests.flatMap((c) => c.objects)))
    forgetSealedLooks(100_000)
    for (const c of chests) { lookOf({ type: 'chest', event: c.event, bagKeyHex: bytesToHex(key) }); await settle() }
    const kept = sealedLooksKept()
    expect(kept.bytes).toBeLessThanOrEqual(100_000)
    expect(kept.count).toBeLessThan(4)
    // The newest stands; an evicted one is fetched again when asked.
    expect(lookOf({ type: 'chest', event: chests[3].event, bagKeyHex: bytesToHex(key) })!.name).toBe('custom')
  })
})
