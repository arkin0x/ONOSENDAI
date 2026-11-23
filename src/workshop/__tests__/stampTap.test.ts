/**
 * stampTap.test.ts: a tap with STAMP's OBJECT (owner, 2026-11-23). COPY puts
 * the chosen shard's points and faces in as real, editable ones, one undoable
 * edit, naming what it made (lastCopy, for a group made of one stamp); LINK
 * places it as one object by reference, as before; a stamp that would pass
 * what one hidden object holds is refused in words, nothing changed; and SNAP
 * TO ITS SIZE lands a 16-gibson piece on 16-gibson steps.
 */

import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { newShard, TICKS_PER_UNIT, ticksOf, type ShardModel } from 'sno-core/shards'
import { toModel } from 'sno-core/snoPalette'
import { useWorkshop, type StampObject } from '../../store/useWorkshop'
import { bakeSource, stampedIndices } from '../../lib/stampCopy'
import { wholePayloadLimit } from '../../lib/shardFullness'
import { payloadBytes, stampAim, stampTap } from '../stampTap'

const T = TICKS_PER_UNIT
const PK = 'e'.repeat(64)
const RED = toModel([200, 30, 40])

/** A 16-unit square tile centred on its origin, as a kit piece is. */
function tile(name = 'Tile 16'): ShardModel {
  const corners: Array<[number, number, number]> = [[-8, 0, -8], [8, 0, -8], [8, 0, 8], [-8, 0, 8]]
  return { ...newShard(name), mode: 'solid', extent: 9, vertices: corners.map((p) => ({ p, c: RED })), faces: [[0, 1, 2], [0, 2, 3]] }
}

function chosen(s: ShardModel): StampObject {
  const copy = bakeSource(s, [])!
  return { ref: ['a', `33331:${PK}:${s.id}`], name: s.name, shard: s, copy, size: { min: copy.min!, max: copy.max!, unit: copy.unit }, local: true }
}

const w = () => useWorkshop.getState()

beforeEach(() => {
  useWorkshop.setState({ shards: [], currentId: null, selection: [], partSel: [], tool: 'stamp', stampMode: 'object', stampObject: null, stampFacing: 0, stampForm: 'copy', stampSnap: true, lastCopy: null, past: [], future: [], level: 0, plane: 1 })
  w().create('level')
  useWorkshop.setState((st) => ({ shards: st.shards.map((s) => ({ ...s, extent: 40 })) }))
})

