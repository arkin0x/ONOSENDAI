/**
 * The pictures' stage (scene/ThumbStage) keeps its context between scrolls on a
 * desktop: made again each time, it compiled every program again each time.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@react-three/fiber', () => ({ Canvas: () => null, useFrame: () => {}, useThree: () => ({}) }))

import { IDLE_DESKTOP_MS, IDLE_MS, stageIdleMs } from '../ThumbStage'

describe('how long the stage stays', () => {
  it('stays through a long read of a list with a mouse', () => {
    expect(stageIdleMs(true)).toBe(IDLE_DESKTOP_MS)
    expect(IDLE_DESKTOP_MS).toBeGreaterThanOrEqual(5 * 60_000)
  })

  it('still lets go quickly on a phone, where a browser keeps few contexts', () => {
    expect(stageIdleMs(false)).toBe(IDLE_MS)
    expect(IDLE_MS).toBeLessThanOrEqual(10_000)
  })

  it('is what ThumbHost waits on, and it asks the pointer', () => {
    const text = fs.readFileSync(path.resolve(__dirname, '../ThumbStage.tsx'), 'utf8')
    expect(text).toMatch(/setUp\(false\), stageIdleMs\(window\.matchMedia\('\(pointer: fine\)'\)\.matches\)/)
  })
})
