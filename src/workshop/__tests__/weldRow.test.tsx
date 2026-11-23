/**
 * WELD (arkinox, 2026-10-12): never automatic, and never where it covered
 * the orbit or the color corner. With the held bar (workshop redesign,
 * phase 2) it is a key in MORE, saying how many spots are stacked, and MORE
 * carries the count as a badge on every strip while any are.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MORE = readFileSync(join(__dirname, '..', 'sheets', 'MoreSheet.tsx'), 'utf8')
const STRIP = readFileSync(join(__dirname, '..', 'shell', 'Strip.tsx'), 'utf8')
const HELD = readFileSync(join(__dirname, '..', 'shell', 'HeldBar.tsx'), 'utf8')
const WORKSHOP = readFileSync(join(__dirname, '..', 'Workshop.tsx'), 'utf8')

describe('WELD', () => {
  it('is a key in MORE while points are stacked, with the count, folding the selection or the whole shard', () => {
    // Not as a fold of the held points in LOOK, where they are out of sight (workshop/benchLook.tsx).
    expect(MORE).toContain('{stacked.spots > 0 && !(look && selection.length >= 2) && (')
    expect(MORE).toContain('label={`WELD ${stacked.spots}`}')
    expect(MORE).toContain("aria={selection.length >= 2 ? 'Weld the selected stacked points' : 'Weld every stacked point'}")
    expect(MORE).toContain('onClick={() => w().weld()}')
  })

  it('shows its count as a badge on MORE, on the tool strips and on the held bar alike', () => {
    expect(WORKSHOP).toContain('moreBadge={stacked}')
    for (const src of [STRIP, HELD]) expect(src).toContain('{moreBadge > 0 && <i className="ws__badge" aria-hidden>{moreBadge}</i>}')
  })

  it('is nowhere else', () => {
    for (const src of [STRIP, HELD, WORKSHOP]) expect(src).not.toMatch(/\.weld\(\)/)
  })
})
