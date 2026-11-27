/**
 * restAboveFloor.test.tsx: a coin, an item's token and a letter rest over
 * the floor at their place rather than through it (owner, 2026-11-27, of a
 * coin at its true size: "the B is cut off by the ground").
 *
 * The floor under a place is the level of the place itself: a floor built at
 * that height lies there and a chest's base stands there (lib/restLift.ts).
 * Each of these was drawn about its place, so that floor cut its lower half.
 * Here each is drawn at its place at 2^0 and 2^1 and run through many
 * moments of its turn and its bob: its lowest drawn point always stands over
 * the place's level, and so over the floor of its gibson too. Its place is
 * unchanged; only where it is drawn is lifted.
 *
 * Run in a real R3F root (test/r3fRoot.ts): real three objects and frames,
 * measured in the world as drawn.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
// Words are troika's, which fetches a font: a plain group stands in, at the label's place and size.
vi.mock('@react-three/drei', async () => {
  const { createElement: h, forwardRef } = await import('react')
  return { Text: forwardRef((props: { position?: unknown }, ref) => h('group', { name: 'text', ref, position: props.position })) }
})

import { createElement } from 'react'
import { Box3, Matrix4, Vector3, type BufferGeometry, type InstancedMesh, type Object3D } from 'three'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { REST_HOVER, restLift } from '../../lib/restLift'
import { useCyberspace } from '../../store/useCyberspace'
import { CoinMark, coinSide, COIN_BOB, COIN_GLYPH_LOW, COIN_LIFT, COIN_REACH, NoteItem, noteBoxSide } from '../WorldMessages'
import { ItemToken, TOKEN_BOB, TOKEN_LIFT, TOKEN_LOW, TOKEN_OUTLINE } from '../ItemToken'
import { LetterField, LETTER_GIBSONS, LETTER_LIFT, LETTER_LOW } from '../LetterField'

let r: R3fRoot | null = null
afterEach(async () => {
  await r?.unmount()
  r = null
})

/** A place off the origin, so nothing passes by being drawn about zero. */
const PLACE: [number, number, number] = [3, -2, 5]
/** Frames run (a sixtieth of a second each): many moments of every turn and bob. */
const FRAMES = 720
const EVERY = 4

function named(name: string): Object3D[] {
  const out: Object3D[] = []
  r!.state().scene.traverse((o) => { if (o.name === name) out.push(o) })
  return out
}

/** The lowest point of what `o` draws, in the world. */
function lowest(o: Object3D): number {
  o.updateWorldMatrix(true, true)
  return new Box3().expandByObject(o, true).min.y
}

/** The lowest of the points an instanced mesh draws for instance `i`, in the world. */
function lowestInstance(mesh: InstancedMesh, i = 0): number {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  mesh.updateWorldMatrix(true, false)
  m.premultiply(mesh.matrixWorld)
  const pos = (mesh.geometry as BufferGeometry).getAttribute('position')
  const v = new Vector3()
  let low = Infinity
  for (let k = 0; k < pos.count; k++) low = Math.min(low, v.fromBufferAttribute(pos, k).applyMatrix4(m).y)
  return low
}

/** Runs the frames, handing `look` each sampled moment, and the lowest it saw. */
async function sweep(look: () => number): Promise<{ low: number; high: number }> {
  let low = Infinity, high = -Infinity
  for (let f = 0; f < FRAMES; f++) {
    await r!.frame()
    if (f % EVERY !== 0) continue
    const y = look()
    low = Math.min(low, y)
    high = Math.max(high, y)
  }
  return { low, high }
}

describe('restLift', () => {
  it('is the reach under the middle, the bob and the hover, for a thing one across', () => {
    expect(restLift(0.5, 0.03)).toBeCloseTo(0.5 + 0.03 + REST_HOVER, 12)
    expect(REST_HOVER).toBeGreaterThan(0)
    // A small hover: under a fifth of the thing.
    expect(REST_HOVER).toBeLessThan(0.2)
  })
})

