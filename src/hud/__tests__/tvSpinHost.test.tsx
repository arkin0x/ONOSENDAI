/**
 * tvSpinHost.test.tsx: the segment's turning shard keeps one canvas while the
 * set is on, there with a shard and without one (review of #394): a host
 * that came and went with its shard made a WebGL context per segment.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ShardModel } from 'sno-core/shards'

// The canvas itself needs WebGL: a stand-in that says what it was given.
vi.mock('../../scene/ShardSpin', () => ({
  ShardSpin: ({ shard }: { shard: ShardModel | null }) => <i className="spin" data-shard={shard?.name ?? ''} />,
}))
vi.mock('../../workshop/ObjectPicker', () => ({
  objectsOf: () => [{ shard: { name: 'RELIC' } }],
}))
// Rendered on the server a store reads its first state: the shot comes from here.
const tv: { shot: unknown } = { shot: null }
vi.mock('../../store/useTv', () => ({
  useTv: (pick: (s: typeof tv) => unknown) => pick(tv),
  placeable: () => true,
}))

import { TvSpinHost } from '../TvSegments'

const shot = (item: unknown): never => ({ id: 'x', kind: 'object', pubkey: 'p', beats: [], start: 1, end: 2, offsets: [], length: 5, item }) as never

describe('the TV spin host', () => {
  it('keeps its canvas with no shard on screen, empty', () => {
    tv.shot = shot({ kind: 'bag', id: 'b' })
    const html = renderToStaticMarkup(<TvSpinHost />)
    expect(html).toContain('tv__spinhost')
    expect(html).toContain('class="spin" data-shard=""')
  })

  it('and with one, the same canvas with the shard in it', () => {
    tv.shot = shot({ kind: 'object', id: 'o', event: {} })
    const html = renderToStaticMarkup(<TvSpinHost />)
    expect(html).toContain('tv__spinhost')
    expect(html).toContain('data-shard="RELIC"')
  })
})
