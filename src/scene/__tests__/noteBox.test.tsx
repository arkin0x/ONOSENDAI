/**
 * noteBox.test.tsx: a message in the world is a sealed letter one gibson
 * wide, always, while it is drawn (owner, 2026-11-22: "I want a message box
 * to be 1 gibson cubed, always, while it is normally visible"; 2026-11-26:
 * the box became the letter with direction 1's glyph ring), its name over it
 * in white, and nothing that cannot be seen hides it ("why is this message
 * box being partially hidden? It's being occluded by something invisible").
 *
 * The letter is drawn by LetterField with every other letter, from what each
 * NoteItem says it is (putLetter); NoteItem holds the tap target and the
 * name. A box that is moved (MOVE) is still the faint one-gibson box, its
 * edges pulled a hair toward the camera (patchNoteDepthPull).
 *
 * Run in a real R3F root (test/r3fRoot.ts): real three objects, frames and
 * camera, so the size is measured in the world, as drawn.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, useRef } from 'react'
import { Box3, Matrix4, Raycaster, ShaderLib, Vector3, Vector4, type Camera, type Material, type Mesh, type Object3D } from 'three'
import { newShard, type ShardModel } from 'sno-core/shards'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'

// Words are troika's, which fetches a font: a plain group stands in, so the label's own frame still runs.
vi.mock('@react-three/drei', async () => {
  const { createElement: h, forwardRef } = await import('react')
  // Its place is kept, so a credit line sits under its name as drawn.
  return { Text: forwardRef((props: { position?: unknown; children?: unknown }, ref) => h('group', { name: 'text', ref, position: props.position, userData: { text: props.children } })) }
})

import { NoteItem, noteBoxSide, patchNoteDepthPull, NOTE_BOX_GIBSONS, NOTE_DEPTH_PULL } from '../WorldMessages'
import { bothFaces, shapeOf, FOLD_LINE_VERTS, foldLinePoints, LetterField, lettersDrawn, LETTER_GIBSONS, LETTER_TURN_S, PAPER } from '../LetterField'
import { authorColour } from '../../lib/authorColour'
import { useMessagesRead } from '../../store/useMessagesRead'
import { Color, DoubleSide, InstancedMesh, PerspectiveCamera, ShaderMaterial, type BufferGeometry, type LineSegments } from 'three'
import { ShardMesh } from '../ShardMesh'
import { TapTarget } from '../TapTarget'
import { useCyberspace } from '../../store/useCyberspace'

;(globalThis as { window?: unknown }).window ??= globalThis

let r: R3fRoot | null = null
afterEach(async () => {
  await r?.unmount()
  r = null
})

const NOTE = { key: 'n1', text: 'hello', mine: true, author: '', centre: [0, 0, 0] as [number, number, number] }

/** A message and the field that draws its letter, as WorldMessages mounts them. */
const scene = (note: Parameters<typeof NoteItem>[0]['w'] = NOTE, onTap: () => void = () => undefined): JSX.Element =>
  createElement('group', null, createElement(LetterField), createElement(NoteItem, { w: note, birth: undefined, onTap }))

/** The letter's paper: one instance per letter. */
function paper(root: R3fRoot): InstancedMesh {
  let found: InstancedMesh | undefined
  root.state().scene.traverse((o) => { if (o.name === 'letter-paper') found = o as InstancedMesh })
  expect(found).toBeDefined()
  return found!
}

/** Letter `i`'s width in the world, from its drawn instance (the paper is 1 wide in its own units). */
function letterWidth(mesh: InstancedMesh, i = 0): number {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  return new Vector3().setFromMatrixScale(m).x
}

/** Every object three would draw: it and every parent visible, with a material. */
function drawn(scene: Object3D): Array<Object3D & { material: Material | Material[] }> {
  const out: Array<Object3D & { material: Material | Material[] }> = []
  scene.traverse((o) => {
    for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return
    if ((o as { material?: unknown }).material) out.push(o as Object3D & { material: Material | Material[] })
  })
  return out
}

/** The gibson's cube about the letter: what its name stands clear of. */
const GIBSON = new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5))

/** A box's eight corners on screen, CSS pixels (y down). */
function screenCorners(b: Box3, camera: Camera, size: { width: number; height: number }): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < 8; i++) {
    const v = new Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera)
    out.push([((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height])
  }
  return out
}

