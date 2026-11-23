/**
 * lookDefaults.test.ts: the eight default models by reference (his ruling, 2026-11-01).
 * A default look goes out as a small wrapper of its public object; here an exact
 * match on its address is the bundled file. Nothing is fetched, walls and the lid
 * read a real model, and anything but an exact match stays an ordinary wrapper.
 */
import { describe, expect, it } from 'vitest'
import { newShard, ticksOf, toPayload, type ShardModel } from 'sno-core/shards'
import chestClosed from '../looks/chest.json'
import chestOpen from '../looks/chest-open.json'
import crawlClosed from '../looks/door-crawl.json'
import crawlOpen from '../looks/door-crawl-open.json'
import doorClosed from '../looks/door-standard.json'
import doorOpen from '../looks/door-standard-open.json'
import hallClosed from '../looks/door-hall.json'
import hallOpen from '../looks/door-hall-open.json'
import { planZip } from '../shardZip'
import { CHEST_LOOKS, DEFAULT_LOOK_ADDRESSES, DEFAULT_LOOK_AUTHOR, DEFAULT_LOOK_DS, DOOR_LOOKS, builtInLook, builtInLookTags, defaultLookAddress, drawnLook, lookOf, lookTagsOf, lookTags, posedLook, wireLook, wireOpenLook, type LookName } from '../looks'
import { constrainOf } from '../walkConstrain'

const ALL: LookName[] = [...CHEST_LOOKS, ...DOOR_LOOKS]
const POSE = { unit: 0, turn: [0, 0, 0] as [number, number, number], constrain: 'all' as const }
const event = (tags: string[][], door = false) => ({ tags: [...tags, ...(door ? [['door', '4']] : [])], pubkey: 'b'.repeat(64), sig: 'c'.repeat(128) })
const ticks = (m: ShardModel): number[][] => m.vertices.map((v) => [...ticksOf(v)])
/** A wrapper as any client would write it: through the real payload writer, or sno-core refuses it and the test proves nothing. */
const wrapper = (address: string, patch: Partial<ShardModel> = {}): string => JSON.stringify(toPayload({ ...newShard('w'), unit: 0, vertices: [], faces: [], refs: [['a', address]], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }], ...patch } as ShardModel))

/** The zip's entries, by name (maze-kit-locks.zip). */
const ZIP = ['chests/chest/chest', 'chests/chest/chest-open', 'doors/door-crawl/door-crawl', 'doors/door-crawl/door-crawl-open', 'doors/door-hall/door-hall', 'doors/door-hall/door-hall-open', 'doors/door-standard/door-standard', 'doors/door-standard/door-standard-open']

