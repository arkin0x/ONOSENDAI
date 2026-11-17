/**
 * placeholderField.test.ts - the BUILT-IN FIELD (level/placeholderField.ts):
 * an original battlefield authored in code, in the full battlefield's frame.
 *
 * - The frame: region-local, ground y 64, the entry point [128, 65, 196]
 *   inside the start zone, the zones as the full battlefield's, their front
 *   lines 100 apart, spawn points s1..s14 and the patrol loop.
 * - Every payload reads as an SNO object (sno-core fromPayload, as PASTE and
 *   bulk import read one; lib/hidden.ts shardRefusal finds nothing), under
 *   96 KB; the faces drawn, every placement counted, under 25,000.
 * - Fog posts draw nothing (points, opacity 0), stop no one (constrain off)
 *   and glow as fog; light posts glow as light, cyan on the safe zone's front
 *   line and gold on the end zone's.
 * - Closed: ground under every gibson of the field, walls on all four sides
 *   with no gap, taller than anyone can climb to and jump over.
 * - Pure: the same field on every call.
 */

import { describe, expect, it } from 'vitest'
import baseVariant from '../variants/drone-run-base.json'
import { fromPayload } from 'sno-core/shards'
import { shardRefusal } from '../../../hidden'
import { insideBox, pieceNames, readLevel, type Local } from '../level/level'
import { FIELD_HI, FIELD_LO, PERIMETER_HEIGHT, placeholderField, type FieldPayload } from '../level/placeholderField'

const field = placeholderField()
const { level, payloads } = field

/** A piece's box in region-local gibsons where it stands (the wire's z through the mirror). */
function boxOf(piece: string, at: Local): { lo: Local; hi: Local } {
  const pl = payloads[piece]
  const lo: Local = [Infinity, Infinity, Infinity], hi: Local = [-Infinity, -Infinity, -Infinity]
  pl.vertices.forEach(([x, y, z]) => {
    const p = [at[0] + x, at[1] + y, at[2] - z]
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]) }
  })
  // Ticks are under a gibson; whole bounds are enough here (fractional vertices only lift a top).
  return { lo, hi: [hi[0], hi[1] + 1, hi[2]] }
}

const placed = (prefix: string) => level.pieces.filter((p) => p.piece.startsWith(prefix))

describe('the frame', () => {
  it('reads as a level: region height 8 frame, ground 64, the entry inside the start zone', () => {
    expect(readLevel(JSON.parse(JSON.stringify(level)))).toEqual(level)
    expect(level.groundY).toBe(64)
    expect(level.entry).toEqual([128, 65, 196])
    expect(insideBox(level.zones.start, level.entry)).toBe(true)
  })

  it('the zones are the full battlefield\'s, their front lines 100 apart', () => {
    expect(level.zones).toEqual({ start: { lo: [108, 62, 184], hi: [148, 80, 204] }, finish: { lo: [114, 66, 66], hi: [142, 78, 84] } })
    expect(level.zones.start.lo[2] - level.zones.finish.hi[2]).toBe(100)
  })

  it('the base variant names the same zones as the field (the variant\'s spec.zones are the level\'s)', () => {
    const z = (baseVariant as { spec: { zones: unknown } }).spec.zones
    expect(z).toEqual(placeholderField().level.zones)
  })

  it('spawn points s1..s14 and a patrol loop', () => {
    expect(level.spawns.map((s) => s.id)).toEqual(Array.from({ length: 14 }, (_, i) => `s${i + 1}`))
    expect(level.spawns.find((s) => s.id === 's1')?.at).toEqual([128, 92, 150])
    expect(level.patrol.length).toBe(8)
  })

  it('the end-zone dais holds the finish zone, its top 2 above the ground', () => {
    const dais = placed('field-dais')
    expect(dais.length).toBe(1)
    const b = boxOf('field-dais', dais[0].at)
    expect(b.hi[1] - 1).toBe(level.groundY + 2)
    expect(b.lo[0]).toBeLessThanOrEqual(level.zones.finish.lo[0])
    expect(b.hi[0]).toBeGreaterThanOrEqual(level.zones.finish.hi[0])
    expect(b.lo[2]).toBeLessThanOrEqual(level.zones.finish.lo[2])
    expect(b.hi[2]).toBeGreaterThanOrEqual(level.zones.finish.hi[2])
  })
})

