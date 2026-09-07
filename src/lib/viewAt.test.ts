import { describe, expect, it } from 'vitest'
import { xyzToCoord } from 'cyberspace-core'
import { parseViewAt } from './viewAt'

describe('parseViewAt', () => {
  it('reads three decimal axis values', () => {
    const v = parseViewAt('19342813102987152433021963, 19342813150131325755198912 19342813074366675019965142', 0)!
    expect(v.position.x).toBe(19342813102987152433021963n)
    expect(v.position.z).toBe(19342813074366675019965142n)
    expect(v.plane).toBe(0)
    expect(v.label).toBe('19342…21963, 19342…98912, 19342…65142')
  })
  it('reads a 64-hex coordinate with its plane', () => {
    const coord = xyzToCoord(5n, 6n, 7n, 1).toString(16).padStart(64, '0')
    const v = parseViewAt(coord, 0)!
    expect(v.position).toEqual({ x: 5n, y: 6n, z: 7n })
    expect(v.plane).toBe(1)
  })
  it('refuses anything else', () => {
    expect(parseViewAt('1, 2', 0)).toBeNull()
    expect(parseViewAt('a, b, c', 0)).toBeNull()
    expect(parseViewAt(`${(1n << 85n).toString()}, 0, 0`, 0)).toBeNull()
  })
})