describe('the eight addresses', () => {
  it('are what the real import names them, under the owner’s key', () => {
    const plan = planZip(ZIP.map((name, index) => ({ name: `maze-kit/locks/${name}.json`, index, dir: false, size: 10, method: 8, encrypted: false })) as never, 'maze-kit-locks.zip')
    const ids = plan.rows.map((r) => r.id).sort()
    expect(ALL.flatMap((n) => [DEFAULT_LOOK_DS[n].closed, DEFAULT_LOOK_DS[n].open]).sort()).toEqual(ids)
    expect(DEFAULT_LOOK_ADDRESSES.size).toBe(8)
    for (const a of DEFAULT_LOOK_ADDRESSES.keys()) expect(a.startsWith(`33331:${DEFAULT_LOOK_AUTHOR}:maze-kit/locks/`)).toBe(true)
  })

  it('each map to its own bundled file', () => {
    const files: Record<LookName, { closed: { ticks?: unknown; vertices?: unknown }; open: { ticks?: unknown; vertices?: unknown } }> = {
      treasure: { closed: chestClosed, open: chestOpen }, crawl: { closed: crawlClosed, open: crawlOpen }, door: { closed: doorClosed, open: doorOpen }, hall: { closed: hallClosed, open: hallOpen },
    }
    for (const n of ALL) for (const part of ['closed', 'open'] as const) {
      expect(DEFAULT_LOOK_ADDRESSES.get(defaultLookAddress(DEFAULT_LOOK_DS[n][part]))).toEqual({ name: n, part })
      const payload = toPayload(builtInLook(n)[part]!) as { vertices?: unknown; ticks?: unknown }
      expect(payload.vertices ?? payload.ticks).toEqual(files[n][part].vertices ?? files[n][part].ticks)
    }
  })

  it('closed doors and chests are `all`, open doors `off`', () => {
    for (const n of ALL) expect(constrainOf(builtInLook(n).closed)).toBe('all')
    expect(constrainOf(builtInLook('treasure').open!)).toBe('all')
    for (const n of DOOR_LOOKS) {
      expect(constrainOf(builtInLook(n).open!)).toBe('off')
      expect((builtInLook(n).open as unknown as { extra?: { constrain?: unknown } }).extra?.constrain ?? (builtInLook(n).open as unknown as { constrain?: unknown }).constrain).toBe('off')
    }
    expect((crawlOpen as { constrain?: string }).constrain).toBe('off')
    expect((doorOpen as { constrain?: string }).constrain).toBe('off')
    expect((hallOpen as { constrain?: string }).constrain).toBe('off')
  })
})

describe('on the wire', () => {
  it('a default look is a small wrapper, closed and open, naming its address', () => {
    for (const n of ALL) {
      const tags = builtInLookTags(n, POSE)
      expect(tags).toHaveLength(2)
      for (const [i, part] of (['closed', 'open'] as const).entries()) {
        const p = JSON.parse(tags[i][1]) as { refs: unknown[][]; vertices?: unknown[]; ticks?: unknown[] }
        expect(p.refs[0][1]).toBe(defaultLookAddress(DEFAULT_LOOK_DS[n][part]))
        expect(p.vertices ?? []).toEqual([])
        expect(p.ticks ?? []).toEqual([])
      }
      expect(tags.flat().join('').length).toBeLessThan(1024)
    }
  })

  it('the bar’s WALK reaches the closed door and the chest, and never an open door', () => {
    for (const constrain of ['all', 'opaque', 'off'] as const) {
      const pose = { ...POSE, constrain }
      const door = lookOf({ type: 'chest', event: event(builtInLookTags('door', pose), true) })!
      expect(constrainOf(door.closed)).toBe(constrain)
      expect(constrainOf(drawnLook(door, true)!)).toBe('off')
      expect(JSON.parse(builtInLookTags('door', pose)[1][1]).constrain).toBeUndefined()
      const chest = lookOf({ type: 'chest', event: event(builtInLookTags('treasure', pose)) })!
      expect(constrainOf(chest.closed)).toBe(constrain)
      expect(constrainOf(drawnLook(chest, true)!)).toBe(constrain)
    }
  })

  it('a wrapper naming no WALK of its own takes the model’s: what FEED writes for the same object', () => {
    const closed = defaultLookAddress(DEFAULT_LOOK_DS.door.closed)
    const open = defaultLookAddress(DEFAULT_LOOK_DS.door.open)
    const look = lookOf({ type: 'chest', event: event([['look', wrapper(closed)], ['look', wrapper(open), 'open']], true) })!
    expect(look.name).toBe('custom')
    expect(look.closed.vertices.length).toBeGreaterThan(0)
    expect(constrainOf(look.closed)).toBe('all')
    expect(constrainOf(drawnLook(look, true)!)).toBe('off')
  })

  it('posed and read back: the same points as the old inline write, at every turn and SCALE', () => {
    for (const n of ['treasure', 'door'] as LookName[]) for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) for (const unit of [0, 3]) {
      const pose = { unit, turn: [x, y, z] as [number, number, number], constrain: 'all' as const }
      const read = lookTagsOf(builtInLookTags(n, pose))
      const inline = posedLook(builtInLook(n).closed, pose)
      expect(read.closed!.unit).toBe(unit)
      expect(ticks(read.closed!)).toEqual(ticks(inline))
      expect(read.closed!.faces).toEqual(inline.faces)
    }
  })

  it('moved: a look read back goes out by reference again, its pose carried, never inline', () => {
    const first = lookOf({ type: 'chest', event: event(builtInLookTags('treasure', { unit: 2, turn: [0, 1, 0], constrain: 'off' })) })!
    const pose = { unit: 3, turn: [0, 1, 0] as [number, number, number], constrain: 'all' as const }
    const tags = lookTags(wireLook(first.closed, pose), wireOpenLook(first.open!, pose))
    expect(tags.flat().join('').length).toBeLessThan(1024)
    const again = lookTagsOf(tags).closed!
    expect(again.unit).toBe(3)
    expect(ticks(again)).toEqual(ticks(posedLook(builtInLook('treasure').closed, { unit: 3, turn: [0, 2, 0], constrain: 'all' })))
    expect(constrainOf(again)).toBe('all')
  })
})

