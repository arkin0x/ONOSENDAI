/**
 * itemModel.test.ts: the SNO an item wears and how it moves (arkinox,
 * 2026-10-21): the tags, written and read; the box, swept through each
 * motion, rounded up to whole gibsons and cut at the region's walls; the two
 * turning speeds; and the cube an item falls back to.
 */
import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { flatten, fromPayload, newShard, toPayload, vertexAt, type ShardModel } from 'sno-core/shards'
import { keyInnerTemplate, keyItemOf, readItem, editedTemplate, type KeyItem } from '../hidden'
import { forgeKey } from '../chests'
import { regionBox } from '../clip'
import { renderPose, viewPose } from '../pose'
import type { ViewAxes } from '../space'
import {
  ANIMATE_TAG, GOLDEN, MODEL_TAG, SPIN_RAD_PER_S, animationOf, boxInRegion, bobAmplitude, extentOf, isModelAddress, itemBoxSize,
  modelOf, modelScale, modelTags, motionAt, phaseOf, spinRates, sweptHalf, trueScale, turnBox, wholeGibsons, type ItemAnimation,
} from '../itemModel'
import { modelFromPayload } from '../../hooks/useItemModel'
import { itemMarkShape } from '../../scene/WorldMessages'

const PK = 'a'.repeat(64)
const ADDRESS = `33331:${PK}:6b374774-f65b-47c0-8bf3-e870c274be44`
const at = { x: 1000n, y: 2000n, z: 3000n }
const hider = generateSecretKey()

/** A box-shaped model of w by h by d model units, centred on its origin, its eight corners its only vertices. */
function boxModel(w: number, h: number, d: number, unit = 0): ShardModel {
  const s = newShard('Crate')
  const T = 120
  const vertices = []
  for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, h / 2]) for (const z of [-d / 2, d / 2]) vertices.push(vertexAt([x * T, y * T, z * T], [1, 1, 1]))
  return { ...s, unit, vertices, mode: 'points' }
}

function extentOfModel(s: ShardModel) {
  const e = extentOf(flatten(s).positions, null)
  if (!e) throw new Error('empty')
  return e
}

