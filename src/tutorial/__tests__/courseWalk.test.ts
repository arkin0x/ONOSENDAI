/**
 * courseWalk.test.ts - the tutorial's bounce course, walked with the real
 * WALK code (store/walkWalls.ts stepLimit, store/walkGravity.ts fallLimit,
 * store/walkStep.ts walkStep) over the shards the stager really seals,
 * opened from the covering bag as discovery opens them, in all four ways the
 * layout can face (review of A3, 2026-11-10):
 *
 * - the gaps are 2, 3 and 3, edge to edge (the presses from the last cell
 *   a walker stands on to the first of the next), as the kit counts them:
 *   EASY at three presses a second (maze-kit docs/aerocarnival/README.md);
 * - the finish deck is 8 above the trampoline and further above everything
 *   else, out of reach of a jump and its double jump (7);
 * - the catch floor holds a walker under every gap, and from it the step
 *   behind the start walks back up onto the start square (risers 2, 1);
 * - the trampoline still bounces 12 once sealed and opened.
 */
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})
// Nothing here may reach a relay.
vi.mock('../../lib/relay', async (orig) => ({ ...(await orig<typeof import('../../lib/relay')>()), query: vi.fn(async () => []), publish: vi.fn(), publishMany: vi.fn() }))

import { generateSecretKey } from 'nostr-tools/pure'
import { regionKeyAt } from '../../lib/shardCrypto'
import { unbag } from '../../lib/hidden'
import { bounceOf } from '../../lib/walkBounce'
import type { Position } from '../../lib/space'
import { fallLimit } from '../../store/walkGravity'
import { walkStep } from '../../store/walkStep'
import { clearWalls, type WallItem } from '../../store/walkWalls'
import { regionBase, type TutorialLayout } from '../layout'
import { buildStage, type KeyAt } from '../stage'
import { courseToWorld } from '../course'

const keyAt: KeyAt = async (at, h) => { const rk = regionKeyAt(at, h, 20); return { key: rk.key, lookupId: rk.lookupId } }
const BASE = 1n << 40n

/** A layout facing `fwd` and `side`, in the largest cover around a spawn far from its edges. */
function layoutFacing(fwd: 1 | -1, side: 1 | -1): TutorialLayout {
  const spawn: Position = { x: BASE + 2000n, y: BASE + 2000n, z: BASE + 2000n }
  const own = regionBase(spawn, 3)
  return { plane: 0, spawn, frame: { fwd, side, boxBase: { x: own.x, y: own.y, z: own.z + BigInt(fwd) * 8n } }, cover: { height: 12, base: regionBase(spawn, 12) } }
}

/** The course's shards as WALK meets them: opened from the covering bag, at the places they were sealed. */
async function courseWalls(layout: TutorialLayout): Promise<{ items: WallItem[]; bounces: number[] }> {
  const stage = await buildStage(generateSecretKey(), 'a'.repeat(64), layout, keyAt)
  const cover = stage.bags[0]
  const rk = regionKeyAt(layout.cover.base, layout.cover.height, 20)
  const found = await unbag(cover, rk.key, undefined, { at: regionBase(layout.cover.base, layout.cover.height), plane: layout.plane }, layout.cover.height)
  const items: WallItem[] = found.filter((h) => h.type === 'shard' && h.shard && h.eventId !== stage.ids.blueBox).map((h) => ({ key: h.eventId, at: h.at, height: h.height, plane: h.plane, shard: h.shard!, author: h.author, mine: false }))
  return { items, bounces: items.map((w) => { const b = bounceOf(w.shard); return typeof b === 'number' ? b : -1 }).filter((b) => b > 0) }
}

/** Where a walker dropped over course (x, z) from high up comes to stand, as a course y, or null for nowhere. */
function standAt(layout: TutorialLayout, items: WallItem[], x: number, z: number): number | null {
  const from = courseToWorld(layout.frame, [x, 30, z])
  const f = fallLimit(from, items, () => true)
  if (!f.lands) return null
  return 30 - Number(f.drop)
}

/** The course z cells along x 0 where a walker stands at course height `y`. */
function cellsAt(layout: TutorialLayout, items: WallItem[], y: number, from: number, to: number): number[] {
  const out: number[] = []
  for (let z = from; z <= to; z++) if (standAt(layout, items, 0, z) === y) out.push(z)
  return out
}

describe.each([[1, 1], [1, -1], [-1, 1], [-1, -1]] as const)('the course, facing fwd %i side %i', (fwd, side) => {
  it('has gaps of 2, 3 and 3 edge to edge, a deck out of a jump\'s reach, a floor under it all and a way back up', async () => {
    clearWalls()
    const layout = layoutFacing(fwd, side)
    const { items, bounces } = await courseWalls(layout)
    expect(bounces).toEqual([12])

    // The run: where a walker stands at y 1 (or 2, on the trampoline), start square and line, then the squares.
    const run = [...cellsAt(layout, items, 1, -6, 27), ...cellsAt(layout, items, 2, -6, 27)].sort((a, b) => a - b)
    const groups: number[][] = []
    for (const z of run) { const g = groups[groups.length - 1]; if (g && z === g[g.length - 1] + 1) g.push(z); else groups.push([z]) }
    expect(groups.map((g) => [g[0], g[g.length - 1]])).toEqual([[-3, 6], [8, 12], [15, 19], [22, 27]])
    const gaps = groups.slice(1).map((g, i) => g[0] - groups[i][groups[i].length - 1])
    expect(gaps).toEqual([2, 3, 3])

    // The trampoline: a walker on it stands at 2; the deck at 10, 8 above it.
    expect(standAt(layout, items, 0, 25)).toBe(2)
    const deck = cellsAt(layout, items, 10, 26, 36)
    expect(deck[0]).toBe(28)
    expect(deck[deck.length - 1]).toBe(34)
    // Nothing a walker stands on without the trampoline is within 7 of the deck.
    for (const z of run) expect(10 - (standAt(layout, items, 0, z) ?? -99)).toBeGreaterThan(7)
    expect(10 - 2).toBeGreaterThan(7)

    // The catch floor under every gap and beside the run (stand at y -2).
    for (let z = -12; z <= 37; z++) {
      const s = standAt(layout, items, 6, z)
      expect(s, `floor at x 6 z ${z}`).toBe(-2)
    }
    for (const z of [7, 13, 14, 20, 21]) expect(standAt(layout, items, 0, z), `gap z ${z}`).toBe(-2)

    // Back up: from the floor behind the start, walking forward climbs the step and onto the start square.
    let at = courseToWorld(layout.frame, [0, -2, -10])
    const dir = layout.frame.fwd
    for (let n = 0; n < 10; n++) at = walkStep(at, 'z', dir, 1n, items, true).to
    const end = courseToWorld(layout.frame, [0, 1, 0])
    expect(at.y).toBe(end.y)
  })
})
