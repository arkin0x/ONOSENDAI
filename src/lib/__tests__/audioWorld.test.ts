/**
 * audioWorld.test.ts: hearing hidden audio where it is hidden (DECK-0007
 * §4, §5). The camera's scene offset turns back into gibsons on the right
 * cyberspace axes at every view and zoom, so the fade is the same in
 * gibsons whatever the scale; loops sound while heard and let go after a
 * while silent; one-shots fire on entry, once or every time; walk-only
 * items are silent outside WALK, trigger included; nothing without
 * autoplay sounds; TV's music steps down while any of it is heard.
 */

import { describe, expect, it } from 'vitest'
import { itemCentre, type Position, type ViewAxes } from '../space'
import { sourceLocal, type AudioItem } from '../audioItem'
import { DUCKED, QUIET_MS, freshMemory, hearSource, listenerLocal, planWorld, shouldDuck, type WorldSource } from '../audioWorld'

const FRONT: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }
const TURNED: ViewAxes = { right: { axis: 'z', dir: -1 }, up: { axis: 'x', dir: 1 }, out: { axis: 'y', dir: -1 } }

const H = 6
const at: Position = { x: (1n << 70n) + 64n * 9n + 20n, y: (1n << 71n) + 64n * 3n + 32n, z: (1n << 69n) + 64n * 5n + 40n }
const base = { x: (at.x >> 6n) << 6n, y: (at.y >> 6n) << 6n, z: (at.z >> 6n) << 6n }

/** Where a cyberspace point (gibsons, with a fraction) is drawn: itemCentre is the gibson's centre, so a point is that less half a gibson. */
function sceneOf(p: Position, origin: Position, scaleExp: number, axes: ViewAxes): [number, number, number] {
  return itemCentre(p, origin, scaleExp, axes)
}

describe('the camera is the ears, in the source region\'s gibsons', () => {
  for (const [name, axes] of [['front', FRONT], ['turned and flipped', TURNED]] as const) {
    for (const scaleExp of [0, 3, 6, 9]) {
      it(`a listener a few gibsons off reads as exactly that, ${name} view at 2^${scaleExp}`, () => {
        const origin = { x: (at.x >> BigInt(scaleExp)) << BigInt(scaleExp), y: (at.y >> BigInt(scaleExp)) << BigInt(scaleExp), z: (at.z >> BigInt(scaleExp)) << BigInt(scaleExp) }
        const ear: Position = { x: at.x + 7n, y: at.y - 3n, z: at.z + 11n }
        const local = listenerLocal(sceneOf(ear, origin, scaleExp, axes), sceneOf(at, origin, scaleExp, axes), sourceLocal(at, H), axes, scaleExp)
        // Both are drawn at their gibson's centre, so the ear reads as its own
        // gibson's centre, to the scene's own precision (lib/space cellDelta
        // keeps 1e-4 of a cell, so 2^scaleExp / 10^4 gibsons, for each of the two).
        const want = [Number(ear.x - base.x) + 0.5, Number(ear.y - base.y) + 0.5, Number(ear.z - base.z) + 0.5]
        local.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThanOrEqual(2 * 2 ** scaleExp * 1e-4 + 1e-9))
      })
    }
  }
})

const loop: AudioItem = {
  title: 'water', about: '', url: 'https://b.test/' + 'ab'.repeat(32), mime: 'audio/mpeg', hash: 'ab'.repeat(32), originalHash: '', size: 1,
  keyHex: 'ef'.repeat(32), nonceHex: '01'.repeat(12), autoplay: true, loop: true, retrigger: 'once', walkOnly: false, fade: 4,
}
const shot: AudioItem = { ...loop, loop: false }

describe('how one source is heard', () => {
  const src = sourceLocal(at, H)
  it('full in the sphere, fading to the wall, silent outside the region', () => {
    expect(hearSource(loop, at, H, src, false)).toEqual({ gain: 1, inSphere: true })
    const off = hearSource(loop, at, H, [src[0] + 8, src[1], src[2]], false)
    expect(off.inSphere).toBe(false)
    expect(off.gain).toBeGreaterThan(0)
    expect(off.gain).toBeLessThan(1)
    expect(hearSource(loop, at, H, [-1, src[1], src[2]], false).gain).toBe(0)
  })
  it('walk only: nothing at all outside first person, in the sphere or not', () => {
    const walkOnly = { ...loop, walkOnly: true }
    expect(hearSource(walkOnly, at, H, src, false)).toEqual({ gain: 0, inSphere: false })
    expect(hearSource(walkOnly, at, H, src, true)).toEqual({ gain: 1, inSphere: true })
  })
})

