/**
 * hiddenCohesion.test.tsx: the letter, an item's token and a sound under the
 * one rulebook (owner ruling, 2026-11-27, option A of the hidden-item
 * cohesion page): the same outline width and colours, the same ring opacity
 * per state, a NEW pulse on all three and only when new, and a sound that is
 * its layer slices with no box round them.
 *
 * Run in a real R3F root (test/r3fRoot.ts): real three objects and frames.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { Color, Matrix4, Vector3, type InstancedBufferAttribute, type InstancedMesh, type Mesh, type Object3D } from 'three'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { LetterField, dropLetter, putLetter } from '../LetterField'
import { ItemToken, cardOutline } from '../ItemToken'
import { SoundMark } from '../SoundMark'
import { atlasIndex } from '../glyphAtlas'
import { LEVEL_LINES, OUTLINE_PX, OUTLINE_READ, OUTLINE_UNREAD, RING_OPACITY, SLICES, type HiddenState } from '../../lib/hiddenLook'
import { RING_GLYPHS } from '../../lib/glyphRing'

;(globalThis as { window?: unknown }).window ??= globalThis

let r: R3fRoot | null = null
afterEach(async () => {
  await r?.unmount()
  r = null
  delete (globalThis as { matchMedia?: unknown }).matchMedia
})

function named<T = Object3D>(name: string): T {
  let out: T | undefined
  r!.state().scene.traverse((o) => { if (o.name === name) out = o as unknown as T })
  expect(out, name).toBeDefined()
  return out!
}
const hex = (c: Color): string => `#${c.getHexString()}`
const reducedMotion = (): void => { (globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: q.includes('reduce'), addEventListener: () => {}, removeEventListener: () => {} }) }

describe('the letter', () => {
  const keys = ['l-new', 'l-unread', 'l-read']
  afterEach(() => { for (const k of keys) dropLetter(k) })

  it('pulses only while new, and its ring takes its state’s opacity', async () => {
    putLetter({ key: 'l-new', centre: [-3, 0, 0], width: 1, colour: '#ffa35e', initial: atlasIndex('A'), broken: false, fresh: true })
    putLetter({ key: 'l-unread', centre: [0, 0, 0], width: 1, colour: '#ffa35e', initial: atlasIndex('A'), broken: false })
    putLetter({ key: 'l-read', centre: [3, 0, 0], width: 1, colour: '#ffa35e', initial: atlasIndex('A'), broken: true })
    r = await r3fRoot()
    await r.render(createElement(LetterField))
    await r.frame()
    expect(named<InstancedMesh>('letter-pulses').count).toBe(1)
    const opacity = named<Mesh>('letter-rings').geometry.getAttribute('aOpacity') as InstancedBufferAttribute
    const want = [RING_OPACITY.new, RING_OPACITY.unread, RING_OPACITY.read]
    for (let i = 0; i < 3; i++) for (let g = 0; g < RING_GLYPHS; g++) expect(opacity.getX(i * RING_GLYPHS + g)).toBeCloseTo(want[i], 6)
    // The outline: one width for all, each letter in its state's colour.
    const lines = named<Mesh & { material: LineMaterial }>('letter-fold-lines')
    expect(lines.material.linewidth).toBe(OUTLINE_PX)
  })
})

describe('an item’s token', () => {
  async function mountToken(state: HiddenState, id = 'k1'): Promise<void> {
    r = await r3fRoot()
    await r.render(createElement(ItemToken, { id, at: [0, 0, 0], side: 1, colour: '#ffa35e', initial: atlasIndex('A'), state }))
    await r.frame()
  }

  it('is outlined in the rulebook’s width, bright until opened and steel after; its ring dims when read', async () => {
    await mountToken('unread')
    const lines = named<Mesh & { material: LineMaterial }>('item-token-lines')
    expect(lines.material.linewidth).toBe(OUTLINE_PX)
    expect(hex(lines.material.color)).toBe(OUTLINE_UNREAD)
    expect(named<Mesh & { material: LineMaterial }>('item-token-ring').material.opacity).toBeCloseTo(RING_OPACITY.unread, 6)
    await r!.unmount()
    await mountToken('read')
    expect(hex(named<Mesh & { material: LineMaterial }>('item-token-lines').material.color)).toBe(OUTLINE_READ)
    expect(named<Mesh & { material: LineMaterial }>('item-token-ring').material.opacity).toBeCloseTo(RING_OPACITY.read, 6)
  })

  it('pulses only while new', async () => {
    await mountToken('new')
    expect(named<Mesh>('item-token-pulse').visible).toBe(true)
    await r!.unmount()
    await mountToken('unread')
    expect(named<Mesh>('item-token-pulse').visible).toBe(false)
  })

  it('wears its maker’s seal and initial and a notch code of its own, never a box icon', async () => {
    await mountToken('unread')
    named('item-token-seal')
    named('item-token-initial')
    expect(cardOutline('k1')).not.toEqual(cardOutline('another item'))
  })

  it('its ring faces the camera while the card turns', async () => {
    await mountToken('unread')
    const cam = r!.state().camera
    cam.position.set(4, 2, 6); cam.lookAt(0, 0, 0); cam.updateMatrixWorld()
    await r!.frame()
    const ring = named<Object3D>('item-token-ring')
    ring.updateWorldMatrix(true, false)
    const normal = new Vector3(0, 0, 1).transformDirection(ring.matrixWorld)
    const toward = new Vector3(0, 0, 1).applyQuaternion(cam.quaternion)
    expect(normal.dot(toward)).toBeCloseTo(1, 6)
  })
})

describe('a sound', () => {
  async function mountSound(state: HiddenState, playing: boolean): Promise<void> {
    r = await r3fRoot()
    await r.render(createElement(SoundMark, { id: 's1', at: [0, 0, 0], side: 1, state, playing }))
    await r.frame()
  }
  const sliceRadius = (i: number): number => { const m = new Matrix4(); named<InstancedMesh>('sound-slices').getMatrixAt(i, m); return new Vector3().setFromMatrixScale(m).x }

  it('is its layer slices and its level lines, with no box round them', async () => {
    await mountSound('unread', false)
    expect(named<InstancedMesh>('sound-slices').count).toBe(SLICES)
    expect(named<InstancedMesh>('level-lines').count).toBe(LEVEL_LINES)
    let boxes = 0
    r!.state().scene.traverse((o) => { if ((o as { type: string }).type === 'LineSegments') boxes++ })
    expect(boxes).toBe(0)
    expect(named<Mesh & { material: LineMaterial }>('sound-slice-lines').material.linewidth).toBe(OUTLINE_PX)
  })

  it('its slices swell with the sound while it plays', async () => {
    await mountSound('unread', true)
    const seen = new Set<string>()
    for (let f = 0; f < 12; f++) { await r!.frame(); seen.add(sliceRadius(3).toFixed(4)) }
    expect(seen.size).toBeGreaterThan(3)
  })

  it('pulses only while new; read, its outline is steel', async () => {
    await mountSound('new', false)
    expect(named<Mesh>('sound-pulse').visible).toBe(true)
    await r!.unmount()
    await mountSound('read', false)
    expect(named<Mesh>('sound-pulse').visible).toBe(false)
    expect(hex(named<Mesh & { material: LineMaterial }>('sound-slice-lines').material.color)).toBe(OUTLINE_READ)
  })

  it('with reduced motion holds still, quiet or playing', async () => {
    reducedMotion()
    for (const playing of [false, true]) {
      await mountSound('unread', playing)
      const before = sliceRadius(3)
      const root = named<Object3D>('sound-mark')
      const y = root.position.y
      for (let f = 0; f < 20; f++) await r!.frame()
      expect(sliceRadius(3)).toBe(before)
      expect(root.position.y).toBe(y)
      await r!.unmount()
      r = null
    }
  })
})
