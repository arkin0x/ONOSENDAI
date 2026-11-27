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
import { Color, Matrix4, Quaternion, Vector3, type InstancedBufferAttribute, type InstancedMesh, type InterleavedBufferAttribute, type Mesh, type Object3D } from 'three'
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
/** A reduced-motion setting that can be switched while mounted, as a person switching it in their system does. */
function switchableMotion(): { set: (on: boolean) => void } {
  const listeners = new Set<() => void>()
  const media = { matches: false, addEventListener: (_: string, l: () => void) => listeners.add(l), removeEventListener: (_: string, l: () => void) => listeners.delete(l) }
  ;(globalThis as { matchMedia?: unknown }).matchMedia = () => media
  return { set: (on) => { media.matches = on; for (const l of listeners) l() } }
}

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

describe('switching reduced motion on while things move', () => {
  afterEach(() => dropLetter('l-still'))

  it('snaps a letter square on, and a sound to its still pose, rather than freezing them mid-motion', async () => {
    const motion = switchableMotion()
    putLetter({ key: 'l-still', centre: [-3, 0, 0], width: 1, colour: '#ffa35e', initial: atlasIndex('A'), broken: false })
    r = await r3fRoot()
    await r.render(createElement('group', null, createElement(LetterField), createElement(SoundMark, { id: 's1', at: [3, 0, 0], side: 1, state: 'unread', playing: true })))
    for (let f = 0; f < 30; f++) await r.frame()
    const { act } = await import('react')
    await act(async () => motion.set(true))
    await r.frame()
    await r.frame()
    const m = new Matrix4()
    named<InstancedMesh>('letter-paper').getMatrixAt(0, m)
    const q = new Quaternion().setFromRotationMatrix(m.extractRotation(m))
    // Square on: no turn about the up axis, only its slight tilt about its own face.
    const facing = new Vector3(0, 0, 1).applyQuaternion(q)
    expect(facing.z).toBeCloseTo(1, 6)
    // The sound's middle slice at its still, playing size, whatever the moment.
    const s = new Matrix4(); named<InstancedMesh>('sound-slices').getMatrixAt(3, s)
    const still = new Vector3().setFromMatrixScale(s).x
    for (let f = 0; f < 10; f++) await r.frame()
    named<InstancedMesh>('sound-slices').getMatrixAt(3, s)
    expect(new Vector3().setFromMatrixScale(s).x).toBe(still)
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

  it('with reduced motion, keeps its ring coloured and its materials when its maker’s initial changes (the npub’s letter, then the profile’s)', async () => {
    reducedMotion()
    r = await r3fRoot()
    const at: [number, number, number] = [0, 0, 0]
    await r.render(createElement(ItemToken, { id: 'k1', at, side: 1, colour: '#ffa35e', initial: atlasIndex('N'), state: 'unread' }))
    await r.frame()
    const lines = named<Mesh & { material: LineMaterial }>('item-token-lines')
    const material = lines.material
    await r.render(createElement(ItemToken, { id: 'k1', at, side: 1, colour: '#ffa35e', initial: atlasIndex('A'), state: 'unread' }))
    await r.frame()
    await r.frame()
    // Not rebuilt for a uniform.
    expect(named<Mesh & { material: LineMaterial }>('item-token-lines').material).toBe(material)
    expect((named<Mesh & { material: { uniforms: { uGlyph: { value: number } } } }>('item-token-initial').material).uniforms.uGlyph.value).toBe(atlasIndex('A'))
    // The ring is the HUD's cyan, not plain white.
    const ringColours = (): Float32Array => (named<Mesh>('item-token-ring').geometry.getAttribute('instanceColorStart') as unknown as InterleavedBufferAttribute).data.array as Float32Array
    const cols = ringColours()
    expect(cols[0]).toBeLessThan(0.2)
    expect(cols[2]).toBeGreaterThan(0.4)
    // And a new opacity, which does rebuild the materials, keeps it coloured too.
    await r.render(createElement(ItemToken, { id: 'k1', at, side: 1, colour: '#ffa35e', initial: atlasIndex('A'), state: 'unread', opacity: 0.5 }))
    await r.frame()
    const after = ringColours()
    expect(after[0]).toBeLessThan(0.2)
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

  it('with reduced motion, takes its still pose again when its meshes are made anew (a new opacity)', async () => {
    reducedMotion()
    r = await r3fRoot()
    await r.render(createElement(SoundMark, { id: 's1', at: [0, 0, 0], side: 1, state: 'unread', playing: false }))
    await r.frame()
    const before = sliceRadius(0)
    await r.render(createElement(SoundMark, { id: 's1', at: [0, 0, 0], side: 1, state: 'unread', playing: false, opacity: 0.5 }))
    await r.frame()
    expect(sliceRadius(0)).toBeCloseTo(before, 9)
    expect(sliceRadius(0)).toBeLessThan(0.5)
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
