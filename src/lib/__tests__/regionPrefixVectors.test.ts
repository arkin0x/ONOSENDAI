/**
 * regionPrefixVectors.test.ts - the region strings shared with the relay
 * (speakeasy ruling D7, 2026-11-04): relay.onosendai.tech/<hex> names exactly
 * the region of www.onosendai.tech/C/<hex>, so a speakeasy URL and a /C/ link
 * agree on the box.
 *
 * The file is region-prefix-vectors.json at the root of arkin0x/cyberspace
 * (added by arkin0x/cyberspace#88), which is canonical; this copy is byte for
 * byte the same (sha256 below), and cyberspace-relay tests the same bytes
 * (server/regiongate/testdata, ParseRegionPath). It was written from this
 * app's own route code (origin/v2 366e9df, coordRoute.ts) by the relay's
 * testdata/tools/onosendai-region-vectors.ts. To update it, regenerate it
 * there and copy it here unchanged. A vector this code disagrees with is a
 * finding about one implementation or the other, never a vector to edit.
 *
 * Every vector runs through parseCoordRoute exactly as a /C/ path does, then
 * prefixRegion (1 to 63 characters) or coordPlace (64): the hex, the kind,
 * the plane, and each axis's min, max, height and size; and every point
 * decodes to its axes and lies inside the box exactly when the vector says.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { coordToXyz } from 'cyberspace-core'
import { coordPlace, parseCoordRoute, prefixRegion } from '../coordRoute'

const FILE = 'src/lib/__tests__/vectors/region-prefix-vectors.json'
const SHA256 = 'eaeec282fffae9bf6c96b2345d2480da417dc9de7e66ed98547a7b407ce7c9e1'

interface Axis { min: string; max: string; height: number; size: string }
interface Point { coord: string; x: string; y: string; z: string; plane: 0 | 1 }
interface Vector {
  name: string
  input: string
  valid: boolean
  kind?: 'prefix' | 'full'
  hex?: string
  region?: { plane: 0 | 1 | null; x: Axis; y: Axis; z: Axis }
  inside?: Point[]
  outside?: Point[]
}

const bytes = readFileSync(FILE)
const vectors: Vector[] = JSON.parse(bytes.toString('utf8')).vectors

describe('region-prefix-vectors.json', () => {
  it('is the spec root\'s copy, byte for byte', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(SHA256)
    expect(vectors.length).toBe(48)
  })

  for (const v of vectors) {
    it(v.name, () => {
      const route = parseCoordRoute('/C/' + v.input)
      expect(route).not.toBeNull()
      if (!v.valid) {
        expect(route!.kind).toBe('invalid')
        return
      }
      expect(route).toEqual({ kind: v.kind, hex: v.hex })
      const hex = v.hex!
      const r = v.region!
      let base: { x: bigint; y: bigint; z: bigint }
      let h: { x: number; y: number; z: number }
      if (route!.kind === 'prefix') {
        const box = prefixRegion(hex)
        base = box.base
        h = box.heights
        expect(r.plane).toBeNull()
      } else {
        const place = coordPlace(hex)
        base = place.position
        h = { x: 0, y: 0, z: 0 }
        expect(r.plane).toBe(place.plane)
      }
      for (const a of ['x', 'y', 'z'] as const) {
        const size = 1n << BigInt(h[a])
        expect({ min: base[a].toString(), max: (base[a] + size - 1n).toString(), height: h[a], size: size.toString() }).toEqual(r[a])
      }
      for (const [points, inside] of [[v.inside!, true], [v.outside!, false]] as const) {
        for (const p of points) {
          const c = coordToXyz(BigInt('0x' + p.coord))
          expect({ x: c.x.toString(), y: c.y.toString(), z: c.z.toString(), plane: c.plane }).toEqual({ x: p.x, y: p.y, z: p.z, plane: p.plane })
          const inBox = (['x', 'y', 'z'] as const).every((a) => c[a] >= base[a] && c[a] < base[a] + (1n << BigInt(h[a])))
          const inPlane = r.plane === null || c.plane === r.plane
          expect(inBox && inPlane, `${p.coord} inside=${inside}`).toBe(inside)
          expect(p.coord.startsWith(hex)).toBe(inside)
        }
      }
    })
  }
})
