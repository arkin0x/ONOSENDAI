/**
 * trailPlane.test.ts: the trail respects the plane on show (PathTrail.tsx).
 *
 * Dataspace and ideaspace share x, y and z, so the trail's moves in the
 * other plane drew right over the moves in this one (arkinox, 2026-10-15).
 * A move in the plane on show is drawn as it always was; one in the other
 * plane fades to that plane's dark color, purple for ideaspace and green for
 * dataspace; a segment between the planes blends from one to the other.
 * And switching the plane recolors the lines where they stand: nothing the
 * switch changes rebuilds them.
 */

import { describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { readFileSync } from 'node:fs'
import { Color, type BufferAttribute } from 'three'
import type { Plane } from 'cyberspace-core'
import {
  buildTrail, GAME_INK, LOCAL_INK, paintTrail, TRAIL_INK, trailColor, trailLines,
  type Trail, type TrailInput, type TrailLine,
} from '../PathTrail'
import { GAME, GAME_DIM, TRAIL_DATASPACE_DIM, TRAIL_IDEASPACE_DIM } from '../../lib/palette'
import type { Position } from '../../lib/space'
import { useCyberspace } from '../../store/useCyberspace'

const RED = new Color('#ff0000')
const LOCAL_RED = new Color('#d94848')
const PURPLE = new Color(TRAIL_IDEASPACE_DIM)
const GREEN = new Color(TRAIL_DATASPACE_DIM)

const at = (x: number, y = 0, z = 0): Position => ({ x: BigInt(x), y: BigInt(y), z: BigInt(z) })
const centre = (p: Position): [number, number, number] => [Number(p.x), Number(p.y), Number(p.z)]

/** The color of one vertex of a line, as it is drawn. */
function vertex(line: TrailLine, i: number): Color {
  const a = line.geometry.attributes.color.array as Float32Array
  return new Color(a[i * 3], a[i * 3 + 1], a[i * 3 + 2])
}
/** Each segment of a line as its two ends' colors. */
function segments(line: TrailLine): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (let i = 0; i < line.planes.length; i += 2) out.push([vertex(line, i).getHexString(), vertex(line, i + 1).getHexString()])
  return out
}
const hex = (c: Color): string => c.getHexString()

/**
 * Spawn in dataspace, a hop there, a sidestep that flips into ideaspace in
 * place, a hop in ideaspace, and a ride that lands back in dataspace: every
 * segment kind, all published, the head on show.
 */
function chain(extra: Partial<TrailInput> = {}): TrailInput {
  return {
    positions: [at(0), at(1), at(1), at(1, 1), at(4, 4, 4)],
    planes: [0, 0, 1, 1, 0],
    local: [],
    split: 4,
    games: [],
    centre,
    ...extra,
  }
}
function painted(input: TrailInput, view: Plane): Trail {
  const t = buildTrail(input)
  for (const l of trailLines(t)) paintTrail(l, view)
  return t
}

describe('the color of a trail vertex', () => {
  it('is the line\'s own color in the plane on show, whichever plane that is', () => {
    for (const p of [0, 1] as Plane[]) {
      expect(hex(trailColor(TRAIL_INK, p, p))).toBe(hex(RED))
      expect(hex(trailColor(LOCAL_INK, p, p))).toBe(hex(LOCAL_RED))
      expect(hex(trailColor(GAME_INK, p, p))).toBe(hex(new Color(GAME)))
    }
  })

  it('is dark purple for an ideaspace move while dataspace is on show', () => {
    expect(hex(trailColor(TRAIL_INK, 1, 0))).toBe(hex(PURPLE))
    expect(hex(trailColor(LOCAL_INK, 1, 0))).toBe(hex(PURPLE))
  })

  it('is dark green for a dataspace move while ideaspace is on show', () => {
    expect(hex(trailColor(TRAIL_INK, 0, 1))).toBe(hex(GREEN))
    expect(hex(trailColor(LOCAL_INK, 0, 1))).toBe(hex(GREEN))
  })

  it('keeps a game\'s moves pink, darkened, in the other plane: never a travel color', () => {
    expect(hex(trailColor(GAME_INK, 1, 0))).toBe(hex(new Color(GAME_DIM)))
    expect(hex(trailColor(GAME_INK, 0, 1))).toBe(hex(new Color(GAME_DIM)))
    expect([hex(PURPLE), hex(GREEN), hex(RED)]).not.toContain(hex(new Color(GAME_DIM)))
  })

  it('is darker than the trail on show, and still off the black', () => {
    const lum = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
    for (const dim of [PURPLE, GREEN]) {
      expect(lum(dim)).toBeLessThan(lum(RED) / 2)
      expect(lum(dim)).toBeGreaterThan(0.02)
    }
  })
})