const source = (key: string, audio: Pick<AudioItem, 'autoplay' | 'loop' | 'retrigger' | 'walkOnly'>, gain: number, inSphere = gain === 1): WorldSource => ({ key, lineage: `L${key}`, audio, heard: { gain, inSphere } })

describe('one tick of the world', () => {
  it('a loop starts when heard, follows how loud it is, and lets go only after a while silent', () => {
    const m = freshMemory()
    const never = () => false
    expect(planWorld([source('a', loop, 0)], new Set(), never, 0, m).start).toEqual([])
    const p1 = planWorld([source('a', loop, 0.4)], new Set(), never, 100, m)
    expect(p1.start).toEqual([{ key: 'a', oneShot: false, lineage: 'La' }])
    expect(p1.gains.get('a')).toBe(0.4)
    const playing = new Set(['a'])
    expect(planWorld([source('a', loop, 0)], playing, never, 200, m).stop).toEqual([])
    expect(planWorld([source('a', loop, 0)], playing, never, 200 + QUIET_MS - 1, m).stop).toEqual([])
    // Heard again before it let go: the silence starts over.
    expect(planWorld([source('a', loop, 0.2)], playing, never, 200 + QUIET_MS, m).gains.get('a')).toBe(0.2)
    planWorld([source('a', loop, 0)], playing, never, 3000, m)
    expect(planWorld([source('a', loop, 0)], playing, never, 3000 + QUIET_MS, m).stop).toEqual(['a'])
  })

  it('a one-shot fires on entering its sphere, and once mode does not fire again', () => {
    const m = freshMemory()
    const fired = new Set<string>()
    const rec = (l: string) => fired.has(l)
    expect(planWorld([source('s', shot, 0.5, false)], new Set(), rec, 0, m).start).toEqual([])
    expect(planWorld([source('s', shot, 1, true)], new Set(), rec, 100, m).start).toEqual([{ key: 's', oneShot: true, lineage: 'Ls' }])
    fired.add('Ls') // marked as it sounds
    // Playing: its loudness follows you, out to silence, and it plays on.
    const playing = new Set(['s'])
    const out = planWorld([source('s', shot, 0, false)], playing, rec, 200, m)
    expect(out.stop).toEqual([])
    expect(out.gains.get('s')).toBe(0)
    // Ended, then back in: once mode stays quiet.
    planWorld([source('s', shot, 0.3, false)], new Set(), rec, 300, m)
    expect(planWorld([source('s', shot, 1, true)], new Set(), rec, 400, m).start).toEqual([])
    // RESET TRIGGER: out and in again plays it once more.
    fired.delete('Ls')
    planWorld([source('s', shot, 0.3, false)], new Set(), rec, 500, m)
    expect(planWorld([source('s', shot, 1, true)], new Set(), rec, 600, m).start).toHaveLength(1)
  })

  it('a one-shot that has not sounded yet (waiting for a tap) stops when the listener leaves its sphere, so its trigger is not spent unheard', () => {
    const m = freshMemory()
    expect(planWorld([source('s', shot, 1, true)], new Set(), () => false, 0, m).start).toHaveLength(1)
    const waiting = new Set(['s'])
    expect(planWorld([source('s', shot, 1, true)], waiting, () => false, 100, m, waiting).stop).toEqual([])
    expect(planWorld([source('s', shot, 0.4, false)], waiting, () => false, 200, m, waiting).stop).toEqual(['s'])
    // Once it sounds, it plays on wherever you go.
    expect(planWorld([source('s', shot, 0, false)], new Set(['s']), () => false, 300, m, new Set()).stop).toEqual([])
  })

  it('automatic mode fires on every entry; an entry while it still plays does not start it over', () => {
    const m = freshMemory()
    const auto = { ...shot, retrigger: 'auto' as const }
    const never = () => false
    expect(planWorld([source('s', auto, 1, true)], new Set(), never, 0, m).start).toHaveLength(1)
    planWorld([source('s', auto, 0.2, false)], new Set(['s']), never, 100, m)
    expect(planWorld([source('s', auto, 1, true)], new Set(['s']), never, 200, m).start).toEqual([])
    planWorld([source('s', auto, 0.2, false)], new Set(), never, 300, m)
    expect(planWorld([source('s', auto, 1, true)], new Set(), never, 400, m).start).toHaveLength(1)
  })

  it('no trigger fires outside WALK for a walk-only one-shot (its sphere is not entered there)', () => {
    const m = freshMemory()
    const walkOnly = { ...shot, walkOnly: true }
    const heardOut = hearSource(walkOnly, at, H, sourceLocal(at, H), false)
    expect(planWorld([{ key: 'w', lineage: 'Lw', audio: walkOnly, heard: heardOut }], new Set(), () => false, 0, m).start).toEqual([])
    const heardIn = hearSource(walkOnly, at, H, sourceLocal(at, H), true)
    expect(planWorld([{ key: 'w', lineage: 'Lw', audio: walkOnly, heard: heardIn }], new Set(), () => false, 100, m).start).toHaveLength(1)
  })

  it('nothing without autoplay sounds here, loop or not; and what leaves the world stops', () => {
    const m = freshMemory()
    expect(planWorld([source('a', { ...loop, autoplay: false }, 1), source('b', { ...shot, autoplay: false }, 1)], new Set(), () => false, 0, m).start).toEqual([])
    expect(planWorld([], new Set(['gone']), () => false, 0, m).stop).toEqual(['gone'])
  })
})