describe('a coin rests over its floor', () => {
  it('reaches under its middle by its diamond’s tip, which its ₿ never passes', () => {
    // The diamond is one tip to tip: every point of it within half of that of its middle, however it tumbles.
    expect(COIN_REACH).toBeGreaterThanOrEqual(0.5)
    // The ₿ as measured in the world font, at the coin's share of it (31 in 40).
    expect(COIN_GLYPH_LOW * (31 / 40)).toBeLessThanOrEqual(COIN_REACH)
    expect(COIN_LIFT).toBeCloseTo(COIN_REACH + COIN_BOB + REST_HOVER, 12)
  })

  for (const scaleExp of [0, 1]) {
    it(`at 2^${scaleExp}: its diamond and its ₿, at every turn and moment of its bob, stand over its place’s level and its gibson’s floor`, async () => {
      useCyberspace.setState({ scaleExp })
      const side = coinSide(scaleExp)
      r = await r3fRoot({ width: 375, height: 812 })
      await r.render(createElement(CoinMark, { id: 'c1', kind: 'coin', at: PLACE, onTap: () => {} }))
      const cam = r.state().camera
      cam.position.set(PLACE[0], PLACE[1] + 2 * side, PLACE[2] + 6 * side)
      cam.lookAt(...PLACE)
      cam.updateMatrixWorld(true)
      const [diamond] = named('coin-mark')
      const [glyph] = named('text')
      expect(diamond && glyph).toBeTruthy()
      // The ₿'s lowest ink: its middle less the measured reach, at its drawn size (one local unit is its line height).
      const glyphLow = (): number => glyph.getWorldPosition(new Vector3()).y - COIN_GLYPH_LOW * glyph.getWorldScale(new Vector3()).y
      const d = await sweep(() => lowest(diamond))
      const g = await sweep(glyphLow)
      const floor = PLACE[1]
      for (const low of [d.low, g.low]) {
        // A little over the level of its place, at the bottom of the bob: never on it, never through it.
        expect(low).toBeGreaterThan(floor + 0.5 * REST_HOVER * side)
        expect(low).toBeGreaterThanOrEqual(floor + REST_HOVER * side - 1e-6)
        // So over its gibson's floor, half a gibson lower, by more.
        expect(low).toBeGreaterThan(floor - side / 2)
      }
      // And it bobs, gently.
      expect(d.high - d.low).toBeGreaterThan(0)
    })
  }

  it('is still drawn about the same place: the lift is how it is drawn, not where it is', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    r = await r3fRoot({ width: 375, height: 812 })
    await r.render(createElement(CoinMark, { id: 'c1', kind: 'spent', at: PLACE, onTap: () => {} }))
    await r.frame()
    const [diamond] = named('coin-mark')
    const centre = new Box3().expandByObject(diamond, true).getCenter(new Vector3())
    expect(centre.x).toBeCloseTo(PLACE[0], 6)
    expect(centre.z).toBeCloseTo(PLACE[2], 6)
    // Straight over its place, by the lift and at most the bob.
    expect(Math.abs(centre.y - (PLACE[1] + COIN_LIFT))).toBeLessThanOrEqual(COIN_BOB + 1e-6)
  })
})

describe('an item’s token rests over its floor', () => {
  it('lifts by its lowest drawn point (its edge bands stand a little outside its outline), its bob and the hover', () => {
    expect(TOKEN_LOW).toBeGreaterThanOrEqual(-Math.min(...TOKEN_OUTLINE.map((p) => p[1])))
    expect(TOKEN_LIFT).toBeCloseTo(TOKEN_LOW + TOKEN_BOB + REST_HOVER, 12)
  })

  for (const scaleExp of [0, 1]) {
    it(`at 2^${scaleExp}: its tag and its ring, at every turn and moment of its bob, stand over its place’s level`, async () => {
      useCyberspace.setState({ scaleExp })
      const side = noteBoxSide(scaleExp)
      r = await r3fRoot()
      await r.render(createElement(ItemToken, { id: 'k1', at: PLACE, side, colour: '#66ccff' }))
      const [token] = named('item-token')
      const { low } = await sweep(() => lowest(token))
      expect(low).toBeGreaterThan(PLACE[1] + 0.5 * REST_HOVER * side)
      expect(low).toBeGreaterThanOrEqual(PLACE[1] + REST_HOVER * side - 1e-6)
    })
  }
})

describe('a letter rests over its floor', () => {
  for (const scaleExp of [0, 1]) {
    it(`at 2^${scaleExp}: its paper and its folds, at every turn and moment of its bob, stand over its place’s level`, async () => {
      useCyberspace.setState({ scaleExp })
      const width = noteBoxSide(scaleExp) * LETTER_GIBSONS
      r = await r3fRoot()
      await r.render(createElement('group', null,
        createElement(LetterField),
        createElement(NoteItem, { w: { key: 'n1', text: 'hello', mine: true, author: '', centre: PLACE }, birth: undefined, onTap: () => {} }),
      ))
      const [paper] = named('letter-paper') as InstancedMesh[]
      const [folds] = named('letter-fold-lines')
      expect(paper && folds).toBeTruthy()
      const p = await sweep(() => lowestInstance(paper))
      const f = await sweep(() => lowest(folds))
      for (const low of [p.low, f.low]) {
        expect(low).toBeGreaterThan(PLACE[1] + 0.5 * REST_HOVER * width)
        expect(low).toBeGreaterThanOrEqual(PLACE[1] + REST_HOVER * width - 1e-6)
      }
      // The lift is the measured reach, the bob and the hover: no more than that over its place.
      expect(p.low - PLACE[1]).toBeLessThan((REST_HOVER + 0.08) * width)
      expect(LETTER_LIFT).toBeGreaterThan(LETTER_LOW)
    })
  }
})