describe('the trail, segment by segment', () => {
  it('draws dataspace as before and ideaspace in dark purple, viewing dataspace', () => {
    const t = painted(chain(), 0)
    expect(segments(t.walked!)).toEqual([
      [hex(RED), hex(RED)], // the hop in dataspace: as it always was
      [hex(RED), hex(PURPLE)], // the flip into ideaspace: blends along the segment
      [hex(PURPLE), hex(PURPLE)], // the hop in ideaspace
      [hex(PURPLE), hex(RED)], // the ride back into dataspace
    ])
  })

  it('draws ideaspace as before and dataspace in dark green, viewing ideaspace', () => {
    const t = painted(chain(), 1)
    expect(segments(t.walked!)).toEqual([
      [hex(GREEN), hex(GREEN)],
      [hex(GREEN), hex(RED)],
      [hex(RED), hex(RED)],
      [hex(RED), hex(GREEN)],
    ])
  })

  it('blends a spawn in the other plane into the plane on show', () => {
    const t = painted(chain({ positions: [at(0), at(1)], planes: [1, 0], split: 1 }), 0)
    expect(segments(t.walked!)).toEqual([[hex(PURPLE), hex(RED)]])
  })

  it('colors the faint part past an explored action the same way, and the unpublished tail', () => {
    // Explored at the second action, and the last two not yet published.
    const t = painted(chain({ split: 2, local: [false, false, false, true, true] }), 0)
    expect(segments(t.walked!)).toEqual([[hex(RED), hex(RED)], [hex(RED), hex(PURPLE)]])
    expect(segments(t.aheadLocal!)).toEqual([[hex(PURPLE), hex(PURPLE)], [hex(PURPLE), hex(LOCAL_RED)]])
  })

  it('colors a game\'s moves by the plane each was made in', () => {
    const games = [{ end: 3, from: { position: at(2), plane: 0 as Plane }, to: { position: at(3), plane: 1 as Plane } }]
    const t = painted(chain({ games }), 0)
    expect(segments(t.gameWalked!)).toEqual([[hex(new Color(GAME)), hex(new Color(GAME_DIM))]])
  })
})

describe('switching the plane', () => {
  it('recolors every line where it stands, without rebuilding it', () => {
    const t = buildTrail(chain({ split: 2, local: [false, false, false, true, true] }))
    const lines = trailLines(t)
    for (const l of lines) paintTrail(l, 0)
    const before = lines.map((l) => ({
      geometry: l.geometry,
      position: l.geometry.attributes.position,
      positions: Array.from(l.geometry.attributes.position.array),
      color: l.geometry.attributes.color,
      array: l.geometry.attributes.color.array,
      version: (l.geometry.attributes.color as BufferAttribute).version,
    }))

    for (const l of lines) paintTrail(l, 1)

    lines.forEach((l, i) => {
      // The same geometry, the same attributes and the same buffers.
      expect(l.geometry).toBe(before[i].geometry)
      expect(l.geometry.attributes.position).toBe(before[i].position)
      expect(Array.from(l.geometry.attributes.position.array)).toEqual(before[i].positions)
      expect(l.geometry.attributes.color).toBe(before[i].color)
      expect(l.geometry.attributes.color.array).toBe(before[i].array)
      // Flagged for upload, so the next frame draws the new colors.
      expect((l.geometry.attributes.color as BufferAttribute).version).toBeGreaterThan(before[i].version)
    })
    expect(segments(t.walked!)).toEqual([[hex(GREEN), hex(GREEN)], [hex(GREEN), hex(RED)]])
    expect(segments(t.aheadLocal!)).toEqual([[hex(LOCAL_RED), hex(LOCAL_RED)], [hex(LOCAL_RED), hex(GREEN)]])
  })

  it('leaves untouched everything the trail is built from', () => {
    useCyberspace.setState({
      positionHistory: [at(0), at(1)], exploreIndex: null, spectate: null, focus: null,
      plane: 0, anchorPlane: 0, proof: { ...useCyberspace.getState().proof, status: 'idle' },
    })
    const s0 = useCyberspace.getState()
    const inputs = [s0.positionHistory, s0.anchor, s0.events, s0.published, s0.spectate, s0.exploreIndex, s0.scaleExp, s0.focus]

    s0.togglePlane()

    const s1 = useCyberspace.getState()
    expect(s1.anchorPlane).toBe(1)
    expect([s1.positionHistory, s1.anchor, s1.events, s1.published, s1.spectate, s1.exploreIndex, s1.scaleExp, s1.focus]).toEqual(inputs)
    ;[s1.positionHistory, s1.anchor, s1.events, s1.published].forEach((v, i) => expect(v).toBe(inputs[i]))
  })

  it('is not among what the trail is rebuilt on', () => {
    // The memo that builds the lines, and what it depends on: the plane on
    // show is read only by the effect that paints them.
    const src = readFileSync('src/scene/PathTrail.tsx', 'utf8')
    const memo = /const trail = useMemo\([\s\S]*?\n {2}\}, \[([^\]]*)\]\)/.exec(src)
    expect(memo).not.toBeNull()
    expect(memo![1]).not.toMatch(/[Pp]lane\b|viewPlane|anchorPlane/)
    expect(memo![0]).not.toMatch(/viewPlane|anchorPlane/)
    expect(src).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(trail\) for \(const line of trailLines\(trail\)\) paintTrail\(line, viewPlane\)\s*\}, \[trail, viewPlane\]\)/)
  })
})
