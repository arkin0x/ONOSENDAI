/**
 * Every face of a shard is drawn, on the bench as in the world (DECK-0003
 * §1.4). The bench once left out the faces sno-core's outward guess called
 * buried in a join, a ray count that is only right for one closed solid:
 * arkinox's Stair run lost one triangle of each low riser and three whole
 * risers above them, and a face FILLed in such a spot was added and never
 * drawn (2026-10-23).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { expandFaceColors, fromPayload, type ShardModel } from 'sno-core/shards'
import { shardGeometry } from '../ShardMesh'
import { useWorkshop } from '../../store/useWorkshop'
import { HALL_DOOR, SQUARE_TOWER, STAIR_RUN, TORCH } from './missingFacesFixture'

const model = (payload: unknown, id: string): ShardModel => expandFaceColors(fromPayload(payload, id)!)

describe('shardGeometry draws every face', () => {
  const cases: Array<[string, unknown, number]> = [
    ['Stair run', STAIR_RUN, 72],
    ['Torch', TORCH, 115],
    ['Square Tower v1', SQUARE_TOWER, 44],
    ['Maze Kit basilica hall, side door', HALL_DOOR, 494],
  ]
  for (const [name, payload, count] of cases) {
    it(`${name}: ${count} faces in the data, ${count} drawn`, () => {
      const s = model(payload, name)
      expect(s.faces).toHaveLength(count)
      const g = shardGeometry(s)
      expect(g.drawn).toEqual(s.faces.map((_, i) => i))
      expect(g.index).toHaveLength(count * 3)
    })
  }

  it("draws both triangles of the Stair run's low risers", () => {
    const g = shardGeometry(model(STAIR_RUN, 'stairs'))
    // 16 and 28 are the lower triangles of the two lowest risers, 17 and 29 the upper ones.
    for (const f of [16, 17, 28, 29, 40, 41, 52, 53, 64, 65]) expect(g.drawn).toContain(f)
  })
})

describe('FILL on corners inside a shape', () => {
  const w = () => useWorkshop.getState()
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null, selection: [], selectedFace: null, facePick: [], past: [], future: [], notice: null })
  })

  it('adds a face the bench draws: the Stair run riser triangle taken out and filled back', () => {
    const id = w().importText(JSON.stringify(STAIR_RUN))!
    expect(id).toBeTruthy()
    const corners = [...w().current()!.faces[16]]
    // Take the riser's lower triangle out, then FILL its three corners again.
    useWorkshop.setState({ shards: w().shards.map((s) => (s.id === id ? { ...s, faces: s.faces.filter((_, i) => i !== 16) } : s)) })
    expect(w().current()!.faces).toHaveLength(71)
    w().setTool('face')
    for (const i of corners) w().pickForFace(i)
    w().fill()
    const s = w().current()!
    expect(s.faces).toHaveLength(72)
    const added = s.faces.length - 1
    expect([...s.faces[added]].sort()).toEqual([...corners].sort())
    expect(shardGeometry(expandFaceColors(s)).drawn).toContain(added)
  })

  it('says so when the corners already make a face, rather than doing nothing', () => {
    w().importText(JSON.stringify(STAIR_RUN))
    const corners = [...w().current()!.faces[16]]
    w().setTool('face')
    for (const i of corners) w().pickForFace(i)
    w().fill()
    expect(w().current()!.faces).toHaveLength(72)
    expect(w().notice).toBe('Those faces are already there.')
    expect(w().facePick).toEqual([])
  })
})
