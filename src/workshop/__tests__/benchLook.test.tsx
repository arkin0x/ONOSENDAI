/**
 * benchLook.test.tsx - LOOK shows the shard as the world draws it (arkinox,
 * 2026-11-15: "in the LOOK tool only we should make the vertices and faces
 * look exactly like they would in cyberspace"): the world's ShardMesh
 * switches, faces, headlamp and discs, the discs at the world's size for the
 * shard; every editing tool keeps the bench's lit faces and its large
 * handles; switching tools swaps the look on the same mesh, both ways.
 * Mounted for real: only the canvas is stood in for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@react-three/fiber', async (real) => ({
  ...(await real<object>()),
  useFrame: () => undefined,
  useThree: (pick: (s: unknown) => unknown) => pick({ gl: {}, invalidate: () => undefined, controls: null, camera: null, size: { width: 375, height: 812 } }),
}))

import { createElement } from 'react'
import type { ShaderMaterial } from 'three'
import { newShard, type ShardModel } from 'sno-core/shards'
import { mount, settled, type Host } from '../../test/elementRoot'
import { BenchShard, BenchLookRig } from '../benchLook'
import { FaceHighlight, Handles } from '../Bench'
import { LOOK_TOOL, benchReach, benchShardLook, isLook, lookDotScale } from '../lookTool'
import { cellsPerUnit, scaledDisc } from '../../scene/dotScale'
import { SHARD_DOTS, SHARD_POINTS } from '../../scene/pointDisc'
import { HEADLAMP_FACES, HEADLAMP_NEVER, headlampReach, headlampUniforms } from '../../scene/headlamp'
import { LINE_FADE_FROM, LINE_FADE_TO, lineFade } from '../../scene/nearFade'
import { TAG_BLEND } from '../../scene/shardFaces'
import { useWorkshop, type Tool } from '../../store/useWorkshop'
import { useCyberspace } from '../../store/useCyberspace'
import { useAnimPreview } from '../../store/animPreview'

/** A cube's front: four points and two faces, at `unit`. */
function square(unit = 0, mode: ShardModel['mode'] = 'solid'): ShardModel {
  return {
    ...newShard('Square'), unit, mode,
    vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]].map((p) => ({ p: p as [number, number, number], c: [1, 0.5, 0.25] as [number, number, number] })),
    faces: [[0, 1, 2], [0, 2, 3]],
  }
}

const noop = (): void => {}
const of = (all: Host[], type: string): Host[] => all.filter((h) => h.type === type)
/** The shard's own vertex discs (the bench's handles are an InstancedMesh, never `points`). */
const discs = (all: Host[]): ShaderMaterial[] => of(all, 'points').map((h) => h.props.material as ShaderMaterial).filter((m) => !!m?.uniforms?.uSize)
const tagged = (all: Host[]): Host[] => of(all, 'meshBasicMaterial').filter((h) => h.props.blendSrcAlpha === TAG_BLEND.blendSrcAlpha && h.props.blendDstAlpha === TAG_BLEND.blendDstAlpha && h.props.stencilWrite === true)

function open(shard: ShardModel, tool: Tool, extra: Partial<ReturnType<typeof useWorkshop.getState>> = {}): void {
  useWorkshop.setState({ open: true, shards: [shard], currentId: shard.id, tool, selection: [], partSel: [], selectedFaces: [], facePick: [], selectKind: 'points', ...extra })
}

beforeEach(() => {
  useCyberspace.setState({ scaleExp: 0 })
  useAnimPreview.getState().stop()
})
afterEach(() => {
  useWorkshop.setState({ open: false, tool: 'view' })
})