describe('the model and animate tags', () => {
  it('writes the address, an optional relay hint, and the motions in a fixed order, each once', () => {
    expect(modelTags({ address: ADDRESS }, undefined)).toEqual([[MODEL_TAG, ADDRESS]])
    expect(modelTags({ address: ADDRESS, relay: 'wss://relay.example' }, ['spin-x', 'bob', 'spin-x', 'spin-y'])).toEqual([
      [MODEL_TAG, ADDRESS, 'wss://relay.example'],
      [ANIMATE_TAG, 'bob', 'spin-y', 'spin-x'],
    ])
  })

  it('writes nothing without a model, and no relay hint that is not a ws URL', () => {
    expect(modelTags(undefined, ['bob'])).toEqual([])
    expect(modelTags({ address: 'not an address' }, ['bob'])).toEqual([])
    expect(modelTags({ address: ADDRESS, relay: 'https://example.com' }, [])).toEqual([[MODEL_TAG, ADDRESS]])
  })

  it('reads only a SNO object address: kind 33331, a 64-hex author and a d', () => {
    expect(isModelAddress(ADDRESS)).toBe(true)
    expect(isModelAddress(`30023:${PK}:x`)).toBe(false)
    expect(isModelAddress(`33331:${PK.slice(1)}:x`)).toBe(false)
    expect(isModelAddress(`33331:${PK}:`)).toBe(false)
    expect(isModelAddress(`33331:${PK}:has space`)).toBe(false)
    expect(modelOf([['model', 'garbage'], ['model', ADDRESS, 'wss://r.example']])).toEqual({ address: ADDRESS, relay: 'wss://r.example' })
    expect(modelOf([['model', ADDRESS, 'javascript:alert(1)']])).toEqual({ address: ADDRESS })
    expect(modelOf([['model', 7], 'x', null])).toBeNull()
  })

  it('reads the motions from every animate tag, skipping names it does not know', () => {
    expect(animationOf([['animate', 'spin-x', 'wobble'], ['animate', 'bob', 'bob']])).toEqual(['bob', 'spin-x'])
    expect(animationOf([['animate']])).toEqual([])
  })

  it('rides a key item: written after the picture, read back, and kept by a move', () => {
    const key: KeyItem = { ...forgeKey('Vapor Key'), model: { address: ADDRESS }, animation: ['bob', 'spin-y'] }
    const t = keyInnerTemplate(key, at, 0, 5)
    expect(t.tags.slice(-2)).toEqual([['model', ADDRESS], ['animate', 'bob', 'spin-y']])
    // Everything the item carried before is as it was.
    expect(t.tags).toContainEqual(['secret', key.secretHex])
    expect(t.tags).toContainEqual(['-'])
    const signed = finalizeEvent(t, hider)
    expect(keyItemOf(signed)).toEqual(key)
    expect(readItem(signed)?.key?.model).toEqual({ address: ADDRESS })
    // EDIT carries every tag the moved version had (hidden.ts editedTemplate).
    const moved = editedTemplate(keyInnerTemplate({ ...key, model: undefined, animation: undefined }, { x: 1n, y: 1n, z: 1n }, 0, 9), signed)
    expect(keyItemOf({ ...moved, kind: 3340 })).toMatchObject({ model: { address: ADDRESS }, animation: ['bob', 'spin-y'] })
  })

  it('leaves an item without them exactly as before: no tags written, no fields read', () => {
    const key = forgeKey('Plain')
    const t = keyInnerTemplate(key, at, 0, 5)
    expect(t.tags.some((x) => x[0] === 'model' || x[0] === 'animate')).toBe(false)
    const read = keyItemOf(finalizeEvent(t, hider))!
    expect(read).toEqual(key)
    expect(read).not.toHaveProperty('model')
    expect(read).not.toHaveProperty('animation')
  })

  it('reads no motions on an item with no model: there is nothing to move', () => {
    const t = keyInnerTemplate(forgeKey('Still'), at, 0, 5)
    const read = keyItemOf(finalizeEvent({ ...t, tags: [...t.tags, ['animate', 'bob']] }, hider))!
    expect(read).not.toHaveProperty('animation')
  })
})