async function placeCamera(root: R3fRoot, at: [number, number, number]): Promise<Camera> {
  const camera = root.state().camera
  camera.position.set(...at)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  await root.frame()
  return camera
}

describe('a message’s box', () => {
  it('is one gibson in scene units at every scale: a scene unit is 2^scaleExp gibsons', () => {
    expect(NOTE_BOX_GIBSONS).toBe(1)
    for (const scaleExp of [0, 1, 2, 5, 10]) expect(noteBoxSide(scaleExp) * 2 ** scaleExp).toBe(1)
    expect(noteBoxSide(0)).toBe(1)
    expect(noteBoxSide(1)).toBe(0.5)
  })

  it('is drawn one gibson wide in the world at 2^0 and 2^1, near or far: it grows as you come close and shrinks as you go', async () => {
    for (const scaleExp of [0, 1]) {
      useCyberspace.setState({ scaleExp })
      r = await r3fRoot()
      await r.render(scene())
      const widths: number[] = []
      for (const eye of [[0, 0, 3], [4, 3, 12], [0, 20, 60], [-50, 10, 150]] as Array<[number, number, number]>) {
        const camera = await placeCamera(r, eye)
        const mesh = paper(r)
        expect(mesh.count).toBe(1)
        expect(letterWidth(mesh)).toBeCloseTo(noteBoxSide(scaleExp) * LETTER_GIBSONS, 6)
        // Its size on screen: nearer is larger.
        const depth = camera.position.length()
        widths.push(letterWidth(mesh) / depth)
      }
      for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThan(widths[i - 1])
      await r.unmount()
      r = null
    }
  })

  it('follows the scale as it changes, still one gibson', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    r = await r3fRoot()
    await r.render(scene())
    await placeCamera(r, [0, 2, 10])
    expect(letterWidth(paper(r))).toBeCloseTo(1, 6)
    useCyberspace.setState({ scaleExp: 1 })
    await r.render(scene())
    await r.frame()
    expect(letterWidth(paper(r))).toBeCloseTo(0.5, 6)
  })

  it('is a thing in the place: it turns slowly about the up axis whatever the camera does, about a turn in 24 s, upright', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    r = await r3fRoot()
    await r.render(scene())
    const facing = (): Vector3 => { const m = new Matrix4(); paper(r!).getMatrixAt(0, m); return new Vector3(0, 0, 1).transformDirection(m) }
    await placeCamera(r, [0, 0, 5])
    const a = facing()
    // Upright: its face stays level, turning about the up axis (a slight tilt about its own face leaves the normal level).
    expect(Math.abs(a.y)).toBeLessThan(1e-6)
    // The camera moving does not turn it.
    await placeCamera(r, [6, 2, -3])
    const b = facing()
    expect(Math.abs(b.y)).toBeLessThan(1e-6)
    const turned = (u: Vector3, v: Vector3): number => (Math.acos(Math.max(-1, Math.min(1, u.dot(v)))) * 180) / Math.PI
    // One frame (1/60 s) turns it a fortieth of a degree, never toward the camera.
    expect(turned(a, b)).toBeLessThan(1)
    // A second of frames turns it about 15 degrees: a turn in LETTER_TURN_S.
    for (let f = 0; f < 60; f++) await r.frame()
    expect(turned(b, facing())).toBeCloseTo(360 / LETTER_TURN_S, 0)
  })

  it('is paper on both sides, with its flap, seal and initial on both faces, and its edge and flap drawn as lines that keep a pixel at any distance', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    r = await r3fRoot()
    await r.render(scene())
    await placeCamera(r, [0, 0, 200])
    expect((paper(r).material as Material).side).toBe(DoubleSide)
    let lines: (LineSegments & { geometry: BufferGeometry }) | undefined
    r.state().scene.traverse((o) => { if (o.name === 'letter-fold-lines') lines = o as never })
    expect(lines!.type).toBe('LineSegments')
    expect(lines!.geometry.drawRange.count).toBe(FOLD_LINE_VERTS)
    // The lines stand on both faces, off the paper, in the scene's frame where the letter is.
    const pos = lines!.geometry.getAttribute('position')
    const zs = new Set<number>()
    for (let i = 0; i < FOLD_LINE_VERTS; i++) zs.add(Math.sign(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(new Vector3(0, 0, 0)).dot(new Vector3(0, 0, 1).transformDirection((() => { const m = new Matrix4(); paper(r!).getMatrixAt(0, m); return m })()))))
    expect([...zs].sort()).toEqual([-1, 1])
    // The flap's fold is among them: from the left edge to the seal and up to the corner, on each face.
    const pts = foldLinePoints()
    expect(pts.length / 3).toBe(FOLD_LINE_VERTS)
  })

  it('its back faces lie on the paper’s own corners: the back is the front mirrored through the paper, not turned (review, round two)', () => {
    // A shape with no symmetry, facing +z as every face is made: a corner cut top left only.
    const front = shapeOf([[-0.4, 0.3], [0.5, 0.3], [0.5, -0.3], [-0.5, -0.3], [-0.5, 0.2]])
    const both = bothFaces(front, 0.01)
    const pos = both.getAttribute('position')
    const half = pos.count / 2
    const key = (x: number, y: number): string => `${x.toFixed(4)},${y.toFixed(4)}`
    const fronts = new Set<string>(), backs = new Set<string>()
    for (let i = 0; i < pos.count; i++) (i < half ? fronts : backs).add(key(pos.getX(i), pos.getY(i)))
    // The same corners from behind as in front, in x and y, the back a hair behind the paper.
    expect([...backs].sort()).toEqual([...fronts].sort())
    for (let i = half; i < pos.count; i++) expect(pos.getZ(i)).toBeCloseTo(-0.01, 9)
    // Facing out the back: each back triangle's normal points along -z.
    const a = new Vector3(), b = new Vector3(), c = new Vector3()
    for (let t = half; t < pos.count; t += 3) {
      a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2)
      expect(b.clone().sub(a).cross(c.clone().sub(a)).z).toBeLessThan(0)
    }
    // The fold lines on the back are the front's, at -z: on the same corners as the bands.
    const lines = foldLinePoints()
    const lf = new Set<string>(), lb = new Set<string>()
    for (let i = 0; i < lines.length / 3; i++) (lines[i * 3 + 2] > 0 ? lf : lb).add(key(lines[i * 3], lines[i * 3 + 1]))
    expect([...lb].sort()).toEqual([...lf].sort())
  })

  it('with reduced motion holds still: no turn, no bob', async () => {
    ;(globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: q.includes('reduce'), addEventListener: () => {}, removeEventListener: () => {} })
    try {
      useCyberspace.setState({ scaleExp: 0 })
      r = await r3fRoot()
      await r.render(scene())
      await placeCamera(r, [0, 0, 5])
      const before = new Matrix4(); paper(r).getMatrixAt(0, before)
      for (let f = 0; f < 30; f++) await r.frame()
      const after = new Matrix4(); paper(r).getMatrixAt(0, after)
      expect(after.equals(before)).toBe(true)
    } finally {
      delete (globalThis as { matchMedia?: unknown }).matchMedia
    }
  })

  it('wears its author’s colour on its seal and their initial, whole until read and broken after', async () => {
    const A = 'ab'.repeat(32)
    useCyberspace.setState({ scaleExp: 0 })
    useMessagesRead.setState({ owner: 'me', read: { ids: [] }, ready: true })
    r = await r3fRoot()
    await r.render(scene({ ...NOTE, mine: false, author: A }))
    await placeCamera(r, [0, 0, 5])
    const [spec] = lettersDrawn()
    expect(spec.colour).toBe(authorColour(A))
    expect(spec.broken).toBe(false)
    let whole: InstancedMesh | undefined
    let broken: InstancedMesh | undefined
    r.state().scene.traverse((o) => { if (o.name === 'letter-seal') whole = o as InstancedMesh; if (o.name === 'letter-seal-broken') broken = o as InstancedMesh })
    expect(whole!.count).toBe(1)
    expect(broken!.count).toBe(0)
    const c = new Color()
    whole!.getColorAt(0, c)
    expect(`#${c.getHexString()}`).toBe(authorColour(A))
    // Read: the seal breaks.
    useMessagesRead.getState().markRead(NOTE.key)
    await r.render(scene({ ...NOTE, mine: false, author: A }))
    await r.frame()
    expect(lettersDrawn()[0].broken).toBe(true)
    expect(whole!.count).toBe(0)
    expect(broken!.count).toBe(1)
  })

  it('is gone from the field when its message goes', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    r = await r3fRoot()
    await r.render(scene())
    expect(lettersDrawn().map((l) => l.key)).toEqual(['n1'])
    await r.render(createElement(LetterField))
    expect(lettersDrawn()).toEqual([])
  })

  it('draws its paper opaque, out of the bloom; its folds and its ring as light that writes no depth', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    r = await r3fRoot()
    await r.render(scene())
    const sheet = paper(r).material as Material & { color: Color }
    expect(sheet.depthWrite).not.toBe(false)
    expect(`#${sheet.color.getHexString()}`).toBe(PAPER)
    let folds: Material | undefined
    let ring: ShaderMaterial | undefined
    r.state().scene.traverse((o) => {
      if (o.name === 'letter-folds') folds = (o as Mesh).material as Material
      if (o.name === 'letter-rings') ring = (o as Mesh).material as ShaderMaterial
    })
    expect(folds!.depthWrite).toBe(false)
    expect(ring!.depthWrite).toBe(false)
    expect(ring!.depthTest).toBe(true)
  })

  it('a moved box keeps its edges pulled a hair toward the camera along each sight line, so they keep their place on screen and win over a floor they rest on', () => {
    // Three's own shader for a line material (ShaderLib.basic): the anchor is there, once.
    const shader = { vertexShader: ShaderLib.basic.vertexShader }
    expect(patchNoteDepthPull(shader)).toBe(true)
    expect(shader.vertexShader).toMatch(/#include <project_vertex>\ngl_Position = projectionMatrix \* vec4\( mvPosition\.xyz \* \( 1\.0 - 0\.00100000 \), mvPosition\.w \);/)
    // A shader without the anchor is left alone.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const odd = { vertexShader: 'void main() {}' }
    expect(patchNoteDepthPull(odd)).toBe(false)
    expect(odd.vertexShader).toBe('void main() {}')
    warn.mockRestore()
    // What the line does, in numbers: the same place on screen, a nearer depth.
    const camera = new PerspectiveCamera(50, 1, 0.1, 1000)
    camera.position.set(1, 2, 9); camera.lookAt(0, 0, 0); camera.updateMatrixWorld()
    for (const p of [[0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, 0.5, -0.5]] as Array<[number, number, number]>) {
      const mv = new Vector4(...p, 1).applyMatrix4(new Matrix4().copy(camera.matrixWorldInverse))
      const plain = mv.clone().applyMatrix4(camera.projectionMatrix)
      const pulled = new Vector4(mv.x * (1 - NOTE_DEPTH_PULL), mv.y * (1 - NOTE_DEPTH_PULL), mv.z * (1 - NOTE_DEPTH_PULL), mv.w).applyMatrix4(camera.projectionMatrix)
      expect(pulled.x / pulled.w).toBeCloseTo(plain.x / plain.w, 9)
      expect(pulled.y / pulled.w).toBeCloseTo(plain.y / plain.w, 9)
      expect(pulled.z / pulled.w).toBeLessThan(plain.z / plain.w)
    }
  })

  it('names your own message "you", even one found anew that this device did not hide, as DISCOVERED NEARBY does', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    const me = useCyberspace.getState().identity.pubkey
    r = await r3fRoot()
    await r.render(scene({ ...NOTE, mine: false, author: me }))
    await placeCamera(r, [0, 0, 5])
    let text: Object3D | undefined
    r.state().scene.traverse((o) => { if (o.name === 'text') text = o })
    expect(text!.userData.text).toBe('you')
  })

  it('carries the name over the letter, clear of its gibson’s highest corner on screen near or far (the ring stays inside the gibson)', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    r = await r3fRoot()
    await r.render(createElement(NoteItem, { w: NOTE, birth: undefined, onTap: () => undefined }))
    const scene = r.state().scene
    const size = r.state().size
    // From the next gibson (1.5 away) out to far off, straight on and from above.
    for (const eye of [[0, 0, 1.5], [0, 0, 2.5], [0, 1.2, 1.4], [0, 0, 8], [3, 4, 20], [0, 0, 40]] as Array<[number, number, number]>) {
      const camera = await placeCamera(r, eye)
      let text: Object3D | undefined
      scene.traverse((o) => { if (o.name === 'text') text = o })
      const inner = text!.parent!
      expect(inner.position.y).toBeGreaterThan(0)
      // The name's centre on screen, and half its height: one local unit of the label is one of its pixels.
      const at = inner.getWorldPosition(new Vector3()).project(camera)
      const nameY = ((1 - at.y) / 2) * size.height
      const label = inner.parent!.parent!
      const depth = camera.position.distanceTo(label.getWorldPosition(new Vector3()))
      const unitPx = (label.scale.x * size.height) / (2 * Math.tan(((camera as PerspectiveCamera).fov * Math.PI) / 360) * depth)
      const highest = Math.min(...screenCorners(GIBSON, camera, size).map((c) => c[1]))
      expect(nameY + unitPx / 2).toBeLessThanOrEqual(highest)
    }
  })

  it('a box resting on the ground: the ground never stands between the eye and its name, from any camera above the ground', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    r = await r3fRoot()
    await r.render(createElement('group', null,
      // The ground: a wide floor whose top face is the box's bottom face.
      createElement('mesh', { name: 'ground', position: [0, -0.5 - 0.05, 0] }, createElement('boxGeometry', { args: [400, 0.1, 400] }), createElement('meshBasicMaterial')),
      createElement(NoteItem, { w: NOTE, birth: undefined, onTap: () => undefined }),
    ))
    const scene = r.state().scene
    let ground: Object3D | undefined
    scene.traverse((o) => { if (o.name === 'ground') ground = o })
    for (const eye of [[0, 0.2, 3], [0, 1.5, 1.5], [0, 6, 2], [2, 0.3, 12], [0, 12, 0.5], [5, 20, 30], [0, 2, 60]] as Array<[number, number, number]>) {
      const camera = await placeCamera(r, eye)
      let text: Object3D | undefined
      scene.traverse((o) => { if (o.name === 'text') text = o })
      const name = text!.getWorldPosition(new Vector3())
      const ray = new Raycaster(camera.position.clone(), name.clone().sub(camera.position).normalize())
      const hit = ray.intersectObject(ground!, false)[0]
      expect(hit === undefined || hit.distance > camera.position.distanceTo(name)).toBe(true)
    }
  })

  it('takes a tap anywhere over the box once it is larger than a fingertip', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    const tapped = vi.fn()
    r = await r3fRoot()
    await r.render(createElement(NoteItem, { w: NOTE, birth: undefined, onTap: tapped }))
    // Close: the box is about 300 px across on this 800 px canvas; a tap near its corner, far outside 44 px, opens it.
    await placeCamera(r, [0, 0, 3])
    await r.tap(400 + 120, 400 - 120)
    expect(tapped).toHaveBeenCalledTimes(1)
    // Far: the box is a few pixels; the fingertip target still takes a tap just off it.
    await placeCamera(r, [0, 0, 200])
    await r.tap(400 + 15, 400)
    expect(tapped).toHaveBeenCalledTimes(2)
  })
})

