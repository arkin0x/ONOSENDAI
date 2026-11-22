/**
 * starSpotText.test.ts: the star's place text is written out once per place,
 * not at every change to the store (owner's phone diag, 2026-11-22), and is
 * the same text as before.
 */
import { describe, expect, it } from 'vitest'
import { bottomChip, placeInput, starSpot, type StarSource } from '../starred'

const P = (x: bigint, y: bigint, z: bigint) => ({ x, y, z })
const src = (over: Partial<StarSource> = {}): StarSource => ({
  position: P(1n, 2n, 3n), headPlane: 0, cursor: P(1n, 2n, 3n), plane: 0, anchor: P(1n, 2n, 3n), anchorPlane: 0,
  focus: null, atHead: () => true, canDrive: () => true, ...over,
} as StarSource)

describe('the star spot', () => {
  it('is null on your avatar, and the bottom chip is CHAT', () => {
    expect(starSpot(src())).toBeNull()
    expect(bottomChip(src())).toBe('chat')
  })

  it('names the cursor in full and shortened, and follows each new place by value', () => {
    const big = (1n << 84n) + 12345n
    const a = starSpot(src({ cursor: P(big, 2n, 3n) }))!
    expect(a.input).toBe(placeInput(P(big, 2n, 3n)))
    expect(a.label.split(', ')).toHaveLength(3)
    expect(bottomChip(src({ cursor: P(big, 2n, 3n) }))).toBe('star')
    // The same place again, a new object: the same text.
    const again = starSpot(src({ cursor: P(big, 2n, 3n) }))!
    expect(again.input).toBe(a.input)
    expect(again.label).toBe(a.label)
    // Another place: its own text.
    const b = starSpot(src({ cursor: P(big + 1n, 2n, 3n) }))!
    expect(b.input).toBe(placeInput(P(big + 1n, 2n, 3n)))
    expect(b.input).not.toBe(a.input)
    // The returned position is a copy, as before.
    const cur = P(big, 2n, 3n)
    expect(starSpot(src({ cursor: cur }))!.position).not.toBe(cur)
  })

  it('a named focus keeps its name', () => {
    const at = P(9n, 9n, 9n)
    const s = src({ canDrive: () => false, focus: { position: at, plane: 0, label: 'Somewhere' } })
    expect(starSpot(s)!.label).toBe('Somewhere')
    expect(starSpot(s)!.input).toBe(placeInput(at))
  })
})
