/**
 * The bench's dead zone: a wide slop for a finger, a narrow one for a mouse,
 * and a hold that keeps the orbit still until the press has left the zone.
 */
import { describe, expect, it } from 'vitest'
import { COARSE_SLOP_PX, FINE_SLOP_PX, Hold, noteGesture, slopFor, tapSlop } from '../deadZone'

describe('slopFor', () => {
  it('gives a finger and a pen the wide zone and a mouse the narrow one', () => {
    expect(slopFor('touch')).toBe(COARSE_SLOP_PX)
    expect(slopFor('pen')).toBe(COARSE_SLOP_PX)
    expect(slopFor('mouse')).toBe(FINE_SLOP_PX)
  })

  it('treats an unknown pointer as a finger, the safer guess for a tap', () => {
    expect(slopFor(undefined)).toBe(COARSE_SLOP_PX)
    expect(slopFor('')).toBe(COARSE_SLOP_PX)
  })

  it('is wider for a finger than the 8 px that lost taps on a phone', () => {
    expect(COARSE_SLOP_PX).toBeGreaterThan(8)
    expect(FINE_SLOP_PX).toBe(8)
  })
})

describe('tapSlop', () => {
  it('follows the pointer that pressed last', () => {
    noteGesture('mouse')
    expect(tapSlop()).toBe(FINE_SLOP_PX)
    noteGesture('touch')
    expect(tapSlop()).toBe(COARSE_SLOP_PX)
  })
})

describe('Hold', () => {
  it('holds inside the zone and releases for good once the press leaves it', () => {
    const h = new Hold(() => 20)
    h.down(100, 100)
    expect(h.holding).toBe(true)
    expect(h.move(105, 112)).toBe(true) // 13 px: a rolling thumb, still a tap
    expect(h.move(100, 119)).toBe(true) // 19 px: still inside
    expect(h.move(100, 121)).toBe(false) // 21 px: an orbit from here
    expect(h.move(100, 100)).toBe(false) // back at the start: released stays released
    expect(h.holding).toBe(false)
  })

  it('does nothing for a move without a press, and ends on up', () => {
    const h = new Hold(() => 20)
    expect(h.move(5, 5)).toBe(false)
    h.down(0, 0)
    h.up()
    expect(h.holding).toBe(false)
    expect(h.move(1, 1)).toBe(false)
  })

  it('reads the slop at move time, so the pointer type of the press decides', () => {
    let slop = 8
    const h = new Hold(() => slop)
    h.down(0, 0)
    expect(h.move(0, 10)).toBe(false) // a mouse: 10 px is already an orbit
    slop = 20
    h.down(0, 0)
    expect(h.move(0, 10)).toBe(true) // a finger: 10 px is a wobble
  })
})
