/**
 * itemLineage.test.ts - the identity an item keeps across EDIT (lib/hidden.ts)
 * and the cell a placed item was snapped to (lib/space.ts placedStep).
 */

import { describe, expect, it } from 'vitest'
import { editedTemplate, itemLineage, OBJECT_KIND, SHARD_KIND } from '../hidden'
import { deployPoint, placedStep, type Position } from '../space'

const ev = (id: string, tags: string[][], kind = SHARD_KIND) => ({ id, kind, tags })

describe('itemLineage', () => {
  it('is the item\'s own id until it has been moved', () => {
    expect(itemLineage(ev('aa', [['C', 'c1']]))).toBe('aa')
  })
  it('is the first version\'s id once moved', () => {
    expect(itemLineage(ev('bb', [['C', 'c2'], ['d', 'aa']]))).toBe('aa')
  })
  it('is nothing for an object hidden by reference, whose own d does that', () => {
    expect(itemLineage(ev('cc', [['d', 'x']], OBJECT_KIND))).toBeNull()
  })
})

describe('editedTemplate', () => {
  it('takes the new place, names the first version, and keeps every other tag', () => {
    const previous = ev('bb', [['C', 'old'], ['d', 'aa'], ['q', '33331:pk:x'], ['p', 'pk']])
    const next = { kind: SHARD_KIND, created_at: 9, content: '{}', tags: [['C', 'new']] }
    expect(editedTemplate(next, previous).tags).toEqual([['C', 'new'], ['d', 'aa'], ['q', '33331:pk:x'], ['p', 'pk']])
  })
})

describe('placedStep', () => {
  it('finds the cell a deploy point was snapped to, so EDIT starts on it', () => {
    const cursor: Position = { x: 1000n, y: 2000n, z: 3000n }
    for (const k of [0, 1, 4, 7]) {
      const at = deployPoint(cursor, k, 8)
      const step = placedStep(at, 8)
      expect(deployPoint(at, step, 8)).toEqual(at)
      expect(step).toBeGreaterThanOrEqual(k)
    }
  })
  it('falls back to every gibson for a point no cell centres', () => {
    expect(placedStep({ x: 2n, y: 3n, z: 4n }, 8)).toBe(0)
  })
})
