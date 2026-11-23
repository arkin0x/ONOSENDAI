/**
 * tutorialDungeon.test.ts - the tutorial dungeon can be cleared, start to
 * finish, by the game's own rules against its real world: the DEV fixture's
 * bags, opened with their keys, its shards' real walls, gravity and jumps
 * (lib/games/gravity.ts), the pad, the key, the gate and the exit zone
 * (lib/games/progress.ts, lib/games/keyDoor.ts). Every jump is pressed the
 * way a player presses it: JUMP, then a direction a few times while in the
 * air, on a 16 ms frame clock. Nothing is signed or sent: this is the game
 * logic alone.
 *
 * Both worlds are played: the one with a real key item and door (the DEV
 * fixture as it is now, and the owner's world to be published), and the
 * LEGACY one published 2026-11-13, with a game-only key and gate (the v1 DEV
 * fixture), which this client must keep playing until the world switches.
 *
 * It also checks the dungeon is a dungeon: the arrival does not join the
 * climb but by the pad, the gate holds until it is opened, and the key
 * platform cannot be reached without jumping.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { loadWorld } from '../world'
import { FALLOUT_PAD, TUTORIAL_ENTRY, TUTORIAL_GAME } from '../tutorialGame'
import { padUnder, type WorldShard } from '../play'
import { jump, move, standing, tick, type Body } from '../gravity'
import { offerHere, openDoor, reachExit, startProgress, takeKey, type Offer, type Progress } from '../progress'
import { doorKey, doorSecretWith, inKeyBag, keyItemHeld, readKeyBag, readRoom, sceneNow, thingsNow, type Scene } from '../keyDoor'
import { heldFromFind, heldFromForged, type HeldItem } from '../../inventory'
import { keyInnerTemplate, type Hidden } from '../../hidden'
import { forgeKey } from '../../chests'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../events'
import type { GameDef } from '../types'
import type { Position } from '../../space'

/** The world with a real key item and door: the DEV fixture. */
const G = TUTORIAL_GAME
/** The LEGACY world, published 2026-11-13: the same game, its world the v1 fixture. */
const V1: GameDef = { ...TUTORIAL_GAME, world: { kind: 'fixture', load: async () => (await import('./tutorialDungeon.v1.fixture.json')).default.events } }
const ME = 'ab'.repeat(32)
const B = G.region.base
const at = (x: number, y: number, z: number): Position => ({ x: B.x + BigInt(x), y: B.y + BigInt(y), z: B.z + BigInt(z) })
const rel = (p: Position): string => `${p.x - B.x},${p.y - B.y},${p.z - B.z}`

