/**
 * moveWaitWords.test.ts - what a move waits on reaches the screen: the touch
 * button, and the desktop panel while on a route (review of #581).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
})

import { routeDoing } from '../ProofPanel'

const running = { status: 'running', awaiting: null, step: { kind: 'hop', source: 'local', maxHeight: 1 } } as never
const cloud = { status: 'idle', progress: null } as never

describe('a route step', () => {
  it('says what it waits on', () => {
    expect(routeDoing(running, { progress: 1, message: 'Waiting for your signer.' }, cloud)).toBe('Waiting for your signer.')
  })
  it('counts when nothing is waiting', () => {
    expect(routeDoing(running, { progress: 0.42, message: null }, cloud)).toBe('computing 42%')
  })
})

describe('the touch move button', () => {
  it('reads busyLabel while computing', () => {
    const source = readFileSync(fileURLToPath(new URL('../TouchControls.tsx', import.meta.url)), 'utf8')
    expect(source).toContain('computing ? busyLabel(proof)')
  })
})