describe('the box', () => {
  it('fits a 2x1 model in a 2x1 box: whole gibsons, and no more', () => {
    const e = extentOfModel(boxModel(2, 1, 1))
    expect(itemBoxSize(e, 0, []).gibsons).toEqual([2, 1, 1])
    // Just under a gibson is one; just over is two.
    expect(itemBoxSize(extentOfModel(boxModel(1.5, 0.5, 0.25)), 0, []).gibsons).toEqual([2, 1, 1])
  })

  it('rounds up, never below one gibson, and forgives float noise at a whole number', () => {
    expect(wholeGibsons(0)).toBe(1)
    expect(wholeGibsons(0.2)).toBe(1)
    expect(wholeGibsons(1)).toBe(1)
    expect(wholeGibsons(1.0000000001)).toBe(1)
    expect(wholeGibsons(1.01)).toBe(2)
    expect(wholeGibsons(2.5)).toBe(3)
  })

  it('counts a model unit as 2^unit gibsons', () => {
    expect(itemBoxSize(extentOfModel(boxModel(2, 1, 1, 3)), 3, []).gibsons).toEqual([16, 8, 8])
  })

  it('sweeps X and Z out to the farthest point from the Y axis when it turns about Y', () => {
    const e = extentOfModel(boxModel(2, 1, 1))
    const r = Math.hypot(1, 0.5)
    expect(sweptHalf(e, ['spin-y'])).toEqual([r, 0.5, r])
    expect(itemBoxSize(e, 0, ['spin-y']).gibsons).toEqual([3, 1, 3])
  })

  it('sweeps Y and Z out to the farthest point from the X axis when it turns about X', () => {
    const e = extentOfModel(boxModel(2, 1, 1))
    const r = Math.hypot(0.5, 0.5)
    expect(sweptHalf(e, ['spin-x'])).toEqual([1, r, r])
    expect(itemBoxSize(e, 0, ['spin-x']).gibsons).toEqual([2, 2, 2])
  })

  it('tumbling, holds X and Z to the farthest point from the centre and Y to the farthest from the X axis', () => {
    const e = extentOfModel(boxModel(2, 1, 1))
    const R = Math.hypot(1, 0.5, 0.5)
    expect(sweptHalf(e, ['spin-y', 'spin-x'])).toEqual([R, Math.hypot(0.5, 0.5), R])
    // Checked against the motion itself: no turn of Y then X puts a corner outside.
    const half = sweptHalf(e, ['spin-y', 'spin-x'])
    for (let a = 0; a < 2 * Math.PI; a += 0.1) for (let b = 0; b < 2 * Math.PI; b += 0.1) {
      for (const [x, y, z] of [[1, 0.5, 0.5], [-1, 0.5, -0.5], [1, -0.5, 0.5]]) {
        // Rx(b) then Ry(a), as ItemModel nests them.
        const y1 = y * Math.cos(b) - z * Math.sin(b), z1 = y * Math.sin(b) + z * Math.cos(b)
        const x2 = x * Math.cos(a) + z1 * Math.sin(a), z2 = -x * Math.sin(a) + z1 * Math.cos(a)
        expect(Math.abs(x2)).toBeLessThanOrEqual(half[0] + 1e-9)
        expect(Math.abs(y1)).toBeLessThanOrEqual(half[1] + 1e-9)
        expect(Math.abs(z2)).toBeLessThanOrEqual(half[2] + 1e-9)
      }
    }
  })

  it('adds the bob on Y, both ways', () => {
    const e = extentOfModel(boxModel(1, 1, 1))
    const amp = bobAmplitude([0.5, 0.5, 0.5], ['bob'])
    expect(amp).toBeCloseTo(0.1)
    const { gibsons, amplitude } = itemBoxSize(e, 0, ['bob'])
    expect(amplitude).toBeCloseTo(0.1)
    // 1 + 2 x 0.1 is over a gibson: two tall, one wide.
    expect(gibsons).toEqual([1, 2, 1])
    expect(bobAmplitude([0.5, 0.5, 0.5], ['spin-y'])).toBe(0)
  })

  it('is cut at the walls of its region, and says when it was', () => {
    // A 2^2 region holding a point one gibson in from its low corner: walls at -1.5 and +2.5 about the item's place.
    const region = regionBox({ x: 1n, y: 1n, z: 1n }, 2, 0, { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } })
    expect(region).toEqual({ min: [-1.5, -1.5, -1.5], max: [2.5, 2.5, 2.5] })
    const small = boxInRegion([2, 1, 1], region, 0)
    expect(small.clipped).toBe(false)
    expect(small.box).toEqual({ min: [-1, -0.5, -0.5], max: [1, 0.5, 0.5] })
    const big = boxInRegion([8, 1, 1], region, 0)
    expect(big.clipped).toBe(true)
    expect(big.box).toEqual({ min: [-1.5, -0.5, -0.5], max: [2.5, 0.5, 0.5] })
    // In model units at unit 1: half the gibsons.
    expect(boxInRegion([8, 1, 1], region, 1).box).toEqual({ min: [-0.75, -0.25, -0.25], max: [1.25, 0.25, 0.25] })
  })

  it('carries a region into the model frame through a view turn, which only swaps and flips axes', () => {
    const axes: ViewAxes = { right: { axis: 'z', dir: -1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'x', dir: 1 } }
    const turn = renderPose(viewPose(axes))
    const box = { min: [-1, -2, -3] as [number, number, number], max: [4, 5, 6] as [number, number, number] }
    const there = turnBox(box, turn.elements)
    const back = turnBox(there, turn.clone().invert().elements)
    expect(back.min.map((v) => v + 0)).toEqual(box.min)
    expect(back.max.map((v) => v + 0)).toEqual(box.max)
  })

  it('is drawn at the model\'s true size, or the cube\'s size on screen when that is larger', () => {
    expect(trueScale(3, 0)).toBe(8)
    expect(trueScale(0, 2)).toBe(0.25)
    // A 2-unit box at true scale 1 is 2 render units; at 0.1 units a pixel that is 20 px, under a 24 px floor.
    expect(modelScale(1, 2, 24, 0.1)).toBeCloseTo(1.2)
    expect(modelScale(1, 2, 24, 0.01)).toBe(1)
  })
})