/** A player driven through the game logic on a frame clock, the way GameView drives the store. */
class Player {
  body: Body
  now = 0
  progress: Progress = startProgress(0)
  /** The key items the key bag revealed, and this player's ITEMS (store/useInventory, here a record). */
  keys: Hidden[] = []
  items: Record<string, HeldItem> = {}
  room: WorldShard[] | null = null
  constructor(public world: readonly WorldShard[], start: Position, public door: Hidden | null = null, public game: GameDef = G) { this.body = { at: start, arc: null, doubled: false } }
  get scene(): Scene { return { shards: this.world, door: this.door, room: this.room } }
  get solid(): WorldShard[] { return sceneNow(this.game, this.scene, this.progress).solid }
  get at(): string { return rel(this.body.at) }
  get offer(): Offer { return offerHere(thingsNow(this.game, { door: this.door, keys: this.keys }, this.progress, this.items, ME), this.progress, this.body.at) }
  /** Standing in the key bag's region, the bag is opened (useGame reveal). */
  async reveal(): Promise<void> {
    if (this.door && inKeyBag(this.game, this.body.at) && this.keys.length === 0) this.keys = await readKeyBag(this.game)
  }
  /** TAKE: a real key item into ITEMS, or the LEGACY key into hand. */
  take(): boolean {
    if (!this.door) { const pr = takeKey(this.game, this.progress, this.body.at); if (pr) this.progress = pr; return !!pr }
    if (this.offer !== 'take') return false
    const k = this.keys.find((h) => !keyItemHeld(this.items, h))!
    const row = heldFromFind(ME, k, 0)!
    this.items = { ...this.items, [row.id]: row }
    return true
  }
  /** OPEN: the door with the held key item and its room read, or the LEGACY gate with the key in hand. */
  async open(): Promise<boolean> {
    if (!this.door) { const pr = openDoor(this.game, this.progress, this.body.at); if (pr) this.progress = pr; return !!pr }
    if (this.offer !== 'open') return false
    const secret = doorSecretWith(this.door, doorKey(this.door, this.items, ME)!)
    if (!secret) return false
    this.progress = { ...this.progress, doorOpen: true }
    this.room = (await readRoom(this.game, this.door, secret)).shards
    return true
  }
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
let door: Hidden | null = null
let entry: Position = TUTORIAL_ENTRY
let v1World: WorldShard[] = []
beforeAll(async () => {
  const w = await loadWorld(G)
  world = w.shards
  door = w.door
  entry = w.entry
  const old = await loadWorld(V1)
  v1World = old.shards
  expect(old.door).toBeNull()
}, 60_000)

/** The run to the top platform, from the entry: pad, then four jumps. */
function climb(p: Player): void {
  // The entry point stands on the arrival hall's floor.
  expect(standing(p.game, p.body.at, p.solid)).toBe(true)
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
}

/** From the key, off the platform, to the gate and through it, to the finish tile. */
async function gateAndExit(p: Player): Promise<void> {
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
  expect(p.offer).toBe('open')
  expect(await p.open()).toBe(true)
  expect(p.progress.doorOpen).toBe(true)
  // Through the gate and down the hall to the exit shrine's finish tile.
  p.walkTo('z', 11)
  p.press('z', -1)
  expect(p.at).toBe('40,18,10')
  p.now = 200_000
  p.progress = reachExit(p.game, p.progress, p.body.at, p.now)
  expect(p.progress.clearedMs).toBe(200_000)
}

describe('the tutorial dungeon, its key item and door (DECK-0004)', () => {
  it('reads its world: the entry marker, the door and the eleven pieces that stay in the world bag', () => {
    expect(world.length).toBe(11)
    expect(door).not.toBeNull()
    expect(door!.chest?.door).toBe(5)
    // The world marks the entry point (DECK-0002 §2.2): where the generator put the marker.
    expect(entry).toEqual(TUTORIAL_ENTRY)
  })

  it('is cleared start to finish: pad, the climb, the key bag opened on the platform, TAKE into ITEMS, OPEN, the exit', async () => {
    const p = new Player(world, entry, door)
    climb(p)
    // Nothing of the key until its bag is opened, which only standing in its region does.
    expect(p.keys).toHaveLength(0)
    expect(p.offer).toBeNull()
    await p.reveal()
    expect(p.keys).toHaveLength(1)
    expect(p.keys[0].key?.name).toBe('Tutorial Dungeon Key')
    // TAKE is offered by the key, and only there.
    expect(p.offer).toBeNull()
    p.walkTo('z', 41)
    expect(p.offer).toBe('take')
    expect(p.take()).toBe(true)
    expect(Object.values(p.items).map((it) => it.type)).toEqual(['key'])
    expect(p.offer).toBeNull()
    expect(p.take()).toBe(false)
    // The finish tile is behind the door: not in the world until the room is read.
    expect(p.solid.some((w) => w.shard.name.includes('checkered'))).toBe(false)
    await gateAndExit(p)
    expect(p.room!.map((w) => w.shard.name)).toEqual(['Maze Kit: aerocarnival checkered tile 4'])
  })

  it('joins the arrival to the climb only by the pad', () => {
    // The arrival hall's sealed end and the shrine's back wall hold: nowhere to go but the pad.
    const p = new Player(world, entry, door)
    p.press('z', 1, 4)
    expect(Number(p.body.at.z - B.z)).toBeLessThan(48)
    p.walkTo('x', 8)
    for (const dir of [1, -1] as const) {
      const q = new Player(world, at(8, 17, 40), door)
      q.press('x', dir, 6)
      expect(Math.abs(Number(q.body.at.x - B.x) - 8)).toBeLessThanOrEqual(3)
    }
  })

  it('holds you at the gate until it is opened: its closed look is its own, and no key opens it but the one', async () => {
    const p = new Player(world, at(40, 17, 35), door)
    p.press('z', -1, 6)
    expect(p.at).toBe('40,17,33')
    expect(p.offer).toBe('locked')
    expect(await p.open()).toBe(false)
    // Another key item, held, opens nothing here: only the one the door is sealed to.
    const wrong = forgeKey('Another key')
    const ev = finalizeEvent(keyInnerTemplate(wrong, at(1, 1, 1), 1, 0), generateSecretKey()) as NostrEvent
    const row = heldFromForged(ME, ev, wrong, { lookupId: '', bagId: '', at: { x: '0', y: '0', z: '0' }, plane: 1, height: 1 }, 0)
    p.items = { [row.id]: row }
    expect(doorKey(door!, p.items, ME)).toBeNull()
    expect(p.offer).toBe('locked')
  })

  it('opens the key bag only in its region: not from the floor, not from the platform below', () => {
    expect(inKeyBag(G, at(37, 27, 40))).toBe(true)
    expect(inKeyBag(G, at(39, 27, 44))).toBe(true)
    expect(inKeyBag(G, at(40, 17, 45))).toBe(false)
    expect(inKeyBag(G, at(39, 24, 36))).toBe(false)
    expect(inKeyBag(G, at(43, 24, 38))).toBe(false)
  })

  it('puts the key out of reach without jumping', () => {
    // Walking and the stair rule never leave the floor in the climb: every platform is a jump of 3 or more.
    const p = new Player(world, at(40, 17, 45), door)
    for (const [axis, target] of [['x', 44], ['z', 36], ['x', 36], ['z', 43], ['x', 40]] as const) {
      for (let i = 0; i < 12; i++) p.press(axis, Number((axis === 'x' ? p.body.at.x - B.x : p.body.at.z - B.z)) < target ? 1 : -1)
      expect(Number(p.body.at.y - B.y)).toBe(17)
    }
  })
})

/**
 * The way back in for a player who fell out (owner, 2026-11-13): the
 * rotunda's oculus is open, a double jump from the key platform goes up
 * through it onto the dome, and off the dome a player falls to the region's
 * lower edge. A pad on that floor, directly under the oculus, sends them back
 * to the arrival.
 */
describe('falling out of the tutorial dungeon', () => {
  /** The key taken, then up through the oculus onto the dome: the owner's way out. */
  async function outOnTheDome(): Promise<Player> {
    const p = new Player(world, at(39, 27, 41), door)
    p.wait(100)
    expect(p.at).toBe('39,27,41')
    await p.reveal()
    expect(p.take()).toBe(true)
    p.walkTo('z', 40)
    // JUMP, a gibson into the oculus while rising, the double jump up through it, and a gibson over onto the dome.
    p.jump('x', 1, [100, 450], 300)
    expect(p.at).toBe('41,32,40')
    return p
  }

  it('the open oculus lets a player climb out onto the dome', async () => {
    await outOnTheDome()
  })

  it('off the dome, the region\'s floor holds the faller, right by the pad under the oculus', async () => {
    const p = await outOnTheDome()
    p.walkTo('x', 47)
    for (let i = 0; i < 6 && p.body.at.y - B.y > 0n; i++) { p.press('x', 1); p.wait(3000) }
    // The region's lower edge is the floor (gravity.ts standing): nothing else stops the fall.
    expect(Number(p.body.at.y - B.y)).toBe(0)
    expect(standing(G, p.body.at, p.solid)).toBe(true)
    // The pad stands one under that floor, directly under the oculus, holding whoever stands on it.
    expect(FALLOUT_PAD.at).toEqual(at(40, -1, 40))
    expect(padUnder(G, at(40, 0, 40))).toBe(FALLOUT_PAD)
    expect(G.pads).toContain(FALLOUT_PAD)
    expect(Math.abs(Number(p.body.at.x - B.x) - 40) + Math.abs(Number(p.body.at.z - B.z) - 40)).toBeLessThanOrEqual(12)
  })

  it('the pad sends the faller back to the arrival, the key still in ITEMS, the clock still running', async () => {
    const p = await outOnTheDome()
    p.walkTo('x', 47)
    for (let i = 0; i < 6 && p.body.at.y - B.y > 0n; i++) { p.press('x', 1); p.wait(3000) }
    const started = p.progress.startedAt
    // Back toward the oculus along the floor: the first press onto the pad sends you on.
    expect(Number(p.body.at.z - B.z)).toBe(40)
    for (let i = 0; i < 20 && p.body.at.y === B.y; i++) p.press('x', -1)
    expect(p.body.at).toEqual(TUTORIAL_ENTRY)
    expect(p.body.at).toEqual(entry)
    // Standing there, on the arrival hall's floor.
    p.wait(200)
    expect(p.at).toBe('8,17,45')
    expect(doorKey(door!, p.items, ME)).not.toBeNull()
    expect(p.progress.startedAt).toBe(started)
    expect(p.progress.clearedMs).toBeNull()
  })

  it('a fall off the hall roof lands on the same floor, and walks to the pad', async () => {
    const p = await outOnTheDome()
    // South off the dome onto the hall's roof, then off its side.
    p.walkTo('z', 36)
    for (let i = 0; i < 12 && Number(p.body.at.z - B.z) > 20; i++) { p.press('z', -1); p.wait(1500) }
    expect(Number(p.body.at.y - B.y)).toBeGreaterThan(17)
    for (let i = 0; i < 8 && p.body.at.y - B.y > 0n; i++) { p.press('x', 1); p.wait(3000) }
    expect(Number(p.body.at.y - B.y)).toBe(0)
    p.walkTo('x', 40)
    for (let i = 0; i < 30 && p.body.at.y === B.y; i++) p.press('z', 1)
    expect(p.at).toBe('8,17,45')
  })

  it('every gibson of the region\'s floor is one open floor: the pad is reached on foot from anywhere', () => {
    // Walked from the pad's own cell, a press at a time: nothing stands on the floor, nothing below the rooms.
    const key = (x: number, z: number): number => x * 64 + z
    const seen = new Set<number>([key(40, 40)])
    const queue: Array<[number, number]> = [[40, 40]]
    const solid = sceneNow(G, { shards: world, door, room: null }, startProgress(0)).solid
    while (queue.length) {
      const [x, z] = queue.shift()!
      for (const [axis, dir] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]] as const) {
        const nx = axis === 'x' ? x + dir : x, nz = axis === 'z' ? z + dir : z
        if (nx < 0 || nx > 63 || nz < 0 || nz > 63 || seen.has(key(nx, nz))) continue
        const b = move(G, { at: at(x, 0, z), arc: null, doubled: false }, axis, dir, 0, solid)
        if (b.arc || b.at.y !== B.y || Number(b.at[axis] - (axis === 'x' ? B.x : B.z)) !== (axis === 'x' ? nx : nz)) continue
        seen.add(key(nx, nz))
        queue.push([nx, nz])
      }
    }
    expect(seen.size).toBe(64 * 64)
  })
})

/**
 * The LEGACY world, published 2026-11-13: no door in its bag, so the game-only
 * key and gate (lib/games/progress.ts). This client plays it until the world
 * with a real key item and door replaces it.
 */
describe('the LEGACY tutorial dungeon (the world published 2026-11-13)', () => {
  it('reads all fifteen pieces and no door', () => {
    expect(v1World.length).toBe(15)
  })

  it('is cleared start to finish with the game-only key and gate', async () => {
    const p = new Player(v1World, entry, null, V1)
    climb(p)
    expect(p.offer).toBeNull()
    p.walkTo('z', 41)
    expect(p.offer).toBe('take')
    expect(p.take()).toBe(true)
    expect(p.progress.keyHeld).toBe(true)
    // Nothing goes into ITEMS: the LEGACY key lives only in the game.
    expect(p.items).toEqual({})
    await gateAndExit(p)
    expect(p.progress.keyHeld).toBe(false)
  })

  it('holds you at the gate until it is opened', () => {
    const p = new Player(v1World, at(40, 17, 35), null, V1)
    p.press('z', -1, 6)
    expect(p.at).toBe('40,17,33')
    expect(p.offer).toBe('locked')
    expect(openDoor(V1, p.progress, p.body.at)).toBeNull()
  })
})
