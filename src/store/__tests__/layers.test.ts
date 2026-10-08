/**
 * layers.test.ts - the DOTS and hX BOXES switches at the bottom of the
 * Movement Proof panel.
 *
 * Both layers start on, which is the scene as it has always looked. Turning
 * one off flips only that layer, is remembered on this device, and survives a
 * fresh load of the store. Storage that throws or is missing reads as both on
 * and never breaks a toggle. And the switches are a view preference only: the
 * proof, the cursor, the position and the route are the same objects after a
 * toggle as before it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Layers = typeof import('../useLayers')

function memoryStorage(seed: Record<string, string> = {}): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    map,
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k) },
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
  }
}

function blockedStorage(): Storage {
  const no = (): never => { throw new DOMException('The operation is insecure.', 'SecurityError') }
  return { length: 0, clear: no, getItem: no, key: no, removeItem: no, setItem: no }
}

const g = globalThis as { localStorage?: Storage }
const original = g.localStorage

/** A fresh copy of the store module, created against whatever storage is installed now. */
async function freshStore(storage: Storage | undefined): Promise<Layers> {
  if (storage === undefined) delete g.localStorage
  else g.localStorage = storage
  vi.resetModules()
  return import('../useLayers')
}

afterEach(() => {
  if (original === undefined) delete g.localStorage
  else g.localStorage = original
})

describe('scene layer switches', () => {
  it('start with both layers on', async () => {
    const { useLayers } = await freshStore(memoryStorage())
    expect(useLayers.getState().dots).toBe(true)
    expect(useLayers.getState().boxes).toBe(true)
  })

  it('turn off only the layer pressed, and remember it on this device', async () => {
    const storage = memoryStorage()
    const { useLayers, LAYERS_KEY } = await freshStore(storage)

    useLayers.getState().toggleLayer('dots')
    expect(useLayers.getState().dots).toBe(false)
    expect(useLayers.getState().boxes).toBe(true)
    expect(JSON.parse(storage.map.get(LAYERS_KEY) ?? 'null')).toEqual({ dots: false, boxes: true })

    // A reload: the store is created again from what was stored.
    const reloaded = await freshStore(storage)
    expect(reloaded.useLayers.getState().dots).toBe(false)
    expect(reloaded.useLayers.getState().boxes).toBe(true)

    reloaded.useLayers.getState().toggleLayer('boxes')
    reloaded.useLayers.getState().toggleLayer('dots')
    expect(reloaded.useLayers.getState()).toMatchObject({ dots: true, boxes: false })
    expect(JSON.parse(storage.map.get(LAYERS_KEY) ?? 'null')).toEqual({ dots: true, boxes: false })
  })

  it('read both on, and still toggle, when storage throws', async () => {
    const { useLayers, loadLayers, saveLayers } = await freshStore(blockedStorage())
    expect(useLayers.getState().dots).toBe(true)
    expect(useLayers.getState().boxes).toBe(true)
    expect(() => loadLayers()).not.toThrow()
    expect(() => saveLayers({ dots: false, boxes: false })).not.toThrow()
    expect(() => useLayers.getState().toggleLayer('boxes')).not.toThrow()
    // Kept in memory for the visit.
    expect(useLayers.getState().boxes).toBe(false)
  })

  it('read both on when there is no storage at all', async () => {
    const { useLayers } = await freshStore(undefined)
    expect(useLayers.getState()).toMatchObject({ dots: true, boxes: true })
    expect(() => useLayers.getState().setLayer('dots', false)).not.toThrow()
    expect(useLayers.getState().dots).toBe(false)
  })

  it('read both on from a corrupt or foreign stored value', async () => {
    for (const raw of ['{not json', 'null', '"off"', '{"dots":0,"boxes":"no"}']) {
      const { useLayers } = await freshStore(memoryStorage({ 'onosendai:layers': raw }))
      expect(useLayers.getState(), raw).toMatchObject({ dots: true, boxes: true })
    }
  })
})

describe('the switches leave the proof and movement alone', () => {
  let storage: Storage

  beforeEach(() => { storage = memoryStorage() })

  it('changes no proof, cursor, position, anchor, route or commit mode', async () => {
    const { useLayers } = await freshStore(storage)
    // Same module graph as the store above, so this is the live game state.
    const { useCyberspace } = await import('../useCyberspace')
    const S = () => useCyberspace.getState()
    const before = {
      proof: S().proof, cursor: S().cursor, position: S().position, anchor: S().anchor,
      plan: S().plan, moveMode: S().moveMode, scaleExp: S().scaleExp, plane: S().plane,
    }
    let writes = 0
    const unsub = useCyberspace.subscribe(() => { writes++ })

    useLayers.getState().toggleLayer('dots')
    useLayers.getState().toggleLayer('boxes')
    useLayers.getState().toggleLayer('dots')
    useLayers.getState().toggleLayer('boxes')
    unsub()

    expect(writes).toBe(0)
    expect(S().proof).toBe(before.proof)
    expect(S().cursor).toBe(before.cursor)
    expect(S().position).toBe(before.position)
    expect(S().anchor).toBe(before.anchor)
    expect(S().plan).toBe(before.plan)
    expect(S().moveMode).toBe(before.moveMode)
    expect(S().scaleExp).toBe(before.scaleExp)
    expect(S().plane).toBe(before.plane)
  })
})