describe('the motion', () => {
  it('turns Y slower than X by the golden ratio when both turn, and each at the same pace alone', () => {
    const both = spinRates(['spin-y', 'spin-x'])
    expect(both.x).toBe(SPIN_RAD_PER_S)
    expect(both.y).toBeLessThan(both.x)
    expect(both.x / both.y).toBeCloseTo(GOLDEN, 12)
    expect(spinRates(['spin-y'])).toEqual({ y: SPIN_RAD_PER_S, x: 0 })
    expect(spinRates(['spin-x'])).toEqual({ y: 0, x: SPIN_RAD_PER_S })
    expect(spinRates(['bob'])).toEqual({ y: 0, x: 0 })
  })

  it('bobs within its amplitude, and holds still for reduced motion', () => {
    const out = { lift: 0, turnY: 0, turnX: 0 }
    const all: ItemAnimation[] = ['bob', 'spin-y', 'spin-x']
    for (let t = 0; t < 20; t += 0.37) {
      motionAt(t, all, 0.3, 0.2, false, out)
      expect(Math.abs(out.lift)).toBeLessThanOrEqual(0.2 + 1e-12)
    }
    motionAt(12, all, 0.3, 0.2, true, out)
    expect(out).toEqual({ lift: 0, turnY: 0, turnX: 0 })
    motionAt(12, ['spin-x'], 0, 0.2, false, out)
    expect(out.lift).toBe(0)
    expect(out.turnY).toBe(0)
    expect(out.turnX).toBeCloseTo(12 * SPIN_RAD_PER_S)
  })

  it('staggers items by their ids', () => {
    expect(phaseOf('a')).not.toBe(phaseOf('b'))
    expect(phaseOf('a')).toBeGreaterThanOrEqual(0)
    expect(phaseOf('a')).toBeLessThan(1)
  })
})

describe('the fallback cube', () => {
  it('is what an item draws while its model loads, if it fails, and when it wears none', () => {
    const axes: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }
    expect(itemMarkShape(null, axes)).toBe('cube')
    expect(itemMarkShape({}, undefined)).toBe('cube')
    expect(itemMarkShape({}, axes)).toBe('model')
  })

  it('is what a model that does not parse, or is sealed, comes to', async () => {
    expect(await modelFromPayload(ADDRESS, null)).toBeNull()
    expect(await modelFromPayload(ADDRESS, 'This object is hidden at a place in cyberspace.')).toBeNull()
    expect(await modelFromPayload(ADDRESS, { v: 2, nonsense: true })).toBeNull()
  })

  it('and a public object comes to a model, measured about its centre', async () => {
    const s = boxModel(2, 1, 1)
    const payload = JSON.parse(JSON.stringify(toPayload(s)))
    expect(fromPayload(payload, ADDRESS)).not.toBeNull()
    const m = await modelFromPayload(ADDRESS, payload)
    expect(m?.extent.half).toEqual([1, 0.5, 0.5])
    expect(m?.extent.centre.map((v) => v + 0)).toEqual([0, 0, 0])
  })
})