describe('the LOOK rules', () => {
  it('LOOK is the store\'s view tool, and only it', () => {
    expect(LOOK_TOOL).toBe('view')
    for (const t of ['stamp', 'add', 'select', 'face', 'paint'] as Tool[]) expect(isLook(t), t).toBe(false)
    expect(isLook('view')).toBe(true)
  })

  it('takes the world\'s ShardMesh switches in LOOK and the bench\'s lights everywhere else', () => {
    expect(benchShardLook(true)).toEqual({ world: true, lit: false })
    expect(benchShardLook(false)).toEqual({ world: false, lit: true })
  })

  it('sizes the discs in model units as the world draws them at your zoom: 2^(zoom - unit)', () => {
    // The usual case: a unit 0 shard seen at 2^0 is drawn one cell per unit, the world's numbers as they are.
    expect(lookDotScale(0, 0)).toBe(1)
    // Unit 3 at 2^0: eight cells per unit out there, so a disc is an eighth of a unit.
    expect(lookDotScale(3, 0)).toBe(1 / 8)
    // Unit 0 at 2^2: a quarter cell per unit, so a disc is four units.
    expect(lookDotScale(0, 2)).toBe(4)
    expect(lookDotScale(5, 5)).toBe(1)
    expect(cellsPerUnit(3, 1) * lookDotScale(3, 1)).toBe(1)
  })

  it('a disc profile at k keeps its pixel floor, cap and glow, and is the same object at 1', () => {
    expect(scaledDisc(SHARD_DOTS, 1)).toBe(SHARD_DOTS)
    expect(scaledDisc(SHARD_DOTS, Number.NaN)).toBe(SHARD_DOTS)
    expect(scaledDisc(SHARD_POINTS, 0.25)).toEqual({ ...SHARD_POINTS, size: SHARD_POINTS.size * 0.25 })
  })

  it('the headlamp\'s reach is the world\'s for the same view, brought back to bench units', () => {
    for (const d of [0.6, 3, 9, 40, 400]) expect(benchReach(d, 1)).toBeCloseTo(headlampReach(d), 9)
    // A unit 2 shard at 2^0: four cells per unit, so a bench distance is four cells out there.
    expect(benchReach(5, 4)).toBeCloseTo(headlampReach(20) / 4, 9)
  })
})

describe('the shard on the bench', () => {
  it('LOOK draws it as the world does: tagged unlit faces under the headlamp, the world\'s discs, no bench lights', async () => {
    open(square(), 'view')
    const m = await mount(createElement(BenchShard, { onFace: noop, onPart: noop }))
    const all = m.all()
    expect(of(all, 'meshLambertMaterial')).toHaveLength(0)
    const faces = tagged(all)
    expect(faces.length).toBeGreaterThan(0)
    for (const f of faces) expect(f.props.onBeforeCompile).toBe(HEADLAMP_FACES.onBeforeCompile)
    const [disc] = discs(all)
    expect(disc.uniforms.uSize.value).toBeCloseTo(SHARD_DOTS.size, 9)
    expect(disc.uniforms.uMinPx.value).toBe(SHARD_DOTS.minPx)
    expect(disc.uniforms.uMaxPx.value).toBe(SHARD_DOTS.maxPx)
    // The world's headlamp on its discs (distance only), not the bench's never.
    expect(disc.uniforms.uHeadlamp).toBe(headlampUniforms.uHeadlamp)
    await m.unmount()
  })

  it('LOOK sizes the discs for the shard as it stands in the world at your zoom', async () => {
    useCyberspace.setState({ scaleExp: 1 })
    open(square(3, 'points'), 'view')
    const m = await mount(createElement(BenchShard, { onFace: noop, onPart: noop }))
    const [disc] = discs(m.all())
    // Unit 3 at 2^1: four cells per unit, so a quarter of the world's size in model units.
    expect(disc.uniforms.uSize.value).toBeCloseTo(SHARD_POINTS.size / 4, 9)
    await m.unmount()
  })

  it('every editing tool keeps the bench\'s lit faces and its own discs', async () => {
    for (const tool of ['stamp', 'select', 'paint', 'add', 'face'] as Tool[]) {
      open(square(3), tool)
      const m = await mount(createElement(BenchShard, { onFace: noop, onPart: noop }))
      const all = m.all()
      expect(of(all, 'meshLambertMaterial').length, tool).toBeGreaterThan(0)
      expect(tagged(all), tool).toHaveLength(0)
      const [disc] = discs(all)
      // At the bench's own scale, whatever the shard's unit, and never under the headlamp.
      expect(disc.uniforms.uSize.value, tool).toBe(SHARD_DOTS.size)
      expect(disc.uniforms.uHeadlamp, tool).toBe(HEADLAMP_NEVER)
      await m.unmount()
    }
  })

  it('switching tools swaps the look on the same mesh, both ways', async () => {
    open(square(2), 'select')
    const m = await mount(createElement(BenchShard, { onFace: noop, onPart: noop }))
    const points = of(m.all(), 'points')[0]
    const looks: Array<[Tool, boolean]> = [['view', true], ['select', false], ['view', true], ['paint', false]]
    for (const [tool, look] of looks) {
      useWorkshop.getState().setTool(tool)
      await settled()
      const all = m.all()
      expect(tagged(all).length > 0, tool).toBe(look)
      expect(of(all, 'meshLambertMaterial').length > 0, tool).toBe(!look)
      expect(discs(all)[0].uniforms.uSize.value, tool).toBeCloseTo(look ? SHARD_DOTS.size / 4 : SHARD_DOTS.size, 9)
      // The same points object throughout: its material changes, the mesh is never made again.
      expect(of(all, 'points')[0], tool).toBe(points)
    }
    await m.unmount()
  })
})

