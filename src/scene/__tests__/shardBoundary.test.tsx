/**
 * shardBoundary.test.tsx - one shard that cannot be drawn is drawn as nothing,
 * and never takes the page with it. A throw while building geometry reached the
 * root, and <Scene /> has no boundary of its own.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ShardBoundary } from '../ShardMesh'

const a = { id: 'a' }
const b = { id: 'b' }

describe('a shard that cannot be drawn', () => {
  it('draws nothing once it has thrown', () => {
    expect(ShardBoundary.getDerivedStateFromError()).toEqual({ broken: true })
    const boundary = new ShardBoundary({ shard: a, children: 'drawn' })
    expect(boundary.render()).toBe('drawn')
    boundary.state = { broken: true, shard: a }
    expect(boundary.render()).toBeNull()
  })

  it('gets a new try with a new model, and only then', () => {
    expect(ShardBoundary.getDerivedStateFromProps({ shard: a }, { shard: a })).toBeNull()
    expect(ShardBoundary.getDerivedStateFromProps({ shard: b }, { shard: a })).toEqual({ broken: false, shard: b })
  })

  it('says why', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    new ShardBoundary({ shard: a, children: null }).componentDidCatch(new Error('no vertices'))
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('stands in ShardMesh itself, so every place that draws a shard has it', () => {
    const source = readFileSync(resolve(__dirname, '../ShardMesh.tsx'), 'utf8')
    expect(source).toMatch(/export function ShardMesh\(props: Props\): ReactNode \{\s+return <ShardBoundary shard=\{props\.shard\}><ShardMeshBody \{\.\.\.props\} \/><\/ShardBoundary>/)
  })
})