/** A solid in front of the box with its own measured tap target, as a shard or a chest has. */
function Blocker({ onTap }: { onTap: () => void }): JSX.Element {
  const drawn = useRef<Mesh>(null)
  return createElement('group', { position: [0, 0, 1.2] },
    createElement('mesh', { ref: drawn }, createElement('boxGeometry', { args: [0.5, 0.5, 0.1] }), createElement('meshBasicMaterial')),
    createElement(TapTarget, { measure: drawn, onTap }),
  )
}

describe('a large box among other things to tap', () => {
  it('up close, a thing standing in front of the box takes a tap on it; the box takes a tap beside it', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    const message = vi.fn()
    const chest = vi.fn()
    r = await r3fRoot()
    await r.render(createElement('group', null,
      createElement(NoteItem, { w: NOTE, birth: undefined, onTap: message }),
      createElement(Blocker, { onTap: chest }),
    ))
    await placeCamera(r, [0, 0, 3])
    await r.tap(400, 400)
    expect(chest).toHaveBeenCalledTimes(1)
    expect(message).not.toHaveBeenCalled()
    // Beside the chest (about 120 px either side of the middle here) and on the box (about 170 px): the box.
    await r.tap(400 + 150, 400 - 150)
    expect(message).toHaveBeenCalledTimes(1)
    expect(chest).toHaveBeenCalledTimes(1)
  })

  it('up close inside a room (a floor and a back wall, measured), a tap on the box opens the message, and a tap on the wall beside it the room', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    const message = vi.fn()
    const room = vi.fn()
    function Room(): JSX.Element {
      const drawn = useRef<Mesh>(null)
      return createElement('group', null,
        createElement('group', { ref: drawn },
          // A floor under the box and a wall behind it; the eye stands outside the room's box, as orbiting a room does.
          createElement('mesh', { position: [0, -0.55, -0.95] }, createElement('boxGeometry', { args: [3, 0.1, 3.1] }), createElement('meshBasicMaterial')),
          createElement('mesh', { position: [0, 1, -2] }, createElement('boxGeometry', { args: [3, 3, 0.1] }), createElement('meshBasicMaterial')),
        ),
        createElement(TapTarget, { measure: drawn as never, onTap: room }),
      )
    }
    r = await r3fRoot()
    await r.render(createElement('group', null,
      createElement(Room),
      createElement(NoteItem, { w: NOTE, birth: undefined, onTap: message }),
    ))
    await placeCamera(r, [0, 0, 3])
    await r.tap(400, 400)
    expect(message).toHaveBeenCalledTimes(1)
    expect(room).not.toHaveBeenCalled()
    await r.tap(400 + 250, 400 - 200)
    expect(room).toHaveBeenCalledTimes(1)
    expect(message).toHaveBeenCalledTimes(1)
  })

  it('far off, held to a fingertip, the box still wins over a shard’s box, as a coin does', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    const message = vi.fn()
    const chest = vi.fn()
    r = await r3fRoot()
    await r.render(createElement('group', null,
      createElement(NoteItem, { w: NOTE, birth: undefined, onTap: message }),
      createElement(Blocker, { onTap: chest }),
    ))
    await placeCamera(r, [0, 0, 120])
    await r.tap(400, 400)
    expect(message).toHaveBeenCalledTimes(1)
    expect(chest).not.toHaveBeenCalled()
  })
})