describe('COPY', () => {
  it('is the default', () => {
    useWorkshop.setState({ stampForm: useWorkshop.getInitialState().stampForm })
    expect(w().stampForm).toBe('copy')
  })

  it('puts the shard in as real points and faces, one undoable edit, and names what it made', () => {
    w().setStampObject(chosen(tile()))
    const range = stampTap([16 * T, 0, 0])
    const s = w().current()!
    expect(s.vertices).toHaveLength(4)
    expect(s.faces).toHaveLength(2)
    expect(s.refs ?? []).toHaveLength(0)
    expect(ticksOf(s.vertices[0])).toEqual([8 * T, 0, -8 * T])
    expect(range).toEqual({ shardId: s.id, vertices: [0, 4], faces: [0, 2] })
    expect(w().lastCopy).toEqual(range)
    expect(stampedIndices(w().lastCopy!)).toEqual({ vertices: [0, 1, 2, 3], faces: [0, 1] })
    expect(w().notice).toMatch(/copied in: 4 points and 2 faces, yours to edit\. Switched to SOLID so the faces show\.$/)
    w().undo()
    expect(w().current()!.vertices).toHaveLength(0)
  })

  it('names only the second stamp’s points and faces after a second stamp', () => {
    w().setStampObject(chosen(tile()))
    stampTap([0, 0, 0])
    const range = stampTap([16 * T, 0, 0])
    expect(range).toEqual({ shardId: w().currentId, vertices: [4, 8], faces: [2, 4] })
  })

  it('lets lastCopy go once anything else changes the shard, or another shard is opened', () => {
    w().setStampObject(chosen(tile()))
    stampTap([0, 0, 0])
    expect(w().lastCopy).not.toBeNull()
    w().undo()
    expect(w().lastCopy).toBeNull()
    stampTap([0, 0, 0])
    w().addVertex([0, 5 * T, 0])
    expect(w().lastCopy).toBeNull()
    stampTap([0, 0, 0])
    w().create('another')
    expect(w().lastCopy).toBeNull()
  })

  it('refuses in words a stamp that would pass what one hidden object holds, and changes nothing', () => {
    // A big piece, stamped until the next would pass the limit.
    const n = 2600
    const big: ShardModel = { ...newShard('Big'), mode: 'points', extent: 40, vertices: Array.from({ length: n }, (_, i) => ({ p: [i % 39 - 19, Math.floor(i / 39) % 39 - 19, Math.floor(i / 1521)] as [number, number, number], c: toModel([i % 256, (i * 7) % 256, (i * 13) % 256]) })), faces: [] }
    w().setStampObject(chosen(big))
    let stamped = 0
    while (stamped < 50 && stampTap([stamped * T, 0, 0]) !== null) stamped++
    expect(stamped).toBeGreaterThan(0)
    expect(payloadBytes(w().current()!)).toBeLessThanOrEqual(wholePayloadLimit())
    expect(w().notice).toMatch(/^Not stamped: the shard would be [\d,]+ of 179,477 bytes, more than one hidden object holds\.$/)
    const before = w().current()
    expect(stampTap([T, 0, 0])).toBeNull()
    expect(w().current()).toBe(before)
  })

  it('asks for a library shard when the chosen one cannot be copied', () => {
    w().setStampObject({ ...chosen(tile()), copy: null })
    expect(stampTap([0, 0, 0])).toBeNull()
    expect(w().notice).toMatch(/COPY needs a shard from your library/)
  })
})

describe('LINK', () => {
  it('places the shard as one object by reference, as before', () => {
    w().setStampForm('link')
    w().setStampObject(chosen(tile()))
    w().turnStamp()
    expect(stampTap([16 * T, 0, 0])).toBeNull()
    const s = w().current()!
    expect(s.vertices).toHaveLength(0)
    expect(s.refs).toHaveLength(1)
    expect(s.parts).toEqual([{ ref: 0, at: [16 * T, 0, 0], turn: [0, 90, 0], step: 0 }])
    expect(w().lastCopy).toBeNull()
    expect(w().notice).toMatch(/placed\. It is one object/)
  })

  it('asks to sign in when the chosen shard names no author', () => {
    w().setStampForm('link')
    w().setStampObject({ ...chosen(tile()), ref: ['a', '33331:null:x'] })
    expect(stampTap([0, 0, 0])).toBeNull()
    expect(w().notice).toMatch(/^Sign in to link a shard/)
    expect(w().current()!.parts).toBeUndefined()
  })

  it('never makes a shard place itself', () => {
    w().setStampForm('link')
    const id = w().currentId!
    w().setStampObject({ ...chosen(tile()), ref: ['a', `33331:${PK}:${id}`] })
    stampTap([0, 0, 0], `33331:${PK}:${id}`)
    expect(w().notice).toMatch(/cannot place itself/)
    expect(w().current()!.parts).toBeUndefined()
  })
})

describe('SNAP TO ITS SIZE', () => {
  it('lands a 16-unit piece on 16-unit steps along the floor, and the grid’s step when off', () => {
    w().setStampObject(chosen(tile()))
    expect(stampAim([9.4 * T, 0, -22 * T])).toEqual([16 * T, 0, -16 * T])
    w().setStampSnap(false)
    expect(stampAim([9.4 * T, 0, -22 * T])).toBeNull()
  })

  it('applies to OBJECT only', () => {
    w().setStampObject(chosen(tile()))
    useWorkshop.setState({ stampMode: 'shape' })
    expect(stampAim([9.4 * T, 0, 0])).toBeNull()
  })
})
