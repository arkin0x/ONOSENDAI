/**
 * quarryTriPack.test.ts - the Quarry Charge's Tri-Pack look (owner,
 * 2026-11-28): both models read, with their glowing parts and the hub
 * ring's motion, the armed one hotter; the fuse's own clock speeds the ring
 * up smoothly to the blast, written in one object with no allocation; and a
 * blueprint card drawn with the old box look is drawn again, once, keeping
 * everything else about it.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) }, clear: () => { mem.clear() }, key: () => null, get length() { return mem.size },
  }
}

import armedJson from '../quarryTriPackArmed.sno.json'
import restJson from '../quarryTriPack.sno.json'
import { QUARRY_BOX, QUARRY_LAMP, quarryArmedModel, quarryModel, quarryModelNow } from '../quarryModel'
import { FUSE_SPIN_GAIN, fuseClock, fuseSeconds } from '../../../scene/QuarryFx'
import { FUSE_MS } from '../../terrain/quarry'
import { useBlueprints } from '../../../store/useBlueprints'
import { useCyberspace } from '../../../store/useCyberspace'
import { QUARRY_CARD_ID, QUARRY_GIFT, giftRecord, grantQuarryIfDue, redrawIfStale, staleLook } from '../gameBlueprint'
import { readRecord } from '../format'

type Obj = { mode: string; glow?: [string, number, number]; anim?: unknown[]; vertices: number[][]; ticks: number[][] }
const parts = (j: unknown): Record<string, Obj> => Object.fromEntries(Object.entries((j as { objects: Record<string, Obj> }).objects).map(([k, v]) => [k.split('/').pop()!, v]))

describe('the Tri-Pack models', () => {
  it('both read, with their parts carried inside them (no fetch)', async () => {
    const [rest, armed] = await Promise.all([quarryModel(), quarryArmedModel()])
    expect(rest).not.toBeNull()
    expect(armed).not.toBeNull()
    expect(rest!.parts?.length).toBe(10)
    expect(armed!.parts?.length).toBe(10)
    expect(quarryModelNow()).toBe(rest)
    expect(quarryModelNow('armed')).toBe(armed)
  })

  it('the same metal, the armed light hotter and its ring turning faster; the lamp where QuarryFx flashes it', () => {
    const r = parts(restJson), a = parts(armedJson)
    expect((restJson as { vertices: unknown[] }).vertices).toEqual((armedJson as { vertices: unknown[] }).vertices)
    for (const k of ['lamp', 'hub-light', 'cap-lamps', 'seam-light']) expect(a[k].glow![1]).toBeGreaterThan(r[k].glow![1])
    const spin = (o: Obj) => (o.anim as Array<[string, string, number, number, number]>)[0]
    // A turn's third number is turns per its fourth's seconds: the armed ring turns 2 a second, the rest's 1 in 4.
    expect(spin(a['hub-light'])[2] / spin(a['hub-light'])[3]).toBeGreaterThan(spin(r['hub-light'])[2] / spin(r['hub-light'])[3])
    const lamp = a.lamp
    const y = lamp.vertices.reduce((n, v, i) => n + v[1] + lamp.ticks[i][1] / 120, 0) / lamp.vertices.length
    const part = (armedJson as { parts: number[][]; refs: string[][] }).parts.find((p) => (armedJson as { refs: string[][] }).refs[p[0]][1].endsWith('/lamp'))!
    expect(y + part[2] / 120).toBeCloseTo(QUARRY_LAMP[1], 0)
    expect(QUARRY_LAMP[1]).toBeLessThan(QUARRY_BOX.max[1])
  })
})

describe('the fuse speeds the ring up', () => {
  it('starts at the ring\'s own speed and ends 1 + gain times it, smoothly, every moment once', () => {
    const F = FUSE_MS / 1000
    const speed = (t: number) => (fuseSeconds(t + 1e-3) - fuseSeconds(t)) / 1e-3
    expect(speed(0)).toBeCloseTo(1, 2)
    expect(speed(F - 2e-3)).toBeCloseTo(1 + FUSE_SPIN_GAIN, 1)
    let last = 0
    for (let t = 0.1; t < F; t += 0.1) { const v = speed(t); expect(v).toBeGreaterThan(last); last = v }
    expect(fuseSeconds(1.5)).toBe(fuseSeconds(1.5))
  })

  it('a charge\'s clock moves the shared moment on, in one object written over', () => {
    const armedAt = 10_000
    const clock = fuseClock(armedAt)
    const a = clock({ t: 1000, version: 3, nowS: 12, chosen: false })
    expect(a.t).toBeCloseTo(1000 + fuseSeconds(2) - 2)
    expect(a.version).toBe(3)
    const b = clock({ t: 1000.5, version: 3, nowS: 12.5, chosen: false })
    expect(b).toBe(a)
    expect(b.t).toBeGreaterThan(1000.5)
    // Before it is armed nothing moves on.
    expect(clock({ t: 5, version: 0, nowS: 9, chosen: false }).t).toBe(5)
  })
})

describe('the blueprint drawn again with the Tri-Pack', () => {
  const pic = 'data:image/png;base64,iVBORw0KGgo='
  it('a card from the box look is drawn again once, its record dated for the Tri-Pack, archived as it was', async () => {
    const pk = 'ab'.repeat(32)
    useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: pk } })
    await useBlueprints.getState().load(pk)
    // A card as #952 granted it: drawn at 1_795_000_000.
    const old = await giftRecord({ ...QUARRY_GIFT, lookAt: undefined }, { iso: pic })
    expect(old.created_at).toBe(1_795_000_000)
    expect(staleLook(QUARRY_GIFT, old)).toBe(true)
    useBlueprints.getState().addGame({ lookup: QUARRY_GIFT.lookup, record: old as never })
    useBlueprints.getState().archive(`${pk}/${QUARRY_CARD_ID}`, true)
    expect(await redrawIfStale(QUARRY_GIFT, pk, async () => ({ iso: pic, z: pic }))).toBe(true)
    const card = useBlueprints.getState().cards.find((c) => c.rowKey === `${pk}/${QUARRY_CARD_ID}`)!
    expect(staleLook(QUARRY_GIFT, card.record)).toBe(false)
    expect(readRecord(card.record)).not.toBeNull()
    expect(card.archived).toBeTruthy()
    expect(Object.keys(readRecord(card.record)!.views).sort()).toEqual(['iso', 'z'])
    // Once: already the Tri-Pack, nothing more.
    expect(await redrawIfStale(QUARRY_GIFT, pk, async () => ({ iso: pic }))).toBe(false)
    expect(useBlueprints.getState().cards.filter((c) => c.rowKey === `${pk}/${QUARRY_CARD_ID}`)).toHaveLength(1)
    // And a grant check never grants it twice.
    expect(await grantQuarryIfDue(pk, { 2: 1 }, async () => ({}))).toBe(false)
  })

  it('never redraws with no pictures: a render that failed (no WebGL) keeps the card\'s own', async () => {
    const pk = 'cd'.repeat(32)
    useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: pk } })
    await useBlueprints.getState().load(pk)
    const old = await giftRecord({ ...QUARRY_GIFT, lookAt: undefined }, { iso: pic })
    useBlueprints.getState().addGame({ lookup: QUARRY_GIFT.lookup, record: old as never })
    expect(await redrawIfStale(QUARRY_GIFT, pk, async () => ({}))).toBe(false)
    const card = useBlueprints.getState().cards.find((c) => c.rowKey === `${pk}/${QUARRY_CARD_ID}`)!
    expect(card.record).toEqual(old)
    expect(Object.keys(readRecord(card.record)!.views)).toEqual(['iso'])
    // Tried again later, with pictures, it is drawn.
    expect(await redrawIfStale(QUARRY_GIFT, pk, async () => ({ iso: pic, z: pic }))).toBe(true)
  })
})
