/**
 * worldLanding.test.tsx: a landing re-renders the parts of the world that
 * follow it, and not the whole world (owner's walk of 2026-11-21: one long
 * task per step of a fluid WALK).
 *
 * World read the view window, the terrain volume and the targets, all three
 * of which follow every landing, so each landing rendered World and with it
 * every one of its forty-odd parts, two or three times a step. Each part
 * follows what it draws by itself; only the point field and the target
 * markers take what World read, and they read it themselves now
 * (Scene.tsx TerrainField, TargetMarkers).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis

const rendered = vi.hoisted(() => new Map<string, number>())
const stub = vi.hoisted(() => (name: string) => () => { rendered.set(name, (rendered.get(name) ?? 0) + 1); return null })
// The view window and the terrain volume follow the anchor, as the real ones do; their work (workers, timers) is not this test's.
vi.mock('../../hooks/useViewWindow', async (real) => {
  const { useCyberspace } = await import('../../store/useCyberspace')
  return { ...(await real<object>()), useViewWindow: () => { const anchor = useCyberspace((s) => s.anchor); return { right: Number(anchor.x % 7n), up: 0, out: 0 } } }
})
vi.mock('../../hooks/useTerrainVolume', async (real) => {
  const { useCyberspace } = await import('../../store/useCyberspace')
  return { ...(await real<object>()), useTerrainVolume: () => ({ anchor: useCyberspace((s) => s.anchor) }) }
})
vi.mock('../PointBillboards', async (real) => ({ ...(await real<object>()), GlowWorldCanvas: stub('GlowWorldCanvas') }))
vi.mock('../frameDriver', async (real) => ({ ...(await real<object>()), FrameDriver: stub('FrameDriver') }))
vi.mock('../WalkProbe', async (real) => ({ ...(await real<object>()), WalkProbe: stub('WalkProbe') }))
vi.mock('../Avatar', async (real) => ({ ...(await real<object>()), Avatar: stub('Avatar') }))
vi.mock('../BlackSun', async (real) => ({ ...(await real<object>()), BlackSun: stub('BlackSun') }))
vi.mock('../CoveringBox', async (real) => ({ ...(await real<object>()), CoveringBox: stub('CoveringBox') }))
vi.mock('../CrossingFlash', async (real) => ({ ...(await real<object>()), CrossingFlash: stub('CrossingFlash') }))
vi.mock('../Earth', async (real) => ({ ...(await real<object>()), Earth: stub('Earth') }))
vi.mock('../EarthPatch', async (real) => ({ ...(await real<object>()), EarthPatch: stub('EarthPatch') }))
vi.mock('../SphereOfInterest', async (real) => ({ ...(await real<object>()), SphereOfInterest: stub('SphereOfInterest') }))
vi.mock('../EarthPin', async (real) => ({ ...(await real<object>()), EarthPin: stub('EarthPin') }))
vi.mock('../Cursor', async (real) => ({ ...(await real<object>()), Cursor: stub('Cursor') }))
vi.mock('../HyperspaceCone', async (real) => ({ ...(await real<object>()), HyperspaceCone: stub('HyperspaceCone') }))
vi.mock('../CyberspaceLattice', async (real) => ({ ...(await real<object>()), CyberspaceLattice: stub('CyberspaceLattice') }))
vi.mock('../StopField', async (real) => ({ ...(await real<object>()), StopField: stub('StopField') }))
vi.mock('../StopCubes', async (real) => ({ ...(await real<object>()), StopCubes: stub('StopCubes') }))
vi.mock('../StopBurst', async (real) => ({ ...(await real<object>()), StopBurst: stub('StopBurst') }))
vi.mock('../TourLine', async (real) => ({ ...(await real<object>()), TourLine: stub('TourLine') }))
vi.mock('../TransitAvatar', async (real) => ({ ...(await real<object>()), TransitAvatar: stub('TransitAvatar') }))
vi.mock('../RidePath', async (real) => ({ ...(await real<object>()), RidePath: stub('RidePath') }))
vi.mock('../PathTrail', async (real) => ({ ...(await real<object>()), PathTrail: stub('PathTrail') }))
vi.mock('../GameRegionBox', async (real) => ({ ...(await real<object>()), GameRegionBox: stub('GameRegionBox') }))
vi.mock('../PrefixRegionBox', async (real) => ({ ...(await real<object>()), PrefixRegionBox: stub('PrefixRegionBox') }))
vi.mock('../RegionSelectBox', async (real) => ({ ...(await real<object>()), RegionSelectBox: stub('RegionSelectBox') }))
vi.mock('../Rooms', async (real) => ({ ...(await real<object>()), Rooms: stub('Rooms') }))
vi.mock('../SectorBox', async (real) => ({ ...(await real<object>()), SectorBox: stub('SectorBox') }))
vi.mock('../ShaderPointField', async (real) => ({ ...(await real<object>()), ShaderPointField: stub('ShaderPointField') }))
vi.mock('../SecretRegions', async (real) => ({ ...(await real<object>()), SecretRegions: stub('SecretRegions') }))
vi.mock('../SpawnMarker', async (real) => ({ ...(await real<object>()), SpawnMarker: stub('SpawnMarker') }))
vi.mock('../TutorialTarget', async (real) => ({ ...(await real<object>()), TutorialTarget: stub('TutorialTarget'), TutorialBoxMark: stub('TutorialBoxMark') }))
vi.mock('../TargetAvatars', async (real) => ({ ...(await real<object>()), TargetAvatars: stub('TargetAvatars') }))
vi.mock('../PresenceAvatars', async (real) => ({ ...(await real<object>()), PresenceAvatars: stub('PresenceAvatars') }))
vi.mock('../WorldShards', async (real) => ({ ...(await real<object>()), WorldShards: stub('WorldShards') }))
vi.mock('../WorldSeeds', async (real) => ({ ...(await real<object>()), WorldSeeds: stub('WorldSeeds') }))
vi.mock('../WorldMessages', async (real) => ({ ...(await real<object>()), WorldMessages: stub('WorldMessages') }))
vi.mock('../ChestLooks', async (real) => ({ ...(await real<object>()), ChestLooks: stub('ChestLooks') }))
vi.mock('../BuildOccluders', async (real) => ({ ...(await real<object>()), BuildOccluders: stub('BuildOccluders') }))
vi.mock('../HiddenAudio', async (real) => ({ ...(await real<object>()), HiddenAudio: stub('HiddenAudio') }))
vi.mock('../AudioSpheres', async (real) => ({ ...(await real<object>()), AudioSpheres: stub('AudioSpheres') }))
vi.mock('../StarredMarks', async (real) => ({ ...(await real<object>()), StarredMarks: stub('StarredMarks') }))
vi.mock('../ShardGhost', async (real) => ({ ...(await real<object>()), ShardGhost: stub('ShardGhost') }))
vi.mock('../DeployRegionBox', async (real) => ({ ...(await real<object>()), DeployRegionBox: stub('DeployRegionBox') }))
vi.mock('../ScanRegionBox', async (real) => ({ ...(await real<object>()), ScanRegionBox: stub('ScanRegionBox') }))
vi.mock('../DoorRooms', async (real) => ({ ...(await real<object>()), DoorRooms: stub('DoorRooms') }))
vi.mock('../StepBox', async (real) => ({ ...(await real<object>()), StepBox: stub('StepBox') }))
vi.mock('../ChatRoomBox', async (real) => ({ ...(await real<object>()), ChatRoomBox: stub('ChatRoomBox') }))
vi.mock('../TargetProjector', async (real) => ({ ...(await real<object>()), TargetProjector: stub('TargetProjector') }))
vi.mock('../Travel', async (real) => ({ ...(await real<object>()), Travel: stub('Travel') }))
vi.mock('../TvLayer', async (real) => ({ ...(await real<object>()), TvLayer: stub('TvLayer') }))
vi.mock('../TvScreenEffect', async (real) => ({ ...(await real<object>()), TvScreenEffect: stub('TvScreenEffect') }))

import { createElement } from 'react'
import { mount, settled, type Mounted } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { useTv } from '../../store/useTv'
import { World } from '../Scene'

let m: Mounted | null = null
afterEach(async () => { await m?.unmount(); m = null; rendered.clear(); useTv.setState({ on: false }) })

/** A landing as the store makes one: you, your cursor and the anchor move a gibson on. */
function land(x: bigint): void {
  const at = { x, y: 0n, z: 0n }
  useCyberspace.setState({ position: at, cursor: at, anchor: at })
}

describe('a landing in the world', () => {
  it('re-renders the point field and the target markers, and none of the other parts of the world', async () => {
    useCyberspace.setState({ walking: true })
    land(1000n)
    m = await mount(createElement(World))
    const before = new Map(rendered)
    expect(before.get('Earth')).toBe(1)
    for (let i = 1n; i <= 5n; i++) { land(1000n + i); await settled() }
    const again = [...rendered].filter(([name, n]) => n !== before.get(name)).map(([name]) => name).sort()
    // Each of these follows the landing by itself in the app; mocked here, nothing of theirs moves them.
    expect(again).toEqual(['ShaderPointField', 'TargetProjector'])
  })

  it('under Cyberspace TV re-renders only the point field', async () => {
    useTv.setState({ on: true })
    land(2000n)
    m = await mount(createElement(World))
    const before = new Map(rendered)
    expect(before.get('TvLayer')).toBe(1)
    for (let i = 1n; i <= 5n; i++) { land(2000n + i); await settled() }
    expect([...rendered].filter(([name, n]) => n !== before.get(name)).map(([name]) => name)).toEqual(['ShaderPointField'])
  })
})