describe('the editing marks', () => {
  it('the handles show in every editing tool, go in LOOK and come back after it', async () => {
    open(square(), 'select', { selection: [0, 1] })
    const m = await mount(createElement(Handles))
    const shown = (): number => of(m.all(), 'primitive').length
    expect(shown()).toBeGreaterThan(0)
    for (const [tool, on] of [['view', false], ['select', true], ['stamp', true], ['view', false], ['add', true]] as Array<[Tool, boolean]>) {
      useWorkshop.getState().setTool(tool)
      await settled()
      expect(shown() > 0, tool).toBe(on)
    }
    // What was held is still held: LOOK hides it, never lets it go.
    expect(useWorkshop.getState().selection).toEqual([0, 1])
    // PAINT and FACE let go as they always did (store setTool), and keep their handles.
    for (const [tool, on] of [['paint', true], ['view', false], ['face', true]] as Array<[Tool, boolean]>) {
      useWorkshop.getState().setTool(tool)
      await settled()
      expect(shown() > 0, tool).toBe(on)
    }
    await m.unmount()
  })

  it('the selected faces\' fill hides in LOOK', async () => {
    open(square(), 'select', { selectKind: 'faces', selectedFaces: [0] })
    const m = await mount(createElement(FaceHighlight))
    expect(of(m.all(), 'mesh').length).toBe(1)
    // The store lets go of held faces on a tool change (setTool); set straight, so the fill's own rule is what is tested.
    useWorkshop.setState({ tool: 'view' })
    await settled()
    expect(of(m.all(), 'mesh').length).toBe(0)
    useWorkshop.setState({ tool: 'select' })
    await settled()
    expect(of(m.all(), 'mesh').length).toBe(1)
    await m.unmount()
  })

  it('LOOK\'s rig puts the lines\' near fade in bench units, and the world\'s back when it goes', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    open(square(2), 'view')
    const m = await mount(createElement(BenchLookRig))
    expect(lineFade.range.value.x).toBeCloseTo(LINE_FADE_FROM / 4, 9)
    expect(lineFade.range.value.y).toBeCloseTo(LINE_FADE_TO / 4, 9)
    await m.unmount()
    expect(lineFade.range.value.x).toBe(LINE_FADE_FROM)
    expect(lineFade.range.value.y).toBe(LINE_FADE_TO)
  })

  it('LOOK\'s rig puts back the headlamp reach and the fade switch it found', async () => {
    headlampUniforms.uHeadlampReach.value = 31
    lineFade.on.value = 0
    open(square(), 'view')
    const m = await mount(createElement(BenchLookRig))
    // What the bench writes while LOOK is up (its frame callback, stood in for here).
    headlampUniforms.uHeadlampReach.value = 8
    lineFade.on.value = 1
    await m.unmount()
    expect(headlampUniforms.uHeadlampReach.value).toBe(31)
    expect(lineFade.on.value).toBe(0)
    lineFade.on.value = 1
  })
})