describe('what cannot be seen hides nothing', () => {
  /** A slab of floor, two triangles, at the given opacity, walled for WALK. */
  function floor(opacity?: number): ShardModel {
    return {
      ...newShard('floor'), unit: 0, mode: 'solid',
      vertices: [{ p: [-2, 0, -2], c: [0.3, 0.6, 0.3] }, { p: [2, 0, -2], c: [0.3, 0.6, 0.3] }, { p: [2, 0, 2], c: [0.3, 0.6, 0.3] }, { p: [-2, 0, 2], c: [0.3, 0.6, 0.3] }],
      faces: [[0, 1, 2], [0, 2, 3]],
      ...(opacity === undefined ? {} : { opacity }),
      extra: { constrain: 'all' },
    } as ShardModel
  }

  it('a 0% object (an invisible wall: 0% and constrain) draws nothing that writes depth or colour; its tap copy is never drawn', async () => {
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: floor(0), world: true }))
    await r.frame()
    const scene = r.state().scene
    expect(drawn(scene)).toEqual([])
    // It is still there for a tap or a pick: a copy that three never draws, and could draw nothing if it did.
    const hit: Mesh[] = []
    scene.traverse((o) => { if (o.name === 'shard-hit') hit.push(o as Mesh) })
    expect(hit).toHaveLength(1)
    expect(hit[0].visible).toBe(false)
    const hm = hit[0].material as Material
    expect(hm.colorWrite).toBe(false)
    expect(hm.depthWrite).toBe(false)
  })

  it('the same floor seen draws its faces and writes depth, as an opaque face must; see-through, it writes none', async () => {
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: floor(), world: true }))
    await r.frame()
    const faces = drawn(r.state().scene).filter((o) => o.name === 'shard-faces')
    expect(faces).toHaveLength(1)
    expect((faces[0].material as Material).depthWrite).toBe(true)
    await r.unmount()
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: floor(40), world: true }))
    await r.frame()
    for (const o of drawn(r.state().scene)) for (const m of ([] as Material[]).concat(o.material)) expect(m.depthWrite).toBe(false)
  })

  it('among a 0% floor and a message, the only things drawn are the letter’s', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    r = await r3fRoot()
    await r.render(createElement('group', null,
      createElement(ShardMesh, { shard: floor(0), world: true }),
      scene(),
    ))
    await placeCamera(r, [0, 3, 10])
    const all = drawn(r.state().scene)
    expect(all.length).toBeGreaterThan(0)
    for (const o of all) expect(o.name.startsWith('letter-')).toBe(true)
  })
})
