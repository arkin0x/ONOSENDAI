/**
 * reservedIds.test.ts - no enemy may take an id that client.sounds uses for
 * something else: the client keeps each drone's voice under its id beside
 * `voices`, `ui`, `hit`, `kill` and `miss` (types.ts ClientSounds), so a
 * drone named one of those would lose its voice, or take a hit's sound for
 * it. createRun rejects such a variant.
 */

import { describe, expect, it } from 'vitest'
import { createRun, RESERVED_ENEMY_IDS } from '../run'
import { GROUND, boxes, testLevel, variant } from './helpers'

describe('reserved enemy ids', () => {
  it('voices, ui, hit, kill and miss are refused as an enemy id; any other id is fine', () => {
    const lv = testLevel(), field = boxes(GROUND)
    expect([...RESERVED_ENEMY_IDS].sort()).toEqual(['hit', 'kill', 'miss', 'ui', 'voices'])
    for (const id of RESERVED_ENEMY_IDS) {
      const bad = variant()
      const was = bad.spec.enemies[0].id
      bad.spec.enemies[0] = { ...bad.spec.enemies[0], id }
      for (const w of bad.spec.waves) for (const s of w.spawns) if (s.enemy === was) s.enemy = id
      expect(() => createRun(bad, field, { level: lv })).toThrow(/reserved/)
    }
    expect(() => createRun(variant(), field, { level: lv })).not.toThrow()
  })
})