describe('a file is fetched only inside its region', () => {
  it('a source the ears are outside of, however near its wall, is never started, so its file is never asked for', () => {
    const src = sourceLocal(at, H)
    // Just past the region's low x wall, a gibson from the source's own wall.
    const outside = hearSource({ ...loop, fade: 40 }, at, H, [-0.01, src[1], src[2]], false)
    expect(outside.gain).toBe(0)
    expect(planWorld([{ key: 'o', lineage: 'Lo', audio: loop, heard: outside }], new Set(), () => false, 0, freshMemory()).start).toEqual([])
    const shotOutside = hearSource(shot, at, H, [-0.01, src[1], src[2]], true)
    expect(planWorld([{ key: 'o', lineage: 'Lo', audio: shot, heard: shotOutside }], new Set(), () => false, 0, freshMemory()).start).toEqual([])
  })
})

describe('the loudest few', () => {
  it('only the loudest MAX_VOICES start; the rest wait silent, and a loop pushed out lets go after a while', () => {
    const m = freshMemory()
    const gains = [0.9, 0.2, 0.7, 0.5, 0.1, 0.8]
    const sources = gains.map((g, i) => source(`s${i}`, loop, g))
    const p = planWorld(sources, new Set(), () => false, 0, m, new Set(), 4)
    expect(p.start.map((x) => x.key).sort()).toEqual(['s0', 's2', 's3', 's5'])
    // s1 comes up loudest: s3 (now fifth) is heard as silent, and lets go after QUIET_MS.
    const playing = new Set(['s0', 's2', 's3', 's5'])
    const louder = sources.map((s) => (s.key === 's1' ? { ...s, heard: { gain: 0.95, inSphere: false } } : s))
    const q = planWorld(louder, playing, () => false, 100, m, new Set(), 4)
    expect(q.start.map((x) => x.key)).toEqual(['s1'])
    expect(q.gains.get('s3')).toBe(0)
    expect(planWorld(louder, playing, () => false, 100 + QUIET_MS, m, new Set(), 4).stop).toContain('s3')
  })

  it('a one-shot that is neither playing nor firing takes no slot: the loops get all four', () => {
    const m = freshMemory()
    const fired = () => true
    const sources = [source('quiet-shot', shot, 1, true), ...[0, 1, 2, 3].map((i) => source(`l${i}`, loop, 0.5))]
    // The one-shot already fired here (once mode): it will not sound, so it does not count.
    planWorld(sources, new Set(), fired, 0, m, new Set(), 4)
    const p = planWorld(sources.map((s) => (s.key === 'quiet-shot' ? s : s)), new Set(), fired, 100, m, new Set(), 4)
    expect(p.start.map((x) => x.key).sort()).toEqual(['l0', 'l1', 'l2', 'l3'])
  })

  it('a one-shot that fires while out of the loudest few does not start', () => {
    const m = freshMemory()
    const p = planWorld([source('a', loop, 1), source('b', shot, 1, true)], new Set(), () => false, 0, m, new Set(), 1)
    expect(p.start.map((x) => x.key)).toEqual(['a'])
  })
})

describe('TV music steps down', () => {
  it('while any hidden audio is heard above a whisper, or a card plays', () => {
    expect(DUCKED).toBeLessThan(1)
    expect(shouldDuck([0, 0.01], false)).toBe(false)
    expect(shouldDuck([0, 0.4], false)).toBe(true)
    expect(shouldDuck([], true)).toBe(true)
  })
})
