/**
 * isolationWording.test.ts - the owner's wording rule for blueprints (owner's
 * lost Glowcore, 2026-11-28; "air gapped" since his card copy the same day):
 * never the words for upright posture, never "with a gap all round", and no
 * long dashes. The copy players read about blueprints, in the files that hold it,
 * with comments stripped (code names may keep their words).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CAPTURE_REFUSED } from '../capture'

const SRC = join(__dirname, '..', '..', '..')
const read = (p: string): string => readFileSync(join(SRC, p), 'utf8')
/** The file without its comments (block, line and JSX), so only code and copy are left. */
const copyOf = (p: string): string => read(p).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const FORBIDDEN = /stand-alone|standalone|stand alone|\bstands?\b|\bstanding\b|gap all round/i

const FILES = [
  'hud/BuildBar.tsx',
  'hud/blueprint/BlueprintTool.tsx',
  'hud/blueprint/BlueprintsModal.tsx',
  'hud/blueprint/BlueprintLanding.tsx',
  'hud/blueprint/ExamineSheet.tsx',
  'lib/blueprint/capture.ts',
  'lib/blueprint/make.ts',
  'lib/blueprint/gameCard.ts',
  'lib/blueprint/nearMiss.ts',
  'lib/blueprint/smashConfirm.ts',
  'terrain/SmashConfirm.tsx',
]

describe("blueprint copy keeps the owner's wording", () => {
  it('none of the blueprint files says it in copy', () => {
    for (const f of FILES) expect(copyOf(f), f).not.toMatch(FORBIDDEN)
  })

  it('the BLUEPRINT button, RECORD and the capture refusal say it the owner\'s way', () => {
    expect(read('hud/BuildBar.tsx')).toContain('title="Blueprint: an air gapped build that compiles into a prize when smashed"')
    expect(read('hud/blueprint/BlueprintTool.tsx')).toContain('Aim at an air gapped build and press RECORD.')
    // TERRAIN's RECORD strip (TerrainView.tsx keeps a `standing` variable of its own, so it is checked by its line).
    const view = read('terrain/TerrainView.tsx')
    expect(view).toContain('<span className="prize-strip__count">Aim at an air gapped build</span>')
    expect(view).not.toContain('gap all round')
    expect(view).not.toContain('Aim at a build that stands alone')
    expect(CAPTURE_REFUSED).toBe('Build must be air gapped and fit in 16x16x16.')
  })
})
