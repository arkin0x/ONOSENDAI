/**
 * blueprintPrizePicker.test.tsx - the BLUEPRINT tool's prize step (owner,
 * 2026-11-27): no folder management inside the picker, only a read-only
 * folder filter; one tap chooses a published object; USE AS PRIZE includes
 * and chooses an unpublished one at once, LEAVE OUT clears both; a kit piece
 * is never choosable.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size }, clear: () => m.clear(), getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null, removeItem: (k: string) => { m.delete(k) }, setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})
vi.mock('../modalStack', () => ({ useModalStack: () => {}, Stacked: ({ children }: { children: ReactNode }) => children, leaveModals: () => {} }))
vi.mock('../ItemThumb', async () => {
  const { createElement: h } = await import('react')
  return { ItemThumb: ({ shard }: { shard?: { name?: string } }) => h('i', { 'data-thumb': shard?.name ?? '' }) }
})
vi.mock('../blueprint/BlueprintModel', async () => {
  const { createElement: h } = await import('react')
  return { BlueprintModel: () => h('i', { 'data-model': '' }) }
})
vi.mock('../blueprint/ExamineSheet', () => ({ ExamineSheet: () => null }))

import { mount, textOf } from '../../test/elementRoot'
import { BlueprintTool } from '../blueprint/BlueprintTool'
import { useBlueprintTool } from '../../store/useBlueprintTool'
import { useWorkshop } from '../../store/useWorkshop'
import { usePublished } from '../../store/usePublished'
import { useShardFolders } from '../../store/useShardFolders'
import { useCyberspace } from '../../store/useCyberspace'
import { includedPrizes, markKitPieces } from '../../lib/blueprint/prizeGuard'
import type { ShardModel } from 'sno-core/shards'

const shard = (id: string, name: string): ShardModel => ({ id, name, unit: 0, mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]], colors: [], updatedAt: 1 } as unknown as ShardModel)

beforeEach(() => {
  const me = useCyberspace.getState().identity.pubkey || 'f'.repeat(64)
  useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: me } })
  markKitPieces(['tile-kit/arch'])
  useWorkshop.setState({ shards: [shard('torch', 'Torch'), shard('key', 'Silver Key'), shard('tile-kit/arch', 'Arch')] })
  usePublished.setState({ ledger: { torch: { at: 1, fp: '', pubkey: me } } })
  useShardFolders.setState({ storage: 'memory', tree: { folders: { f1: { id: 'f1', name: 'Folder 1', parent: null, at: 1 } }, assign: { torch: 'f1' }, collapsed: {}, alias: {} } })
  useBlueprintTool.setState({ open: true, view: 'make', step: 1, prize: null, arrangement: { size: [1, 1, 1], cells: Uint16Array.from([1]) } })
})

describe('the prize step', () => {
  it('has no folder management: only a read-only filter of chips', async () => {
    const m = await mount(createElement(BlueprintTool))
    const words = m.all().filter((h) => h.type === 'button').map((b) => textOf(b).trim())
    for (const banned of [/new folder/i, /rename/i, /delete/i, /^select$/i, /^move/i, /^folder$/i]) expect(words.some((w) => banned.test(w))).toBe(false)
    expect(words).toContain('ALL')
    expect(words).toContain('Folder 1')
    await m.press('Folder 1')
    expect(m.says('Silver Key')).toBe(false)
    expect(m.says('Torch')).toBe(true)
    await m.press('ALL')
    expect(m.says('Silver Key')).toBe(true)
    await m.unmount()
  })

  it('one tap chooses a published object; USE AS PRIZE includes and chooses an unpublished one; LEAVE OUT clears both', async () => {
    const m = await mount(createElement(BlueprintTool))
    await m.press(/^TorchPublished$/)
    expect(useBlueprintTool.getState().prize?.shard.id).toBe('torch')
    await m.press('USE AS PRIZE')
    expect(useBlueprintTool.getState().prize?.shard.id).toBe('key')
    expect(includedPrizes().has('key')).toBe(true)
    await m.press('LEAVE OUT')
    expect(useBlueprintTool.getState().prize).toBeNull()
    expect(includedPrizes().has('key')).toBe(false)
    await m.unmount()
  })

  it('a kit piece is never choosable', async () => {
    const m = await mount(createElement(BlueprintTool))
    expect(m.says('From a kit: never a prize')).toBe(true)
    expect(m.buttons(/Arch/)).toHaveLength(0)
    await m.unmount()
  })
})
