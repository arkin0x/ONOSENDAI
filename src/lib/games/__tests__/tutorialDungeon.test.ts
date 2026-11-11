/**
 * tutorialDungeon.test.ts - the tutorial dungeon can be cleared, start to
 * finish, by the game's own rules against its real world: the DEV fixture's
 * bag, opened with the region key, its shards' real walls, gravity and jumps
 * (lib/games/gravity.ts), the pad, the key, the gate and the exit zone
 * (lib/games/progress.ts). Every jump is pressed the way a player presses it:
 * JUMP, then a direction a few times while in the air, on a 16 ms frame
 * clock. Nothing is signed or sent: this is the game logic alone.
 *
 * It also checks the dungeon is a dungeon: the arrival does not join the
 * climb but by the pad, the gate holds until it is opened, and the key
 * platform cannot be reached without jumping.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { loadWorld } from '../world'
import { TUTORIAL_ENTRY, TUTORIAL_GAME } from '../tutorialGame'
import { padUnder, type WorldShard } from '../play'
import { jump, move, standing, tick, type Body } from '../gravity'
import { offerAt, openDoor, reachExit, startProgress, takeKey, worldNow, type Progress } from '../progress'
import type { Position } from '../../space'

const G = TUTORIAL_GAME
const B = G.region.base
const at = (x: number, y: number, z: number): Position => ({ x: B.x + BigInt(x), y: B.y + BigInt(y), z: B.z + BigInt(z) })
const rel = (p: Position): string => `${p.x - B.x},${p.y - B.y},${p.z - B.z}`

/** A player driven through the game logic on a frame clock, the way GameView drives the store. */
class Player {
  body: Body
  now = 0
  progress: Progress = startProgress(0)
  constructor(public world: readonly WorldShard[], start: Position) { this.body = { at: start, arc: null, doubled: false } }
  get solid(): WorldShard[] { return worldNow(G, this.world, this.progress).solid }
  get at(): string { return rel(this.body.at) }
  /** Run frames for `ms`, landing on a pad sending you on (as useGame onPad). */
  wait(ms: number): void {
    const end = this.now + ms
    while (this.now < end) {
      this.now += 16
      const r = tick(G, this.body, this.now, this.solid)
      this.body = r.body
      if (!this.body.arc) this.pad()
    }
  }
  pad(): void {
    const pad = padUnder(G, this.body.at)
    if (pad) this.body = { at: { ...pad.to }, arc: null, doubled: false }
  }
  press(axis: 'x' | 'z', dir: 1 | -1, times = 1): void {
    for (let i = 0; i < times; i++) {
      this.body = move(G, this.body, axis, dir, this.now, this.solid)
      if (!this.body.arc) this.pad()
      this.wait(110)
    }
  }
  /** JUMP, then `dir` pressed at each of `at` ms into the jump, then wait to land. */
  jump(axis: 'x' | 'z', dir: 1 | -1, at: number[], double?: number): void {
    const t0 = this.now
    this.body = jump(G, this.body, this.now, this.solid)
    expect(this.body.arc, `a jump from ${this.at}`).not.toBeNull()
    const marks = [...at.map((t) => ({ t, k: 'move' as const })), ...(double !== undefined ? [{ t: double, k: 'double' as const }] : [])].sort((a, b) => a.t - b.t)
    for (const m of marks) {
      this.wait(t0 + m.t - this.now)
      this.body = m.k === 'move' ? move(G, this.body, axis, dir, this.now, this.solid) : jump(G, this.body, this.now, this.solid)
    }
    for (let i = 0; i < 200 && this.body.arc; i++) this.wait(16)
    expect(this.body.arc, `landed after a jump, at ${this.at}`).toBeNull()
  }
  walkTo(axis: 'x' | 'z', target: number): void {
    const off = (axis === 'x' ? B.x : B.z)
    for (let i = 0; i < 80; i++) {
      const cur = Number(this.body.at[axis] - off)
      if (cur === target) return
      const before = this.at
      this.press(axis, target > cur ? 1 : -1)
      if (this.at === before) throw new Error(`stuck at ${this.at} walking ${axis} to ${target}`)
    }
  }
}

let world: WorldShard[] = []
let entry: Position = TUTORIAL_ENTRY
beforeAll(async () => {
  const w = await loadWorld(G)
  world = w.shards
  entry = w.entry
}, 60_000)

