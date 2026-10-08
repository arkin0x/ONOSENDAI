/**
 * starredMarks.test.ts: which starred places stand in the scene, where, and
 * under what words (lib/starred.ts placedStars, sceneLabel, placeName).
 * Placed and culled the way a hidden message is: itemCentre against the
 * anchor's aligned origin, only in the plane being looked at, within reach.
 */

import { describe, expect, it } from 'vitest'
import { axesLabel, cleanNickname, NICKNAME_MAX, placedStars, placeName, placePosition, sceneLabel, type StarredPlace } from '../../lib/starred'
import { itemCentre, type ViewAxes } from '../../lib/space'

const axes: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } as ViewAxes
const origin = { x: 1000n, y: 1000n, z: 1000n }
const place = (x: bigint, plane: 0 | 1 = 0, extra: Partial<StarredPlace> = {}): StarredPlace => ({
  input: `${x}, 1000, 1000`, label: `${x}, 1000, 1000`, plane, at: 0, ...extra,
})

describe('starred places in the scene', () => {
  it('draws a place in view where a hidden item at that coordinate is drawn', () => {
    const p = place(1003n)
    const out = placedStars([p], origin, 0, 0, axes, 192)
    expect(out).toHaveLength(1)
    expect(out[0].at).toEqual(itemCentre(placePosition(p.input)!, origin, 0, axes))
  })

  it('leaves out a place in the other plane', () => {
    expect(placedStars([place(1003n, 1)], origin, 0, 0, axes, 192)).toEqual([])
    expect(placedStars([place(1003n, 1)], origin, 1, 0, axes, 192)).toHaveLength(1)
  })

  it('culls a place past the reach, and brings it in when zoomed out', () => {
    const far = place(1000n + 500n)
    expect(placedStars([far], origin, 0, 0, axes, 192)).toEqual([])
    // At 2^4 a cell is sixteen gibsons, so five hundred is about thirty-one cells away.
    expect(placedStars([far], origin, 0, 4, axes, 192)).toHaveLength(1)
  })

  it('skips a stored place whose text is not three whole numbers', () => {
    expect(placedStars([{ input: 'nonsense', label: 'x', plane: 0, at: 0 }], origin, 0, 0, axes, 192)).toEqual([])
  })

  it('writes the nickname, else a real name, and nothing for bare axes', () => {
    const big = { input: '19342813102987152433021963, 5, 6', plane: 0 as const, at: 0 }
    const bare = { ...big, label: axesLabel(big.input) }
    expect(sceneLabel(bare)).toBeNull()
    expect(sceneLabel({ ...bare, nickname: 'Home' })).toBe('Home')
    expect(sceneLabel({ ...big, label: 'PARIS' })).toBe('PARIS')
    expect(placeName({ label: 'PARIS', nickname: 'Paris trip' })).toBe('Paris trip')
    expect(placeName({ label: 'PARIS', nickname: '  ' })).toBe('PARIS')
  })

  it('cleans a nickname: ends trimmed, spaces folded, length capped', () => {
    expect(cleanNickname('  a \t b\n c  ')).toBe('a b c')
    expect(cleanNickname('y'.repeat(100))).toHaveLength(NICKNAME_MAX)
    expect(cleanNickname('   ')).toBe('')
  })
})
