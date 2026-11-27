/**
 * surveyGlow.test.tsx - the chunk a SURVEY hold will fill, lit while it is
 * held (owner, 2026-11-27: "light up the chunk region being surveyed somehow
 * while the survey button is being held so we know what one is being acted
 * upon"): the chunk lit is the hold's own, chosen once as it starts by the
 * same surveyTarget the button offers, and the very one surveyed when it
 * completes, however the look moves meanwhile; the glow shows while held,
 * breathes faster as the hold fills (steady with reduced motion), hides on
 * release, and flashes once on completion; one group made once, at the
 * chunk's place in the field's frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
let reducedMotion = false
;(globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: q.includes('reduce') && reducedMotion, media: q, addEventListener: () => {}, removeEventListener: () => {} })

const aim = vi.hoisted(() => ({ key: null as string | null }))
vi.mock('../../store/useTerrain', async (orig) => ({ ...(await orig<typeof import('../../store/useTerrain')>()), surveyTarget: () => aim.key }))

import { createElement } from 'react'
import type { Group, Mesh, MeshBasicMaterial } from 'three'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { SurveyGlow, CHUNK_SIDE } from '../../scene/SurveyGlow'
import { useTerrain, type TerrainSession } from '../../store/useTerrain'
import { SURVEY_HOLD_MS, cancelSurveyHold, startSurveyHold, useSurveyHold } from '../surveyHold'
import { holdSurvey, surveyTarget } from '../TerrainView'
import {
  GLOW_EDGE_STEADY, GLOW_FACE_STEADY, GLOW_FAST_MS, GLOW_FLASH_MS, GLOW_SLOW_MS, advanceGlow, glowLook, glowPeriod, type GlowLook,
} from '../surveyGlow'

const blank = (): GlowLook => ({ key: null, edge: 0, face: 0, halo: 0 })

describe('the glow\'s numbers', () => {
  it('breathes slowly as a hold starts and quickens to its end', () => {
    expect(glowPeriod(0)).toBe(GLOW_SLOW_MS)
    expect(glowPeriod(1)).toBe(GLOW_FAST_MS)
    expect(glowPeriod(0.5)).toBeLessThan(GLOW_SLOW_MS)
    expect(glowPeriod(0.5)).toBeGreaterThan(GLOW_FAST_MS)
    // The same 100 ms moves the breath further late in the hold.
    expect(advanceGlow(0, 100, 0.9)).toBeGreaterThan(advanceGlow(0, 100, 0.1))
    // Round and round, never past 1.
    expect(advanceGlow(0.95, 200, 1)).toBeLessThan(1)
  })

  it('lights the hold\'s chunk while held, steady with reduced motion; nothing when nothing is held', () => {
    const held = { since: 0, key: 'k', flash: null }
    const a = glowLook(blank(), held, 10, 0, false).edge
    const b = glowLook(blank(), held, 10, 0.5, false).edge
    expect(glowLook(blank(), held, 10, 0, false).key).toBe('k')
    expect(b).toBeGreaterThan(a)
    expect(glowLook(blank(), held, 10, 0, true)).toEqual({ key: 'k', edge: GLOW_EDGE_STEADY, face: GLOW_FACE_STEADY, halo: expect.any(Number) })
    expect(glowLook(blank(), held, 10, 0.5, true).edge).toBe(GLOW_EDGE_STEADY)
    expect(glowLook(blank(), { since: null, key: null, flash: null }, 10, 0, false).key).toBeNull()
    // A hold with nothing to survey lights nothing.
    expect(glowLook(blank(), { since: 0, key: null, flash: null }, 10, 0, false).key).toBeNull()
  })

  it('flashes once as a hold completes and fades out, never with reduced motion', () => {
    const done = { since: null, key: null, flash: { key: 'k', at: 1000 } }
    const start = glowLook(blank(), done, 1000, 0, false)
    expect(start.key).toBe('k')
    expect(start.edge).toBeCloseTo(1)
    expect(glowLook(blank(), done, 1000 + GLOW_FLASH_MS / 2, 0, false).edge).toBeCloseTo(0.5)
    expect(glowLook(blank(), done, 1000 + GLOW_FLASH_MS + 1, 0, false).key).toBeNull()
    expect(glowLook(blank(), done, 1000, 0, true).key).toBeNull()
  })

  it('writes into the look it is given, so a frame makes nothing new', () => {
    const out = blank()
    expect(glowLook(out, { since: 0, key: 'k', flash: null }, 1, 0, false)).toBe(out)
  })
})

describe('the chunk held is the chunk surveyed', () => {
  let survey: Mock<(key: string) => Promise<void>>
  let real: (key: string) => Promise<void>
  beforeEach(() => {
    vi.useFakeTimers()
    cancelSurveyHold()
    useSurveyHold.setState({ flash: null })
    real = useTerrain.getState().survey
    survey = vi.fn(async () => {})
    useTerrain.setState({ survey })
  })
  afterEach(() => { cancelSurveyHold(); useTerrain.setState({ survey: real }); vi.useRealTimers(); aim.key = null })

  it('chosen by the button\'s own surveyTarget as the hold starts, kept while the look moves, surveyed at the end', () => {
    aim.key = 'chunk-a'
    expect(surveyTarget()).toBe('chunk-a')
    holdSurvey()
    expect(useSurveyHold.getState().key).toBe('chunk-a')
    // The look moves on to another chunk mid-hold: the lit one stays, and is the one surveyed.
    aim.key = 'chunk-b'
    vi.advanceTimersByTime(SURVEY_HOLD_MS / 2)
    expect(useSurveyHold.getState().key).toBe('chunk-a')
    vi.advanceTimersByTime(SURVEY_HOLD_MS / 2)
    expect(survey).toHaveBeenCalledTimes(1)
    expect(survey).toHaveBeenCalledWith('chunk-a')
    expect(useSurveyHold.getState()).toMatchObject({ since: null, key: null, flash: { key: 'chunk-a' } })
  })

  it('let go early: nothing surveyed, nothing lit, no flash', () => {
    aim.key = 'chunk-a'
    holdSurvey()
    vi.advanceTimersByTime(SURVEY_HOLD_MS - 1)
    cancelSurveyHold()
    expect(useSurveyHold.getState()).toMatchObject({ since: null, key: null, flash: null })
    vi.advanceTimersByTime(SURVEY_HOLD_MS)
    expect(survey).not.toHaveBeenCalled()
  })

  it('a hold already under way keeps its chunk when pressed again', () => {
    aim.key = 'chunk-a'
    holdSurvey()
    aim.key = 'chunk-b'
    holdSurvey()
    startSurveyHold(() => {}, 0, 'chunk-c')
    expect(useSurveyHold.getState().key).toBe('chunk-a')
  })
})

describe('the glow in the scene', () => {
  const slots = new Map([['chunk-a', { key: 'chunk-a', off: [1, 0, -2] }], ['chunk-b', { key: 'chunk-b', off: [0, 0, 0] }]])
  let lookups = 0
  const field = { world: { slotByKey: (k: string) => { lookups++; return slots.get(k) ?? null } } } as unknown as TerrainSession
  let root: R3fRoot
  afterEach(async () => {
    await root?.unmount()
    cancelSurveyHold()
    useSurveyHold.setState({ since: null, key: null, flash: null })
    reducedMotion = false
  })
  const glow = (): Group => root.state().scene.getObjectByName('terrain-survey-glow') as Group
  const faces = (): MeshBasicMaterial => (glow().children[0] as Mesh).material as MeshBasicMaterial

  it('hidden with no hold; while held, lit at the hold\'s chunk, breathing; hidden on release', async () => {
    root = await r3fRoot()
    await root.render(createElement(SurveyGlow, { session: () => field }))
    await root.frame()
    expect(glow().visible).toBe(false)
    useSurveyHold.setState({ since: performance.now(), key: 'chunk-a' })
    await root.frame()
    const g = glow()
    expect(g.visible).toBe(true)
    // The chunk's centre in the field's frame: 32 a chunk, its corner at its offset.
    expect(g.position.toArray()).toEqual([CHUNK_SIDE * 1 + 16, 16, CHUNK_SIDE * -2 + 16])
    // One group, made once: three parts (the faces, the glow, the edges), the same objects every frame.
    expect(g.children).toHaveLength(3)
    const parts = [...g.children]
    const a = faces().opacity
    await new Promise((r) => setTimeout(r, 60))
    await root.frame()
    await new Promise((r) => setTimeout(r, 60))
    await root.frame()
    expect(faces().opacity).not.toBeCloseTo(a, 5)
    expect(g.children).toEqual(parts)
    // The chunk is looked up once, not every frame.
    const seen = lookups
    for (let i = 0; i < 10; i++) await root.frame()
    expect(lookups).toBe(seen)
    cancelSurveyHold()
    useSurveyHold.setState({ since: null, key: null })
    await root.frame()
    expect(glow().visible).toBe(false)
  })

  it('flashes once as the hold completes, then hides', async () => {
    root = await r3fRoot()
    await root.render(createElement(SurveyGlow, { session: () => field }))
    useSurveyHold.setState({ since: null, key: null, flash: { key: 'chunk-b', at: performance.now() } })
    await root.frame()
    expect(glow().visible).toBe(true)
    expect(glow().position.toArray()).toEqual([16, 16, 16])
    useSurveyHold.setState({ flash: { key: 'chunk-b', at: performance.now() - GLOW_FLASH_MS - 1 } })
    await root.frame()
    expect(glow().visible).toBe(false)
  })

  it('steady with reduced motion: no breath, and no flash', async () => {
    reducedMotion = true
    root = await r3fRoot()
    await root.render(createElement(SurveyGlow, { session: () => field }))
    useSurveyHold.setState({ since: performance.now(), key: 'chunk-a' })
    await root.frame()
    expect(faces().opacity).toBe(GLOW_FACE_STEADY)
    await new Promise((r) => setTimeout(r, 60))
    await root.frame()
    expect(faces().opacity).toBe(GLOW_FACE_STEADY)
    useSurveyHold.setState({ since: null, key: null, flash: { key: 'chunk-a', at: performance.now() } })
    await root.frame()
    expect(glow().visible).toBe(false)
  })
})