describe('read here', () => {
  it('is a real model: nothing to fetch, and something to walk into', () => {
    for (const n of ALL) {
      const read = lookTagsOf(builtInLookTags(n, POSE))
      for (const m of [read.closed!, read.open!]) {
        expect(m.refs ?? []).toEqual([])
        expect(m.parts ?? []).toEqual([])
        expect(m.vertices.length).toBeGreaterThan(0)
      }
    }
  })

  it('anything but an exact match stays an ordinary wrapper, fetched as any other', () => {
    const owner = defaultLookAddress(DEFAULT_LOOK_DS.door.closed)
    const near = [
      wrapper(`33331:${'a'.repeat(64)}:${DEFAULT_LOOK_DS.door.closed}`),
      wrapper(`${owner}-2`),
      wrapper(owner, { parts: [{ ref: 0, at: [1, 0, 0], turn: [0, 0, 0], step: 0 }] }),
      wrapper(owner, { parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }, { ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] }),
    ]
    for (const p of near) {
      const m = lookTagsOf([['look', p]]).closed
      // Read, and left as what it is: a wrapper to fetch.
      expect(m).not.toBeNull()
      expect(m!.vertices).toEqual([])
      expect(m!.parts?.length).toBeGreaterThan(0)
    }
    // A relay hint on an exact match is still that match.
    expect(lookTagsOf([['look', wrapper(owner, { name: 'hinted', refs: [['a', owner, 'wss://r.test']] })]]).closed?.vertices.length).toBeGreaterThan(0)
  })

  it('the lid goes by address: TREASURE at any SCALE; not turned; never a door’s model on a chest', () => {
    const at = (name: LookName, unit: number, turn: [number, number, number] = [0, 0, 0], door = false) => lookOf({ type: 'chest', event: event(builtInLookTags(name, { unit, turn, constrain: 'all' }), door) })!
    expect(at('treasure', 0).lid).toBeDefined()
    expect(at('treasure', 3).lid).toBeDefined()
    expect(at('treasure', 0, [0, 1, 0]).lid).toBeUndefined()
    expect(at('door', 0).lid).toBeUndefined()
    expect(at('treasure', 0, [0, 0, 0], true).lid).toBeUndefined()
  })

  it('a chest of the old inline kind is still read, and keeps its lid by its shape', () => {
    const inline = lookTags(posedLook(builtInLook('treasure').closed, POSE), posedLook(builtInLook('treasure').open!, POSE))
    expect(JSON.parse(inline[0][1]).refs).toBeUndefined()
    const look = lookOf({ type: 'chest', event: event(inline) })!
    expect(look.lid).toBeDefined()
    expect(look.closed.vertices.length).toBeGreaterThan(0)
  })
})
