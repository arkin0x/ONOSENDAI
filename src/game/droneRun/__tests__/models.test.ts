/**
 * models.test.ts - the bundled drones, guns and effects load through
 * sno-core, every part resolves from the payloads' own tables with nothing
 * fetched (a relay, a fetch or a WebSocket asked for anything throws), and
 * the numbers the view uses come from rig.json.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/relay', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>()
  const refuse = (): never => { throw new Error('a relay was asked') }
  return { ...real, queryAny: refuse, queryOne: refuse, relaySet: refuse, subscribe: refuse, publish: refuse }
})

import { RIG, loadDroneRunModels, viewPlaceFor, type DroneRunModels } from '../models'

let models: DroneRunModels
const realFetch = globalThis.fetch
const realWs = (globalThis as { WebSocket?: unknown }).WebSocket

beforeAll(async () => {
  globalThis.fetch = (() => { throw new Error('fetch was called') }) as typeof fetch
  ;(globalThis as { WebSocket?: unknown }).WebSocket = class { constructor() { throw new Error('a WebSocket was opened') } }
  models = await loadDroneRunModels()
})

afterAll(() => {
  globalThis.fetch = realFetch
  ;(globalThis as { WebSocket?: unknown }).WebSocket = realWs
})

describe('the DRONE RUN models', () => {
  it('load with every part carried, nothing fetched', () => {
    expect(models.fetched).toBe(0)
    expect(Object.keys(models.drones).sort()).toEqual(['heavy', 'scout', 'sniper', 'swarmer'])
    for (const [id, d] of Object.entries(models.drones)) {
      const rig = RIG.drones[id]
      expect(d.body, id).not.toBeNull()
      // Every rig part is either a spinning face part or a glowing points part.
      expect(d.spin.length + d.glows.length, id).toBe(rig.parts.length)
      expect(d.spin.length, id).toBe(rig.parts.filter((p) => p.spinAxis).length)
    }
  })

  it('places each part where rig.json pivots it, and spins it at its rate', () => {
    for (const [id, d] of Object.entries(models.drones)) {
      const rig = RIG.drones[id]
      for (const part of d.spin) {
        const r = rig.parts.find((p) => p.part === part.name)!
        expect(r, `${id} ${part.name}`).toBeTruthy()
        const e = part.matrix.elements
        expect(e[12]).toBeCloseTo(r.pivot[0], 2)
        expect(e[13]).toBeCloseTo(r.pivot[1], 2)
        expect(e[14]).toBeCloseTo(r.pivot[2], 2)
        expect(part.revPerS).toBe(r.spinRevPerS)
        // Its own +Y lands on rig.json's spin axis (a part placed upside down turns the other way).
        expect(e[4]).toBeCloseTo(r.spinAxis![0], 6)
        expect(e[5]).toBeCloseTo(r.spinAxis![1], 6)
        expect(e[6]).toBeCloseTo(r.spinAxis![2], 6)
      }
      expect(d.muzzles).toEqual(rig.muzzles)
      expect(d.across).toBe(rig.across)
    }
  })

  it('reads the glowing parts with their glow', () => {
    const eye = models.drones.scout.glows.find((g) => g.name === 'eye')!
    expect(eye.positions.length).toBeGreaterThan(0)
    expect(eye.radius).toBeGreaterThan(0)
    expect(eye.strength).toBeGreaterThan(0)
    // The scout's eye sits at its front (+Z, the payloads' own frame).
    expect(eye.positions[2]).toBeGreaterThan(0.3)
  })

  it('takes the viewmodel places, muzzles and flashes from rig.json', () => {
    for (const [id, w] of Object.entries(models.weapons)) {
      const rig = RIG.weapons[id]
      expect(w.body, id).not.toBeNull()
      expect(viewPlaceFor(w, 375, 812)).toEqual(rig.viewmodel.phone)
      expect(viewPlaceFor(w, 1280, 720)).toEqual(rig.viewmodel.desktop)
      expect(w.muzzle).toEqual(rig.muzzle)
      expect(w.flash).toBe(rig.flash)
      expect(models.effects[w.flash], id).toBeTruthy()
      // The barrel runs toward -Z: the muzzle is ahead of the grip.
      expect(w.muzzle[2]).toBeLessThan(w.grip[2])
    }
  })

  it('reads every effect with its life and growth', () => {
    for (const [id, e] of Object.entries(models.effects)) {
      expect(e.positions.length, id).toBeGreaterThan(0)
      expect(e.lifeS).toBe(RIG.effects[id].lifeS)
      expect(e.grow).toBe(RIG.effects[id].grow)
      expect(e.radius, id).toBeGreaterThan(0)
    }
  })
})
