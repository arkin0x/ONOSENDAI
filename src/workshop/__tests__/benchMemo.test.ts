/**
 * benchMemo.test.ts: Bench stays memoized.
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
 * is worth; what must hold is the wrapping itself, which this pins down at
 * the source so a future edit that drops the memo() or quietly turns Bench
 * into a component that takes props (defeating the default, props-only
 * comparison) fails a test instead of only showing up as a slow bench.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const text = readFileSync(join(__dirname, '..', 'Bench.tsx'), 'utf8')

describe('Bench', () => {
  it('is exported as memo(BenchImpl), not a plain function component', () => {
    expect(text).toMatch(/export const Bench = memo\(BenchImpl\)/)
    expect(text).toMatch(/function BenchImpl\(\): JSX\.Element/)
    expect(text).not.toMatch(/export function Bench\(/)
  })

  it('BenchImpl takes no props: memo\'s default (props-only) comparison can always bail out', () => {
    expect(text).toMatch(/function BenchImpl\(\): JSX\.Element \{/)
  })
})
