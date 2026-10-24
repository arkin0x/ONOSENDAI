/**
 * benchMemo.test.ts: Bench stays memoized, and mounted with no props.
 *
 * Bench takes no props, so its only legitimate reason to redraw is its own
 * store reads. Workshop.tsx is one large component with its own local state
 * (menus, panels, pickers, drag-and-drop); any one of those re-renders
 * Workshop, and a plain `Bench` function component would re-execute right
 * along with it, and re-execute every child in its JSX (Grid, Ghost,
 * Handles, ShardMesh) whether or not anything they read had changed.
 * On a Maze Kit Basilica nave (1,896 vertices, ~290 deduplicated handle
 * points) a single tap on the canvas was measured to force that whole
 * subtree to re-render roughly 280 times in a few seconds, none of them a
 * real store change, for seconds of blocked main thread (arkinox,
 * 2026-10-23, scripts/perf-bench-orbit.mjs). `memo(BenchImpl)` lets React's
 * default comparison (no props, always equal) skip Bench on every
 * parent-driven re-render that is not its own.
 *
 * A full render (jsdom, a real WebGL context) is more than this regression
 * is worth; what must hold is the wrapping and the call site, which this
 * pins down at the source so a future edit that drops the memo(), quietly
 * turns Bench into a component that takes props (defeating the default,
 * props-only comparison), or mounts it with a `key` (forcing a remount
 * memo cannot prevent) fails a test instead of only showing up as a slow
 * bench.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const benchText = readFileSync(join(__dirname, '..', 'Bench.tsx'), 'utf8')
const workshopText = readFileSync(join(__dirname, '..', 'Workshop.tsx'), 'utf8')

describe('Bench', () => {
  it('is exported as memo(BenchImpl), a zero-parameter component, not a plain function component', () => {
    expect(benchText).toMatch(/export const Bench = memo\(BenchImpl\)/)
    expect(benchText).toMatch(/function BenchImpl\(\): JSX\.Element \{/)
    expect(benchText).not.toMatch(/export function Bench\(/)
  })

  it('is mounted with no props and no key, so memo\'s default comparison applies and nothing forces a remount', () => {
    const mount = workshopText.match(/<Bench\s*\/>/)
    expect(mount).not.toBeNull()
    // Any attribute at all (props or a key) would change what has to hold
    // for memo to skip a parent-driven re-render, or could force a remount
    // memo cannot prevent; <Bench /> must stay exactly bare.
    expect(workshopText).not.toMatch(/<Bench\s+\w/)
  })
})
