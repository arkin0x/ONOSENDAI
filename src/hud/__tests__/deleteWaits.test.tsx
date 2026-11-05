/**
 * deleteWaits.test.tsx: DELETE on the card waits while a hide is going out
 * (review 3 of #595). Both rewrite the same bag; at the same moment one could
 * drop the other's change. Rendered.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({
  // The backup relay's sign-in line (RelayTrouble BackupTrouble): signed in.
  onAuthChange: () => () => {},
  signInFailed: () => false,
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards } from '../../store/useShards'
import { useOpenedChests } from '../../store/useOpenedChests'
import { DELETE_WAITS, SecretModal } from '../SecretModal'

function render(): string {
  for (const store of [useShards, useInventory, useCyberspace, useOpenedChests] as const) Object.assign(store.getInitialState(), store.getState())
  return renderToStaticMarkup(<SecretModal />)
}

/** The DELETE button's opening tag. */
const deleteButton = (html: string): string => html.match(/<button[^>]*>DELETE<\/button>/)?.[0] ?? ''

beforeEach(async () => {
  useCyberspace.setState({ live: false, cursor: { x: 1n << 40n, y: 1n << 40n, z: 1n << 40n } })
  useShards.setState({ mine: [], discovered: {}, deleted: {}, pending: null, placedLast: null, deployHeight: 3, deployStatus: 'idle', deployError: null, selectedSecret: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
  useShards.getState().startDeployMessage('meet at the fountain')
  useShards.setState({ deployHeight: 3 })
  await useShards.getState().deploy()
  useShards.setState({ pending: null, placedLast: null, deployStatus: 'idle', selectedSecret: useShards.getState().mine[0].eventId })
})

describe('DELETE on the card while a hide is going out', () => {
  it('is offered as usual when nothing is hiding', () => {
    const b = deleteButton(render())
    expect(b).not.toBe('')
    expect(b).not.toContain('disabled')
  })

  it('waits, and says why, while a hide is going out', () => {
    useShards.setState({ deployStatus: 'working' })
    const b = deleteButton(render())
    expect(b).toContain('disabled')
    expect(b).toContain(DELETE_WAITS)
  })
})