describe('the tutorial dungeon', () => {
  it('reads its world: the entry marker and every piece of the layout, from the DEV fixture', () => {
    expect(world.length).toBe(15)
    // The world marks the entry point (DECK-0002 §2.2): where the generator put the marker.
    expect(entry).toEqual(TUTORIAL_ENTRY)
  })

  it('is cleared start to finish: pad, the climb, the key, the gate, the exit', () => {
    const p = new Player(world, entry)
    // The entry point stands on the arrival hall's floor.
    expect(standing(G, p.body.at, p.solid)).toBe(true)
    p.wait(200)
    expect(p.at).toBe('8,17,45')
    // Down the hall to the shrine; the pad's riser of 1 is climbed, and the pad sends you to the climb.
    p.walkTo('z', 26)
    p.press('z', -1)
    expect(p.at).toBe('40,17,45')
    // The climb. To the foot of the first platform, then up onto it: a jump of 3.
    p.walkTo('z', 42)
    p.walkTo('x', 41)
    p.jump('x', 1, [300, 410])
    expect(p.at).toBe('43,21,42')
    // Second platform: 3 up, a gap of 2.
    p.walkTo('z', 40)
    p.jump('z', -1, [200, 310])
    expect(p.at).toBe('43,24,38')
    // Third: level, a gap of 3.
    p.walkTo('z', 36)
    p.walkTo('x', 42)
    p.jump('x', -1, [120, 230, 340])
    expect(p.at).toBe('39,24,36')
    // The key's platform: 3 up, a gap of 2.
    p.walkTo('x', 37)
    p.walkTo('z', 38)
    p.jump('z', 1, [250, 360])
    expect(p.at).toBe('37,27,40')
    // TAKE is offered by the key, and only there.
    expect(offerAt(G, p.progress, p.body.at)).toBeNull()
    p.walkTo('z', 41)
    expect(offerAt(G, p.progress, p.body.at)).toBe('take')
    p.progress = takeKey(G, p.progress, p.body.at)!
    expect(p.progress.keyHeld).toBe(true)
    // Off the edge to the floor.
    p.walkTo('x', 35)
    p.press('x', -1)
    p.wait(1500)
    expect(p.at).toBe('34,17,41')
    // To the gate: shut until OPEN with the key.
    p.walkTo('x', 40)
    p.walkTo('z', 33)
    p.press('z', -1, 3)
    expect(p.at).toBe('40,17,33')
    expect(offerAt(G, p.progress, p.body.at)).toBe('open')
    p.progress = openDoor(G, p.progress, p.body.at)!
    expect(p.progress.doorOpen).toBe(true)
    // Through the gate and down the hall to the exit shrine's finish tile.
    p.walkTo('z', 11)
    p.press('z', -1)
    expect(p.at).toBe('40,18,10')
    p.now = 200_000
    p.progress = reachExit(G, p.progress, p.body.at, p.now)
    expect(p.progress.clearedMs).toBe(200_000)
  })

  it('joins the arrival to the climb only by the pad', () => {
    // The arrival hall's sealed end and the shrine's back wall hold: nowhere to go but the pad.
    const p = new Player(world, entry)
    p.press('z', 1, 4)
    expect(Number(p.body.at.z - B.z)).toBeLessThan(48)
    p.walkTo('x', 8)
    for (const dir of [1, -1] as const) {
      const q = new Player(world, at(8, 17, 40))
      q.press('x', dir, 6)
      expect(Math.abs(Number(q.body.at.x - B.x) - 8)).toBeLessThanOrEqual(3)
    }
  })

  it('holds you at the gate until it is opened', () => {
    const p = new Player(world, at(40, 17, 35))
    p.press('z', -1, 6)
    expect(p.at).toBe('40,17,33')
    expect(offerAt(G, p.progress, p.body.at)).toBe('locked')
    expect(openDoor(G, p.progress, p.body.at)).toBeNull()
  })

  it('puts the key out of reach without jumping', () => {
    // Walking and the stair rule never leave the floor in the climb: every platform is a jump of 3 or more.
    const p = new Player(world, at(40, 17, 45))
    for (const [axis, target] of [['x', 44], ['z', 36], ['x', 36], ['z', 43], ['x', 40]] as const) {
      for (let i = 0; i < 12; i++) p.press(axis, Number((axis === 'x' ? p.body.at.x - B.x : p.body.at.z - B.z)) < target ? 1 : -1)
      expect(Number(p.body.at.y - B.y)).toBe(17)
    }
  })
})