describe('the payloads', () => {
  it('every piece placed has a payload, and every payload is placed', () => {
    expect(pieceNames(level).sort()).toEqual(Object.keys(payloads).sort())
  })

  it('each reads as an SNO object, nothing refused, under 96 KB; under 25,000 faces in all', () => {
    let faces = 0
    for (const [name, pl] of Object.entries(payloads)) {
      const text = JSON.stringify(pl)
      expect(new TextEncoder().encode(text).length, name).toBeLessThan(96 * 1024)
      const shard = fromPayload(JSON.parse(text), name)
      expect(shard, name).not.toBeNull()
      if (pl.mode === 'solid') expect(shardRefusal(shard!), name).toBeNull()
      expect(name).toMatch(/^field-[a-z0-9-]+$/)
    }
    for (const p of level.pieces) faces += payloads[p.piece].faces.length
    expect(faces).toBeLessThan(25_000)
  })

  it('fog posts draw nothing and stop no one, and glow as fog; light posts glow as light, cyan in front of the safe zone, gold at the end zone', () => {
    const fogs = Object.entries(payloads).filter(([n]) => n.startsWith('field-fog-')).map(([, p]) => p)
    expect(fogs.length).toBeGreaterThanOrEqual(3)
    for (const f of fogs) {
      expect(f.mode).toBe('points')
      expect(f.opacity).toBe(0)
      expect(f.constrain).toBe('off')
      expect(f.glow?.[0]).toBe('fog')
    }
    const light = (n: string): FieldPayload => payloads[n]
    for (const n of ['field-light-safe-line', 'field-light-safe-post', 'field-light-end-line', 'field-light-end-post']) {
      expect(light(n).glow?.[0]).toBe('light')
      expect(light(n).constrain).toBe('off')
    }
    expect(light('field-light-safe-line').palette[1]).toEqual([70, 214, 255])
    expect(light('field-light-end-line').palette[0]).toEqual([255, 196, 64])
    // On the front lines.
    expect(placed('field-light-safe-line')[0].at[2]).toBe(level.zones.start.lo[2])
    expect(placed('field-light-end-line')[0].at[2]).toBe(level.zones.finish.hi[2])
  })

  it('walls taller than 9 block sight, and there are some', () => {
    const tall = level.pieces.filter((p) => payloads[p.piece].constrain === 'all' && !p.piece.startsWith('field-edge-') && boxOf(p.piece, p.at).hi[1] - 1 - level.groundY > 9)
    expect(tall.length).toBeGreaterThanOrEqual(4)
  })

  it('is pure: the same field on every call', () => {
    expect(placeholderField()).toEqual(field)
  })
})

describe('closed: nobody leaves', () => {
  it('ground under every gibson of the field', () => {
    const slabs = placed('field-ground-').map((p) => boxOf(p.piece, p.at))
    for (let x = FIELD_LO; x <= FIELD_HI; x++) {
      for (let z = FIELD_LO; z <= FIELD_HI; z++) {
        expect(slabs.some((b) => x >= b.lo[0] && x <= b.hi[0] && z >= b.lo[2] && z <= b.hi[2]), `${x},${z}`).toBe(true)
      }
    }
  })

  it('walls on all four sides, no gap, taller than the highest place inside plus a double jump and a body', () => {
    const walls = placed('field-edge-').map((p) => boxOf(p.piece, p.at))
    // The highest top a player could stand on inside: every solid piece but the walls themselves.
    const inside = level.pieces.filter((p) => payloads[p.piece].constrain === 'all' && !p.piece.startsWith('field-edge-'))
    const highest = Math.max(...inside.map((p) => boxOf(p.piece, p.at).hi[1] - 1))
    // Jump 5 and double jump 3 (fluid WALK), a 2-gibson body.
    const reach = highest + 5 + 3 + 2
    for (const w of walls) expect(w.hi[1] - 1).toBe(level.groundY + PERIMETER_HEIGHT)
    expect(level.groundY + PERIMETER_HEIGHT).toBeGreaterThan(reach)
    const covers = (x: number, z: number): boolean => walls.some((b) => x >= b.lo[0] && x <= b.hi[0] && z >= b.lo[2] && z <= b.hi[2])
    for (let t = FIELD_LO - 1; t <= FIELD_HI + 1; t++) {
      expect(covers(t, FIELD_LO - 1), `north ${t}`).toBe(true)
      expect(covers(t, FIELD_HI + 1), `south ${t}`).toBe(true)
      expect(covers(FIELD_LO - 1, t), `west ${t}`).toBe(true)
      expect(covers(FIELD_HI + 1, t), `east ${t}`).toBe(true)
    }
    // Every wall stands just outside the field, and every piece inside it.
    for (const w of walls) expect(w.hi[0] <= FIELD_LO || w.lo[0] >= FIELD_HI || w.hi[2] <= FIELD_LO || w.lo[2] >= FIELD_HI).toBe(true)
    for (const p of level.pieces.filter((q) => !q.piece.startsWith('field-edge-'))) {
      const b = boxOf(p.piece, p.at)
      expect(b.lo[0] >= FIELD_LO && b.hi[0] <= FIELD_HI && b.lo[2] >= FIELD_LO && b.hi[2] <= FIELD_HI, p.piece).toBe(true)
    }
  })
})
